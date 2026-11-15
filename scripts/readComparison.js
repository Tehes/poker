import * as candidateBot from "../js/bot.js";
import { getPlayerTournamentPlacement, INITIAL_DECK, runEngineTournament } from "../js/gameEngine.js";
import { addTournamentToProfile, createEmptyPlayerProfile, getPlayerReadHistory } from "../js/playerProfile.js";
import { getPlayerActionState } from "../js/shared/actionModel.js";
import { createEngineBatchGameState } from "./engineBatch.js";
import { analyzeRunDecisions } from "./speedmodeAnalysis.js";

const VARIANTS = ["baseline", "individual", "history"];
const STYLES = ["normal", "tight", "calling", "aggressive", "changed"];

function createRandom(seed) {
	let state = seed >>> 0;
	return () => {
		state += 0x6D2B79F5;
		let value = Math.imul(state ^ state >>> 15, state | 1);
		value ^= value + Math.imul(value ^ value >>> 7, value | 61);
		return ((value ^ value >>> 14) >>> 0) / 4294967296;
	};
}

function chooseWithRandom(bot, player, state, seed) {
	const originalRandom = Math.random;
	Math.random = createRandom(seed);
	try {
		return bot.normalizeBotActionRequest(bot.chooseBotAction(player, state));
	} finally {
		Math.random = originalRandom;
	}
}

function chooseStyledAction(request, state, player, style, random) {
	const action = getPlayerActionState(state, player);
	if (style === "tight" && request.action === "call" && random() < 0.55) {
		return { action: "fold" };
	}
	if (style === "calling") {
		if (request.action === "raise" && random() < 0.75) {
			return { action: action.canCheck ? "check" : "call" };
		}
		if (request.action === "fold" && action.needToCall <= player.chips * 0.12 && random() < 0.65) {
			return { action: "call" };
		}
	}
	if (style === "aggressive" && request.action === "check" && random() < 0.55) {
		const amount = Math.max(action.minRaise, state.bigBlind * 3);
		if (amount <= action.maxRaiseAmount && amount <= player.chips * 0.2) {
			return { action: "raise", amount };
		}
	}
	return request;
}

export function runComparisonTournament({ baselineBot, variant, style, seed, heroSeat, targetSeat, history }) {
	const state = createEngineBatchGameState({ playerCount: 6, startingChips: 2000 });
	const hero = state.allPlayers[heroSeat];
	const target = state.allPlayers[targetSeat];
	target.isBot = false;
	if (variant === "history") {
		target.readHistory = history;
	}
	const decisions = [];
	const decisionNumbers = new Map();
	let placement = null;
	let targetPlacement = null;
	let heroHandsObserved = 0;
	let targetHandsObserved = 0;
	let shuffleNumber = 0;
	const onDecision = (decision) => {
		if (decision.seatIndex === heroSeat) {
			decisions.push(decision);
		}
	};
	baselineBot.setBotDecisionSink(onDecision);
	candidateBot.setBotDecisionSink(onDecision);
	let result;
	try {
		result = runEngineTournament(state, (gameState, player) => {
			const key = `${gameState.handId}:${player.seatIndex}:${gameState.currentPhaseIndex}`;
			const number = decisionNumbers.get(key) ?? 0;
			decisionNumbers.set(key, number + 1);
			const decisionSeed = seed ^ Math.imul(gameState.handId + 1, 73856093) ^
				Math.imul(player.seatIndex + 1, 19349663) ^ Math.imul(gameState.currentPhaseIndex + 1, 83492791) ^
				number;
			const bot = player === hero && variant !== "baseline" ? candidateBot : baselineBot;
			const request = chooseWithRandom(bot, player, gameState, decisionSeed);
			return player === target
				? chooseStyledAction(request, gameState, player, style, createRandom(decisionSeed ^ 0x71A5))
				: request;
		}, {
			maxHands: 1000,
			dealerRandomValue: createRandom(seed ^ 0xD3A1)(),
			shuffleFn: () => {
				// Canonical card order keeps each hand's deck independent of earlier action paths.
				const cards = INITIAL_DECK.slice();
				const random = createRandom(seed ^ Math.imul(++shuffleNumber, 2654435761));
				for (let index = cards.length - 1; index > 0; index--) {
					const other = Math.floor(random() * (index + 1));
					[cards[index], cards[other]] = [cards[other], cards[index]];
				}
				return cards;
			},
			eventSink: (event) => {
				if (event.type === "hand_start") {
					heroHandsObserved += event.players.some((player) => player.seatIndex === heroSeat) ? 1 : 0;
					targetHandsObserved += event.players.some((player) => player.seatIndex === targetSeat) ? 1 : 0;
				}
				if (event.type === "hand_result") {
					if (placement === null) {
						placement = getPlayerTournamentPlacement(state.players, hero);
					}
					if (targetPlacement === null) {
						targetPlacement = getPlayerTournamentPlacement(state.players, target);
					}
				}
			},
		});
	} finally {
		baselineBot.setBotDecisionSink(null);
		candidateBot.setBotDecisionSink(null);
	}
	if (result.type !== "game-over" || placement === null) {
		throw new Error(`Comparison stopped: ${result.type}, seed ${seed}`);
	}
	if (hero.stats.hands !== heroHandsObserved || target.stats.hands !== targetHandsObserved) {
		throw new Error(`History changed live hand counters, seed ${seed}`);
	}
	const metrics = analyzeRunDecisions(decisions, []);
	const earlyReads = decisions.filter((decision) => decision.handId < 10).flatMap((decision) =>
		(decision.opponentReads ?? []).filter((read) => read.seatIndex === targetSeat)
	);
	return {
		seed,
		heroSeat,
		targetSeat,
		placement,
		targetPlacement,
		win: placement === 1 ? 1 : 0,
		hands: hero.stats.hands,
		targetStats: { ...target.stats },
		decisions: decisions.length,
		earlyReadWeight: earlyReads.length > 0
			? earlyReads.reduce((sum, read) => sum + read.weight, 0) / earlyReads.length
			: null,
		historicalHands: target.readHistory?.hands ?? 0,
		safety: {
			premiumFolds: metrics.preflop.premiumFoldCount,
			madeHandBluffRaises: metrics.postflop.bluffRaiseClassCounts["made-hand"] ?? 0,
			lowEdgeAllInReraises: metrics.postflop.reraises.allInLowEdgeCount,
		},
		safetyExamples: {
			premiumFolds: metrics.examples.preflopPremiumFold,
			madeHandBluffRaises: metrics.examples.bluffRaiseMadeHand,
			lowEdgeAllInReraises: metrics.examples.postflopAllInReraiseLowEdge,
		},
	};
}

function summarize(runs) {
	return {
		tournaments: runs.length,
		winPct: runs.reduce((sum, run) => sum + run.win, 0) / runs.length * 100,
		averagePlacement: runs.reduce((sum, run) => sum + run.placement, 0) / runs.length,
		averageHands: runs.reduce((sum, run) => sum + run.hands, 0) / runs.length,
		earlyReadWeight: runs[0].earlyReadWeight === null
			? null
			: runs.reduce((sum, run) => sum + run.earlyReadWeight, 0) / runs.length,
		safety: Object.fromEntries(
			Object.keys(runs[0].safety).map((key) => [
				key,
				runs.reduce((sum, run) => sum + run.safety[key], 0),
			]),
		),
	};
}

function pairedDifference(reference, candidate, key, scale = 1) {
	const differences = reference.map((run, index) => (candidate[index][key] - run[key]) * scale);
	const mean = differences.reduce((sum, difference) => sum + difference, 0) / differences.length;
	const variance = differences.reduce((sum, difference) => sum + (difference - mean) ** 2, 0) /
		(differences.length - 1);
	const margin = 1.96 * Math.sqrt(variance / differences.length);
	return { difference: mean, interval95: [mean - margin, mean + margin] };
}

async function hashFile(path) {
	const digest = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
	return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function main() {
	const config = {
		runs: 300,
		seed: 100001,
		out: `tmp/poker-read-comparison-${new Date().toISOString().replace(/[:.]/g, "-")}`,
		baseline: null,
	};
	for (const arg of Deno.args) {
		if (arg === "--") {
			continue;
		}
		const [key, value] = arg.replace(/^--/, "").split("=");
		if (key === "runs" || key === "seed") {
			config[key] = Number(value);
		} else if (key === "out" || key === "baseline") {
			config[key] = value;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	if (!config.baseline || !Number.isInteger(config.runs) || config.runs < 2 || !Number.isInteger(config.seed)) {
		throw new Error(
			"Use --baseline=/path/to/accepted/js/bot.js --runs=300 --seed=100001 --out=/tmp/read-comparison",
		);
	}
	const baselineUrl = new URL("file:///");
	baselineUrl.pathname = Deno.realPathSync(config.baseline);
	const baselineBot = await import(baselineUrl.href);
	await Deno.mkdir(config.out, { recursive: true });
	const report = {
		config,
		sources: {
			baselineBot: await hashFile(baselineUrl),
			candidateBot: await hashFile(new URL("../js/bot.js", import.meta.url)),
		},
		scenarios: {},
		pooled: {},
	};
	const pooled = Object.fromEntries(VARIANTS.map((variant) => [variant, []]));
	for (const style of STYLES) {
		let profile = createEmptyPlayerProfile();
		const trainingStyle = style === "changed" ? "tight" : style;
		const playingStyle = style === "changed" ? "aggressive" : style;
		for (let index = 0; index < 10; index++) {
			const run = runComparisonTournament({
				baselineBot,
				variant: "baseline",
				style: trainingStyle,
				seed: index + 1,
				heroSeat: index % 6,
				targetSeat: (index + 1) % 6,
			});
			profile = addTournamentToProfile(profile, {
				id: `training-${index}`,
				finishedAt: index + 1,
				participantCount: 6,
				placement: run.targetPlacement,
				stats: run.targetStats,
			});
		}
		const history = getPlayerReadHistory(profile);
		const runs = Object.fromEntries(VARIANTS.map((variant) => [variant, []]));
		for (let index = 0; index < config.runs; index++) {
			const seed = config.seed + STYLES.indexOf(style) * 1000000 + index;
			const heroSeat = index % 6;
			const targetSeat = (heroSeat + 1 + Math.floor(index / 6) % 5) % 6;
			for (const variant of VARIANTS) {
				const run = runComparisonTournament({
					baselineBot,
					variant,
					style: playingStyle,
					seed,
					heroSeat,
					targetSeat,
					history,
				});
				runs[variant].push(run);
				pooled[variant].push(run);
			}
			if ((index + 1) % 100 === 0) {
				console.log(`${style}: ${index + 1}/${config.runs} paired sets`);
			}
		}
		const comparisons = {};
		for (
			const [reference, candidate] of [["baseline", "individual"], ["individual", "history"], [
				"baseline",
				"history",
			]]
		) {
			comparisons[`${candidate}-vs-${reference}`] = {
				winPercentagePoints: pairedDifference(runs[reference], runs[candidate], "win", 100),
				placement: pairedDifference(runs[reference], runs[candidate], "placement"),
			};
		}
		report.scenarios[style] = {
			trainingStyle,
			playingStyle,
			historicalHands: history.hands,
			historyStats: history,
			variants: Object.fromEntries(VARIANTS.map((variant) => [variant, summarize(runs[variant])])),
			comparisons,
		};
		await Deno.writeTextFile(`${config.out}/${style}.json`, JSON.stringify(runs, null, 2));
		await Deno.writeTextFile(`${config.out}/summary.json`, JSON.stringify(report, null, 2));
		console.log(JSON.stringify({ style, ...report.scenarios[style] }));
	}
	for (const variant of VARIANTS) {
		report.pooled[variant] = summarize(pooled[variant]);
	}
	for (
		const [reference, candidate] of [["baseline", "individual"], ["individual", "history"], ["baseline", "history"]]
	) {
		report.pooled[`${candidate}-vs-${reference}`] = {
			winPercentagePoints: pairedDifference(pooled[reference], pooled[candidate], "win", 100),
			placement: pairedDifference(pooled[reference], pooled[candidate], "placement"),
		};
	}
	await Deno.writeTextFile(`${config.out}/summary.json`, JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report.pooled));
}

if (import.meta.main) {
	await main();
}
