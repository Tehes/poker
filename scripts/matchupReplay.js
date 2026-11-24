import { runEngineHand } from "../js/gameEngine.js";
import { createEngineBatchGameState } from "./engineBatch.js";
import { chooseSeededAction, createRandom, runMatchupCommand, shuffleMatchupDeck } from "./matchupBatch.js";
import { summarizePairedMeasurements } from "./matchupExperiment.js";

function validateReplay(
	{ name, seed, runs, maxHands, startingChips, field, strategies, strategyVersions, alternatives, select },
) {
	if (typeof name !== "string" || !name.trim() || typeof select !== "function") {
		throw new Error("Provide a replay name and a select function");
	}
	if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
		throw new Error("seed must be an unsigned 32-bit integer");
	}
	if (![runs, maxHands, startingChips].every((value) => Number.isSafeInteger(value) && value > 0)) {
		throw new Error("runs, startingChips and maxHands must be positive integers");
	}
	const roles = Object.keys(field ?? {});
	if (roles.length < 2 || roles.length > 6 || Object.keys(alternatives ?? {}).length === 0) {
		throw new Error("A replay needs two to six roles and at least one alternative");
	}
	for (const id of [...Object.values(field), ...Object.values(alternatives)]) {
		if (
			typeof id !== "string" || !Object.hasOwn(strategies ?? {}, id) || typeof strategies[id] !== "function" ||
			!Object.hasOwn(strategyVersions ?? {}, id) || typeof strategyVersions[id] !== "string" ||
			!strategyVersions[id].trim()
		) {
			throw new Error(`Unknown or unversioned replay strategy "${id}"`);
		}
	}
	return roles;
}

function playReplayHand(state, config, seating, handId, handSeed, actionProvider) {
	const deckRandom = createRandom(handSeed);
	const seatRandoms = seating.map((_, seat) => createRandom(handSeed ^ Math.imul(seat + 1, 0x85ebca6b)));
	let decisionIndex = 0;
	return runEngineHand(state, (game, player) => {
		const choose = (id) => {
			const action = chooseSeededAction(config.strategies[id], player, game, seatRandoms[player.seatIndex]);
			if (!action) {
				throw new Error(`Replay strategy "${id}" returned an invalid action`);
			}
			return action;
		};
		return actionProvider(game, player, seating[player.seatIndex], decisionIndex++, choose);
	}, { handId, shuffleFn: (deck) => shuffleMatchupDeck(deck, deckRandom) });
}

function getHandIssue(result) {
	if (result.type !== "showdown") {
		return { type: result.type };
	}
	const { totalPot, totalPayoutByPlayer } = result.showdownResult;
	const paid = [...totalPayoutByPlayer.values()].reduce((sum, chips) => sum + chips, 0);
	return paid === totalPot ? null : { type: "payout-mismatch", pot: totalPot, paid };
}

function getOutcome(result, spot) {
	const action = result.actions[spot.index].resolvedAction;
	const player = result.actions[spot.index].player;
	return { action: action.action, amount: action.amount, netBb: (player.chips - spot.chips) / spot.bigBlind };
}

function replayAlternative(snapshot, config, seating, handId, handSeed, baseline, spot, alternative) {
	const branch = structuredClone(snapshot);
	let reachedSpot = false;
	const result = playReplayHand(branch, config, seating, handId, handSeed, (game, player, role, index, choose) => {
		if (index < spot.index) {
			const expected = baseline.actions[index];
			const action = choose(config.field[role]);
			if (
				expected.player.seatIndex !== player.seatIndex ||
				expected.actionRequest.action !== action.action || expected.actionRequest.amount !== action.amount
			) {
				throw new Error(`Replay diverged before the intervention at hand ${handId}, action ${index + 1}`);
			}
			return action;
		}
		if (index === spot.index) {
			if (
				player.seatIndex !== spot.seat || player.chips !== spot.chips || game.pot !== spot.pot ||
				game.currentBet !== spot.currentBet || game.communityCards.join() !== spot.board.join() ||
				player.holeCards.join() !== spot.holeCards.join()
			) {
				throw new Error(`Replay did not reach the same spot at hand ${handId}, action ${index + 1}`);
			}
			reachedSpot = true;
		}
		return choose(role === spot.role ? alternative : config.field[role]);
	});
	if (!reachedSpot) {
		throw new Error(`Replay ended before the intervention at hand ${handId}, action ${spot.index + 1}`);
	}
	const issue = getHandIssue(result);
	return issue ? { issue } : getOutcome(result, spot);
}

function summarizeReplay(records, alternatives, seed) {
	const byLabel = new Map();
	for (const record of records) {
		const rows = byLabel.get(record.label) ?? [];
		rows.push(record);
		byLabel.set(record.label, rows);
	}
	return Object.fromEntries([...byLabel].map(([label, rows]) => {
		const estimates = Object.fromEntries(
			Object.keys(alternatives).map((alternative) => {
				const byRun = new Map();
				let excluded = 0;
				for (const row of rows) {
					if (row.alternatives[alternative].issue) {
						excluded++;
						continue;
					}
					const totals = byRun.get(row.run) ?? [[0, 0], [0, 0]];
					totals[0][0] += row.baseline.netBb;
					totals[0][1]++;
					totals[1][0] += row.alternatives[alternative].netBb;
					totals[1][1]++;
					byRun.set(row.run, totals);
				}
				const arms = [{ arm: "baseline" }, { arm: "alternative" }];
				const estimate = summarizePairedMeasurements([...byRun.values()], arms, createRandom(seed));
				return [alternative, { selected: rows.length, excluded, ...estimate }];
			}),
		);
		return [label, estimates];
	}));
}

export function runMatchupReplay(config) {
	const { name, seed, runs, maxHands = 1000, startingChips = 2000, field, alternatives, strategyVersions, select } =
		config;
	const roles = validateReplay({ ...config, maxHands, startingChips });
	const records = [];
	const issues = [];
	for (let run = 0; run < runs; run++) {
		const seating = roles.map((_, seat) => roles[(seat + run) % roles.length]);
		const game = createEngineBatchGameState({ playerCount: roles.length, startingChips });
		const runSeed = (seed + Math.imul(run, 0x9e3779b9)) >>> 0;
		for (let handId = 0; handId < maxHands; handId++) {
			const handSeed = (runSeed ^ Math.imul(handId + 1, 0xc2b2ae35)) >>> 0;
			const snapshot = structuredClone(game);
			const spots = [];
			const baseline = playReplayHand(
				game,
				config,
				seating,
				handId,
				handSeed,
				(state, player, role, index, choose) => {
					const action = choose(field[role]);
					const label = select(state, player, role, action);
					if (label != null) {
						if (typeof label !== "string" || !label.trim()) {
							throw new Error("Replay selector must return a nonempty label or null");
						}
						spots.push({
							index,
							label,
							role,
							seat: player.seatIndex,
							chips: player.chips,
							pot: state.pot,
							currentBet: state.currentBet,
							bigBlind: state.bigBlind,
							board: state.communityCards.slice(),
							holeCards: player.holeCards.slice(),
						});
					}
					return action;
				},
			);
			if (baseline.type === "game-over") {
				break;
			}
			const issue = getHandIssue(baseline);
			if (issue) {
				issues.push({ run: run + 1, handId, handSeed, ...issue });
				break;
			}
			for (const spot of spots) {
				const outcomes = Object.fromEntries(
					Object.entries(alternatives).map(([label, strategy]) => {
						const outcome = replayAlternative(
							snapshot,
							config,
							seating,
							handId,
							handSeed,
							baseline,
							spot,
							strategy,
						);
						if (outcome.issue) {
							issues.push({
								run: run + 1,
								handId,
								handSeed,
								action: spot.index + 1,
								alternative: label,
								...outcome.issue,
							});
						}
						return [label, outcome];
					}),
				);
				records.push({
					run: run + 1,
					handId,
					handSeed,
					action: spot.index + 1,
					role: spot.role,
					label: spot.label,
					board: spot.board,
					holeCards: spot.holeCards,
					pot: spot.pot,
					baseline: getOutcome(baseline, spot),
					alternatives: outcomes,
				});
			}
		}
	}
	return {
		formatVersion: 1,
		name,
		seed,
		runs,
		maxHands,
		startingChips,
		field,
		alternatives,
		strategyVersions,
		issues,
		summary: summarizeReplay(records, alternatives, seed),
		records,
	};
}

if (import.meta.main) {
	const { report, outputPath } = await runMatchupCommand(runMatchupReplay, "engine:replay");
	console.log(
		`replay=${report.name} spots=${report.records.length} issues=${report.issues.length} output=${outputPath}`,
	);
	if (report.issues.length > 0) {
		Deno.exitCode = 1;
	}
}
