import { normalizeBotActionRequest, setBotDecisionSink } from "../js/bot.js";
import { runEngineTournament } from "../js/gameEngine.js";
import { createEngineBatchGameState } from "./engineBatch.js";

export function createRandom(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = Math.imul(state ^ (state >>> 15), state | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

export function shuffleMatchupDeck(deck, random) {
	// The cards return in a different order after divergent betting lines.
	deck.sort();
	for (let i = deck.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[deck[i], deck[j]] = [deck[j], deck[i]];
	}
	return deck;
}

export function getPostflopBettingLine(actions, phaseIndex) {
	const line = { flop: null, turn: null };
	if (phaseIndex < 2) {
		return line;
	}
	for (let i = actions.length - 1; i >= 0; i--) {
		const { phase, player, resolvedAction } = actions[i];
		if (phase === "preflop") {
			break;
		}
		if (
			(phase === "flop" || (phase === "turn" && phaseIndex === 3)) && line[phase] === null &&
			resolvedAction.actionMeta.aggressive
		) {
			line[phase] = player.seatIndex;
		}
	}
	return line;
}

export function chooseSeededAction(strategy, player, state, random, line) {
	const original = Math.random;
	// Existing bot modules draw from Math.random. Give each seat its own stream.
	Math.random = random;
	try {
		return normalizeBotActionRequest(strategy(player, state, line));
	} finally {
		Math.random = original;
	}
}

function validateConfig({ seed, runs, startingChips, maxHands, lineups, strategies, classifySpot }) {
	if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
		throw new Error("seed must be an unsigned 32-bit integer");
	}
	if (![runs, startingChips, maxHands].every((value) => Number.isSafeInteger(value) && value > 0)) {
		throw new Error("runs, startingChips and maxHands must be positive integers");
	}
	if (classifySpot !== undefined && typeof classifySpot !== "function") {
		throw new Error("classifySpot must be a function");
	}

	const entries = Object.entries(lineups ?? {});
	const roles = Object.keys(entries[0]?.[1] ?? {});
	if (roles.length < 2 || roles.length > 6) {
		throw new Error("Lineups need two to six named roles");
	}
	for (const [name, lineup] of entries) {
		if (Object.keys(lineup).length !== roles.length || roles.some((role) => !Object.hasOwn(lineup, role))) {
			throw new Error(`Lineup "${name}" must have the same roles as the first lineup`);
		}
		for (const strategy of Object.values(lineup)) {
			if (
				typeof strategy !== "string" || !Object.hasOwn(strategies ?? {}, strategy) ||
				typeof strategies[strategy] !== "function"
			) {
				throw new Error(`Unknown strategy "${strategy}" in lineup "${name}"`);
			}
		}
	}
	return roles;
}

function createRoleReport(strategy) {
	return { strategy, hands: 0, wins: 0, netBb: 0, vpip: 0, pfr: 0, spots: Object.create(null) };
}

function addSpot(report, label, action, count, netBb) {
	const actions = report.spots[label] ??= Object.create(null);
	const spot = actions[action] ??= { count: 0, netBb: 0 };
	spot.count += count;
	spot.netBb += netBb;
}

function runMatchup(config, lineup, roles, index, capture) {
	const runSeed = (config.seed + Math.imul(index, 0x9e3779b9)) >>> 0;
	const deckRandom = createRandom(runSeed);
	const seating = roles.map((_, seat) => roles[(seat + index) % roles.length]);
	const roleReports = Object.fromEntries(roles.map((role) => [role, createRoleReport(lineup[role])]));
	const seatRandoms = seating.map((_, seat) => createRandom(runSeed ^ Math.imul(seat + 1, 0x85ebca6b)));
	const game = createEngineBatchGameState({ playerCount: roles.length, startingChips: config.startingChips });
	const observedDecisions = new Map();
	const decisions = [];
	const payoutMismatches = [];
	let decisionId = 0;
	let handSeats;
	let bigBlind;

	const result = runEngineTournament(game, (state, player, _step, { actions }) => {
		const role = seating[player.seatIndex];
		const line = getPostflopBettingLine(actions, state.currentPhaseIndex);
		const label = config.classifySpot?.(state, player, role, line);
		if (label != null && (typeof label !== "string" || label.length === 0)) {
			throw new Error("A spot label must be a nonempty string");
		}
		decisionId++;
		const { seatIndex, totalBet: investedBefore } = player;
		const strategy = config.strategies[lineup[role]];
		const random = seatRandoms[seatIndex];
		let action;
		let context;
		if (capture?.role === role) {
			setBotDecisionSink((decision) => {
				context = capture.project(decision, state, player, seating, lineup);
			});
			try {
				action = chooseSeededAction(strategy, player, state, random, line);
			} finally {
				setBotDecisionSink(null);
			}
			if (!context) {
				throw new Error(`Strategy "${lineup[role]}" did not log a decision for "${role}"`);
			}
		} else {
			action = chooseSeededAction(strategy, player, state, random, line);
		}
		if (!action) {
			throw new Error(`Strategy "${lineup[role]}" returned an invalid action for "${role}"`);
		}
		if (label != null || context) {
			observedDecisions.set(decisionId, { role, label, seatIndex, investedBefore, context });
		}
		return { ...action, decisionId };
	}, {
		maxHands: config.maxHands,
		shuffleFn: (deck) => shuffleMatchupDeck(deck, deckRandom),
		eventSink: (event) => {
			if (event.type === "hand_start") {
				handSeats = event.players.map((player) => player.seatIndex);
				bigBlind = event.bigBlind;
			} else if (event.type === "decision") {
				const observed = observedDecisions.get(event.decisionId);
				if (observed) {
					observed.action = event.action;
					observed.amount = event.amount;
				}
			} else if (event.type === "hand_result") {
				const paid = Object.values(event.totalPayoutBySeatIndex).reduce((sum, amount) => sum + amount, 0);
				if (paid !== event.totalPot) {
					payoutMismatches.push({ handId: event.handId, pot: event.totalPot, paid, bigBlind });
				}
				for (const seat of handSeats) {
					const report = roleReports[seating[seat]];
					report.hands++;
					report.netBb += ((event.totalPayoutBySeatIndex[seat] ?? 0) -
						(event.totalBetBySeatIndex[seat] ?? 0)) / bigBlind;
				}
				for (
					const [id, { role, label, seatIndex, investedBefore, context, action, amount }] of observedDecisions
				) {
					if (action === undefined) {
						throw new Error(`No resolved action for observed decision ${id}`);
					}
					const netChips = (event.totalPayoutBySeatIndex[seatIndex] ?? 0) -
						(event.totalBetBySeatIndex[seatIndex] ?? 0) + investedBefore;
					if (label != null) {
						addSpot(roleReports[role], label, action, 1, netChips / bigBlind);
					}
					if (context) {
						decisions.push({
							id,
							handId: event.handId,
							seatIndex,
							action,
							amount,
							netChips,
							bigBlind,
							context,
						});
					}
				}
				observedDecisions.clear();
			}
		},
	});

	if (result.type !== "game-over" && result.type !== "max-hands") {
		throw new Error(`Matchup stopped with "${result.type}" in run ${index + 1}`);
	}
	for (const player of game.allPlayers) {
		const report = roleReports[seating[player.seatIndex]];
		report.vpip = player.stats.vpip;
		report.pfr = player.stats.pfr;
	}
	const winner = result.champion ? seating[result.champion.seatIndex] : null;
	if (winner !== null) {
		roleReports[winner].wins = 1;
	}
	return {
		match: {
			run: index + 1,
			seed: runSeed,
			seating,
			type: result.type,
			winner,
			payoutMismatches,
			roles: roleReports,
		},
		decisions,
	};
}

export function* iterateDiagnosticPairs({ startingChips = 2000, maxHands = 1000, ...options }, capture) {
	const config = { startingChips, maxHands, ...options };
	const roles = validateConfig(config);
	if (!roles.includes(capture.role) || typeof capture.project !== "function") {
		throw new Error("Diagnostics need a known role and a decision projection");
	}
	const { reference, mixed } = config.lineups;
	if (!Object.hasOwn(config.lineups, "reference") || !Object.hasOwn(config.lineups, "mixed")) {
		throw new Error("Diagnostics need reference and mixed lineups");
	}
	for (let index = 0; index < config.runs; index++) {
		yield {
			reference: runMatchup(config, reference, roles, index, capture),
			mixed: runMatchup(config, mixed, roles, index, capture),
		};
	}
}

export function runMatchupBatch({
	seed,
	runs,
	startingChips = 2000,
	maxHands = 1000,
	strategies,
	lineups,
	classifySpot,
}) {
	const config = { seed, runs, startingChips, maxHands, strategies, lineups, classifySpot };
	const roles = validateConfig(config);
	const results = Object.fromEntries(
		Object.entries(lineups).map(([name, lineup]) => {
			const totals = Object.fromEntries(roles.map((role) => [role, createRoleReport(lineup[role])]));
			const matches = [];
			for (let index = 0; index < runs; index++) {
				const { match } = runMatchup(config, lineup, roles, index);
				matches.push(match);
				for (const [role, result] of Object.entries(match.roles)) {
					const total = totals[role];
					total.hands += result.hands;
					total.wins += result.wins;
					total.netBb += result.netBb;
					total.vpip += result.vpip;
					total.pfr += result.pfr;
					for (const [label, actions] of Object.entries(result.spots)) {
						for (const [action, spot] of Object.entries(actions)) {
							addSpot(total, label, action, spot.count, spot.netBb);
						}
					}
				}
			}
			return [name, { roles: totals, runs: matches }];
		}),
	);
	return { seed, runs, startingChips, maxHands, lineups, results };
}

export async function fileSha256(path) {
	const digest = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function runMatchupCommand(run, task) {
	const [configPath, outputPath, ...extra] = Deno.args.filter((arg) => arg !== "--");
	if (!configPath || !outputPath || extra.length > 0) {
		throw new Error(`Usage: deno task ${task} <config.js> <output.json>`);
	}
	const projectUrl = new URL("../", import.meta.url);
	const configUrl = new URL(configPath, projectUrl);
	const outputUrl = new URL(outputPath, projectUrl);
	if (configUrl.protocol !== "file:" || outputUrl.protocol !== "file:") {
		throw new Error("Matchup configuration and output must be local files");
	}
	const configSha256 = await fileSha256(configUrl);
	const { default: config } = await import(configUrl.href);
	const report = run(config);
	await Deno.mkdir(new URL(".", outputUrl), { recursive: true });
	await Deno.writeTextFile(outputUrl, JSON.stringify({ configPath, configSha256, ...report }, null, 2), {
		createNew: true,
	});
	return { report, outputPath };
}

if (import.meta.main) {
	const { report, outputPath } = await runMatchupCommand(runMatchupBatch, "engine:matchup");
	const mismatches = Object.values(report.results).flatMap((lineup) => lineup.runs)
		.reduce((count, run) => count + run.payoutMismatches.length, 0);
	console.log(
		`lineups=${
			Object.keys(report.lineups).length
		} runs_per_lineup=${report.runs} payout_mismatches=${mismatches} output=${outputPath}`,
	);
}
