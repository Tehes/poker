import { getCurrentPhase } from "../js/gameEngine.js";
import { fileSha256, iterateDiagnosticPairs } from "./matchupBatch.js";
import pool from "./matchupPool.js";
import {
	bucketBetToPotRatio,
	classifyPostflopQuality,
	classifyPreflopHandFamily,
	getPostflopPositionRole,
} from "./speedmodeAnalysis.js";

const fields = ["reference", "mixed"];
const role = "test";
export const diagnosisColumns = [
	"field",
	"run",
	"seed",
	"handId",
	"decisionId",
	"seat",
	"included",
	"street",
	"situation",
	"structure",
	"tableSize",
	"position",
	"handClass",
	"rawHand",
	"pairClass",
	"draw",
	"line",
	"opponent",
	"reason",
	"adjustment",
	"holeCards",
	"board",
	"pot",
	"toCall",
	"betSize",
	"effectiveStack",
	"action",
	"amount",
	"netChipsFromDecision",
	"bigBlind",
];
const sections = [
	["spot", []],
	["handClass", ["handClass"]],
	["position", ["position"]],
	["line", ["line"]],
	["betSize", ["betSize"]],
	["handClassAndBetSize", ["handClass", "betSize"]],
	["opponent", ["opponent"]],
];

function projectDecision(decision, state, player, seating, lineup) {
	const preflop = state.currentPhaseIndex === 0;
	const street = getCurrentPhase(state.currentPhaseIndex);
	const facingBet = preflop ? state.currentBet > state.bigBlind : decision.toCall > 0;
	const situation = preflop
		? decision.spotType
		: (facingBet ? (decision.raiseLevel > 1 ? "facing-raise" : "facing-bet") : "free-action");
	const handClass = preflop
		? classifyPreflopHandFamily(decision.holeCards)
		: classifyPostflopQuality({ ...decision, activeOpponents: decision.activePlayers - 1 }).qualityReason;
	const position = preflop ? player.spotState.position ?? decision.preflopSeat : getPostflopPositionRole(decision);
	let opponentSeat = facingBet ? state.handContext.streetAggressorSeatIndex : null;
	if (opponentSeat == null && decision.activePlayers === 2) {
		opponentSeat = state.players.find((seat) => seat !== player && !seat.folded).seatIndex;
	}
	return {
		street,
		situation,
		structure: decision.structureTag,
		position,
		handClass,
		tableSize: player.spotState.tableSize,
		rawHand: preflop ? null : decision.rawHand,
		pairClass: preflop ? null : decision.pairClass,
		draw: preflop ? null : decision.drawFlag,
		line: preflop
			? null
			: `${decision.spotType}/${
				decision.lineTag === "PFA" ? "PFA" : "nonPFA"
			}/${decision.priorCheckedThroughCount}`,
		opponent: opponentSeat == null ? null : lineup[seating[opponentSeat]],
		reason: decision.decisionReason,
		adjustment: decision.finalAdjustment,
		holeCards: decision.holeCards.join(""),
		board: decision.communityCards.join(""),
		pot: decision.potBefore,
		toCall: decision.toCall,
		betSize: facingBet ? bucketBetToPotRatio(decision.toCall, decision.potBefore) : null,
		effectiveStack: decision.effectiveStack,
	};
}

function compactRow(field, match, decision, included) {
	const { id, handId, seatIndex, context, action, amount, netChips, bigBlind } = decision;
	const values = {
		...context,
		field,
		run: match.run,
		seed: match.seed,
		handId,
		decisionId: id,
		seat: seatIndex,
		included,
		action,
		amount,
		netChipsFromDecision: netChips,
		bigBlind,
	};
	return diagnosisColumns.map((name) => values[name]);
}

function accumulateCohorts(cohorts, field, { context, action, amount, netChips, bigBlind }) {
	const { street, situation, structure } = context;
	const actionClass = action === "allin" ? (amount > context.toCall ? "allinRaise" : "allinCall") : action;
	for (const [section, dimensions] of sections) {
		const values = dimensions.map((name) => context[name]);
		if (values.some((value) => value == null || value === "n/a")) {
			continue;
		}
		const key = JSON.stringify([section, street, situation, structure, ...values]);
		let cohort = cohorts.get(key);
		if (!cohort) {
			const spot = { street, situation, structure };
			for (const [index, name] of dimensions.entries()) {
				spot[name] = values[index];
			}
			cohort = { section, spot, reference: null, mixed: null };
			cohorts.set(key, cohort);
		}
		const bucket = cohort[field] ??= { count: 0, netBb: 0, actions: Object.create(null) };
		const actionBucket = bucket.actions[actionClass] ??= { count: 0, netBb: 0 };
		const netBb = netChips / bigBlind;
		bucket.count++;
		bucket.netBb += netBb;
		actionBucket.count++;
		actionBucket.netBb += netBb;
	}
}

function round(value) {
	return Number(value.toFixed(4));
}

function summarizeCohort(bucket, hands) {
	if (!bucket) {
		return { count: 0, spotsPer100Hands: hands > 0 ? 0 : null, netBbPerDecision: null, actions: {} };
	}
	const { count, netBb, actions } = bucket;
	return {
		count,
		spotsPer100Hands: round(100 * count / hands),
		netBbPerDecision: round(netBb / count),
		actions: Object.fromEntries(
			Object.entries(actions).map(([action, details]) => [
				action,
				{
					count: details.count,
					share: round(details.count / count),
					netBbPerDecision: round(details.netBb / details.count),
				},
			]),
		),
	};
}

export async function collectMatchupDiagnosis(config, { minSpots = 20, writeRows = () => {} } = {}) {
	if (!Number.isSafeInteger(minSpots) || minSpots < 1) {
		throw new Error("minSpots must be a positive integer");
	}
	const cohorts = new Map();
	const excludedPairs = [];
	const totals = Object.fromEntries(fields.map((field) => [field, { hands: 0, decisions: 0, logged: 0 }]));
	const lineups = Object.fromEntries(fields.map((field) => [field, config.lineups[field]]));
	for (const pair of iterateDiagnosticPairs({ ...config, lineups }, { role, project: projectDecision })) {
		const issues = fields.flatMap((field) => {
			const { match } = pair[field];
			if (match.type === "game-over" && match.payoutMismatches.length === 0) {
				return [];
			}
			return [{ field, type: match.type, payoutMismatches: match.payoutMismatches }];
		});
		const included = issues.length === 0;
		if (!included) {
			excludedPairs.push({ run: pair.reference.match.run, seed: pair.reference.match.seed, issues });
		}
		const rows = [];
		for (const field of fields) {
			const { match, decisions } = pair[field];
			totals[field].logged += decisions.length;
			if (included) {
				totals[field].hands += match.roles[role].hands;
				totals[field].decisions += decisions.length;
			}
			for (const decision of decisions) {
				rows.push(compactRow(field, match, decision, included));
				if (included) {
					accumulateCohorts(cohorts, field, decision);
				}
			}
		}
		await writeRows(rows);
	}

	const report = Object.fromEntries(sections.map(([name]) => [name, []]));
	let smallCohorts = 0;
	for (const { section, spot, reference, mixed } of cohorts.values()) {
		if (Math.max(reference?.count ?? 0, mixed?.count ?? 0) < minSpots) {
			smallCohorts++;
			continue;
		}
		const referenceSummary = summarizeCohort(reference, totals.reference.hands);
		const mixedSummary = summarizeCohort(mixed, totals.mixed.hands);
		report[section].push({
			spot,
			reference: referenceSummary,
			mixed: mixedSummary,
			mixedMinusReferenceBb: reference && mixed
				? round(mixed.netBb / mixed.count - reference.netBb / reference.count)
				: null,
		});
	}
	for (const section of Object.values(report)) {
		section.sort((a, b) => (b.reference.count + b.mixed.count) - (a.reference.count + a.mixed.count));
	}
	return {
		formatVersion: 1,
		seed: config.seed,
		runsPerField: config.runs,
		startingChips: config.startingChips ?? 2000,
		maxHands: config.maxHands ?? 1000,
		role,
		minSpots,
		lineups,
		includedPairs: config.runs - excludedPairs.length,
		excludedPairs,
		totals,
		smallCohorts,
		cohorts: report,
	};
}

function parseArgs(args) {
	const options = { runs: pool.runs, seed: pool.seed, minSpots: 20, out: null };
	for (const arg of args) {
		if (arg === "--") {
			continue;
		}
		const [name, value] = arg.split(/=(.*)/s, 2);
		if (value == null || value === "") {
			throw new Error(`Missing value for ${name}`);
		}
		switch (name) {
			case "--runs":
				options.runs = Number(value);
				break;
			case "--seed":
				options.seed = Number(value);
				break;
			case "--min-spots":
				options.minSpots = Number(value);
				break;
			case "--out":
				options.out = value;
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}
	if (!options.out) {
		throw new Error("Usage: deno task engine:diagnose -- --out=tmp/<report-dir> [--runs=1000] [--seed=42]");
	}
	return options;
}

async function writeDiagnosis({ runs, seed, minSpots, out }) {
	const sourcePaths = [
		"js/bot.js",
		"js/gameEngine.js",
		"js/shared/actionModel.js",
		"scripts/matchupPool.js",
		"scripts/matchupBatch.js",
		"scripts/matchupDiagnosis.js",
		"scripts/speedmodeAnalysis.js",
	];
	const sourceHashes = Object.fromEntries(
		await Promise.all(sourcePaths.map(async (path) => {
			const hash = await fileSha256(new URL(`../${path}`, import.meta.url));
			return [path, hash];
		})),
	);
	await Deno.mkdir(out, { recursive: true });
	const logPath = `${out}/decisions.jsonl.gz`;
	const file = await Deno.open(logPath, { createNew: true, write: true });
	const gzip = new CompressionStream("gzip");
	const completed = gzip.readable.pipeTo(file.writable).then(() => null, (error) => error);
	const writer = gzip.writable.getWriter();
	const encoder = new TextEncoder();
	const writeRows = async (rows) => {
		if (rows.length > 0) {
			await writer.write(encoder.encode(rows.map((row) => JSON.stringify(row)).join("\n") + "\n"));
		}
	};
	let report;
	try {
		await writeRows([{ formatVersion: 1, columns: diagnosisColumns }]);
		report = await collectMatchupDiagnosis({ ...pool, runs, seed, classifySpot: undefined }, {
			minSpots,
			writeRows,
		});
		await writer.close();
		const error = await completed;
		if (error) {
			throw error;
		}
	} catch (error) {
		await Promise.allSettled([writer.abort(error), completed]);
		throw error;
	}
	const { size } = await Deno.stat(logPath);
	await Deno.writeTextFile(
		`${out}/summary.json`,
		JSON.stringify(
			{
				...report,
				sourceHashes,
				decisionLog: { path: "decisions.jsonl.gz", bytes: size },
			},
			null,
			2,
		),
		{ createNew: true },
	);
	console.log(
		`pairs=${report.includedPairs}/${runs} decisions=${
			report.totals.reference.logged + report.totals.mixed.logged
		} log_bytes=${size} output=${out}`,
	);
}

if (import.meta.main) {
	await writeDiagnosis(parseArgs(Deno.args));
}
