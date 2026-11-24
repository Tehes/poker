import { createRandom, runMatchupBatch, runMatchupCommand } from "./matchupBatch.js";

const metrics = ["bbPerHand", "bbPerSpot", "winRate"];
const stages = ["diagnosis", "validation", "holdout", "rollout"];
const bootstrapSamples = 2000;

function prepareExperiment({ name, stage, seed, fields, variants, strategyVersions, comparisons }) {
	if (typeof name !== "string" || !name.trim() || !stages.includes(stage)) {
		throw new Error("Provide an experiment name and a stage (diagnosis, validation, holdout or rollout)");
	}
	if (!Array.isArray(comparisons) || comparisons.length === 0) {
		throw new Error("An experiment needs at least one comparison");
	}
	const lineups = Object.create(null);
	const ids = new Set();
	const plan = comparisons.map((comparison) => {
		const { id, field, baseline, candidate, attack, defense, role = "test", spot, criteria = [] } = comparison;
		if (typeof id !== "string" || !id.trim() || ids.has(id)) {
			throw new Error("Comparison IDs must be nonempty and unique");
		}
		ids.add(id);
		const fieldLineup = fields?.[field];
		if (!fieldLineup || !Object.hasOwn(fields, field) || !Object.hasOwn(fieldLineup, role)) {
			throw new Error(`Unknown field or measured role for "${id}"`);
		}
		const interaction = attack !== undefined || defense !== undefined;
		const arms = interaction ? { baseline, attack, defense, combined: candidate } : { baseline, candidate };
		if (new Set(Object.values(arms)).size !== Object.keys(arms).length) {
			throw new Error(`Comparison "${id}" needs distinct variant names for each arm`);
		}

		const armLineups = Object.entries(arms).map(([arm, variant]) => {
			if (typeof variant !== "string" || !variant || !Object.hasOwn(variants ?? {}, variant)) {
				throw new Error(`Unknown variant for "${id}" (${arm})`);
			}
			const overrides = variants[variant];
			if (!overrides || Object.keys(overrides).some((seatRole) => !Object.hasOwn(fieldLineup, seatRole))) {
				throw new Error(`Variant "${variant}" overrides a role absent from "${field}"`);
			}
			const key = JSON.stringify([field, variant]);
			if (!Object.hasOwn(lineups, key)) {
				const lineup = { ...fieldLineup, ...overrides };
				for (const strategy of Object.values(lineup)) {
					const version = strategyVersions?.[strategy];
					if (
						!Object.hasOwn(strategyVersions ?? {}, strategy) || typeof version !== "string" ||
						!version.trim()
					) {
						throw new Error(`Record a fixed version for strategy "${strategy}"`);
					}
				}
				lineups[key] = lineup;
			}
			return { arm, variant, lineup: key };
		});
		if (interaction) {
			for (const seatRole of Object.keys(fieldLineup)) {
				const [oldStrategy, attackStrategy, defenseStrategy, combinedStrategy] = armLineups.map(({ lineup }) =>
					lineups[lineup][seatRole]
				);
				if (
					attackStrategy === oldStrategy && defenseStrategy === oldStrategy &&
					combinedStrategy !== oldStrategy
				) {
					throw new Error(`Combined variant changes role "${seatRole}" outside the individual variants`);
				}
			}
		}

		if (!Array.isArray(criteria)) {
			throw new Error(`Criteria for "${id}" must be an array`);
		}
		const measuredMetrics = new Set(spot ? metrics : ["bbPerHand", "winRate"]);
		for (const { metric, minDelta, minPairs, minObservations = 1 } of criteria) {
			if (
				!measuredMetrics.has(metric) || !Number.isFinite(minDelta) || !Number.isSafeInteger(minPairs) ||
				minPairs < 2 || !Number.isSafeInteger(minObservations) || minObservations < 1
			) {
				throw new Error(`Invalid criterion for "${id}" (${metric})`);
			}
		}
		return {
			id,
			field,
			role,
			spot,
			criteria,
			arms: armLineups,
			measuredMetrics: [...measuredMetrics],
			interaction,
		};
	});
	if ((stage === "holdout" || stage === "rollout") && plan.every(({ criteria }) => criteria.length === 0)) {
		throw new Error("Holdout and rollout stages need at least one explicit acceptance criterion");
	}
	return { name, stage, seed, lineups, plan };
}

function collectPairs(arms) {
	const clean = [];
	const excluded = [];
	const [reference] = arms;
	for (const [index, start] of reference.runs.entries()) {
		const members = arms.map(({ runs }) => runs[index]);
		if (
			members.some((run) =>
				run.run !== start.run || run.seed !== start.seed ||
				run.seating.some((role, seat) => role !== start.seating[seat])
			)
		) {
			throw new Error("Experiment runs are out of sync");
		}
		const problems = members.flatMap((run, arm) => {
			if (run.type === "game-over" && run.payoutMismatches.length === 0) {
				return [];
			}
			return [{ arm: arms[arm].arm, type: run.type, payoutMismatches: run.payoutMismatches }];
		});
		if (problems.length > 0) {
			excluded.push({ run: start.run, seed: start.seed, problems });
		} else {
			clean.push(members);
		}
	}
	return { clean, excluded };
}

function measureRun(role, metric, spot) {
	if (metric === "bbPerHand") {
		return [role.netBb, role.hands];
	}
	if (metric === "winRate") {
		return [role.wins, 1];
	}
	let netBb = 0;
	let count = 0;
	for (const action of Object.values(role.spots[spot] ?? {})) {
		netBb += action.netBb;
		count += action.count;
	}
	return [netBb, count];
}

function estimateContrast(sums) {
	const values = sums.map(([sum, count]) => sum / count);
	return values.length === 2 ? values[1] - values[0] : (values[3] - values[1]) - (values[2] - values[0]);
}

export function summarizePairedMeasurements(pairs, arms, random) {
	const sums = arms.map(() => [0, 0, 0]);
	for (const pair of pairs) {
		for (const [index, [value, observations]] of pair.entries()) {
			sums[index][0] += value;
			sums[index][1] += observations;
			sums[index][2] += Number(observations > 0);
		}
	}
	const estimates = Object.fromEntries(arms.map(({ arm }, index) => {
		const [sum, observations, observedPairs] = sums[index];
		return [arm, { value: observations ? sum / observations : null, observations, observedPairs }];
	}));
	const delta = sums.every(([, count]) => count > 0) ? estimateContrast(sums) : null;
	if (delta === null || pairs.length < 2) {
		return { estimates, delta, interval95: null };
	}

	const samples = [];
	for (let repeat = 0; repeat < bootstrapSamples; repeat++) {
		const totals = arms.map(() => [0, 0]);
		// Resample whole tournaments together to keep the comparison paired.
		for (let draw = 0; draw < pairs.length; draw++) {
			const pair = pairs[Math.floor(random() * pairs.length)];
			for (let arm = 0; arm < totals.length; arm++) {
				totals[arm][0] += pair[arm][0];
				totals[arm][1] += pair[arm][1];
			}
		}
		if (totals.every(([, count]) => count > 0)) {
			samples.push(estimateContrast(totals));
		}
	}
	samples.sort((left, right) => left - right);
	const interval95 = samples.length >= bootstrapSamples * 0.95
		? [samples[Math.floor(samples.length * 0.025)], samples[Math.floor(samples.length * 0.975)]]
		: null;
	return { estimates, delta, interval95 };
}

function summarizeStatus(statuses) {
	for (const status of ["blocked", "fail", "insufficient", "inconclusive", "pass"]) {
		if (statuses.includes(status)) {
			return status;
		}
	}
	return "descriptive";
}

function checkCriterion({ metric, minDelta, minPairs, minObservations = 1 }, result, excluded) {
	if (excluded > 0) {
		return "blocked";
	}
	const { estimates, interval95 } = result[metric];
	if (
		!interval95 ||
		Object.values(estimates).some((estimate) =>
			estimate.observedPairs < minPairs || estimate.observations < minObservations
		)
	) {
		return "insufficient";
	}
	if (interval95[0] >= minDelta) {
		return "pass";
	}
	return interval95[1] < minDelta ? "fail" : "inconclusive";
}

export function runMatchupExperiment(config) {
	const { name, stage, seed, lineups, plan } = prepareExperiment(config);
	const tournamentReport = runMatchupBatch({ ...config, lineups });
	const comparisons = plan.map(({ id, field, role, spot, criteria, arms, measuredMetrics, interaction }, index) => {
		const source = arms.map((arm) => ({ ...arm, runs: tournamentReport.results[arm.lineup].runs }));
		const { clean, excluded } = collectPairs(source);
		const result = Object.fromEntries(measuredMetrics.map((metric) => {
			const measures = clean.map((pair) => pair.map((run) => measureRun(run.roles[role], metric, spot)));
			const random = createRandom(seed ^ Math.imul(index + 1, 0xc2b2ae35));
			return [metric, summarizePairedMeasurements(measures, arms, random)];
		}));
		const checks = criteria.map((criterion) => ({
			...criterion,
			status: checkCriterion(criterion, result, excluded.length),
		}));
		const status = excluded.length > 0 ? "blocked" : summarizeStatus(checks.map((check) => check.status));
		return {
			id,
			field,
			role,
			spot,
			kind: interaction ? "interaction" : "difference",
			arms,
			pairs: { accepted: clean.length, excluded },
			status,
			checks,
			metrics: result,
		};
	});
	return {
		formatVersion: 1,
		name,
		stage,
		strategyVersions: config.strategyVersions,
		status: summarizeStatus(comparisons.map((comparison) => comparison.status)),
		comparisons,
		...tournamentReport,
	};
}

if (import.meta.main) {
	const { report, outputPath } = await runMatchupCommand(runMatchupExperiment, "engine:experiment");
	for (const comparison of report.comparisons) {
		console.log(
			`${comparison.id} ${comparison.status} pairs=${comparison.pairs.accepted} excluded=${comparison.pairs.excluded.length}`,
		);
	}
	console.log(`experiment=${report.name} stage=${report.stage} status=${report.status} output=${outputPath}`);
	if (report.status === "blocked" || (["holdout", "rollout"].includes(report.stage) && report.status !== "pass")) {
		Deno.exitCode = 1;
	}
}
