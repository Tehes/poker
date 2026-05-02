/* ==================================================================================================
MODULE BOUNDARY: Browserless Engine Batch Runner
================================================================================================== */

// CURRENT STATE: Runs bot-only tournaments directly through the pure engine without launching a
// browser, static server, DevTools connection, DOM, or timers, then feeds captured engine/bot events
// through the shared speedmode analysis layer.
// TARGET STATE: Provide the fast structural and bot-quality batch runner for engine flow regressions.
// PUT HERE: Deno batch orchestration, bot action provider wiring, compact engine event summaries, and
// JSON report writing.
// DO NOT PUT HERE: Poker rules, bot heuristics, browser automation, DOM assumptions, or UI behavior.

import {
	createBotLineState,
	createHandContextState,
	createPlayerSpotState,
	INITIAL_BIG_BLIND,
	INITIAL_DECK,
	INITIAL_SMALL_BLIND,
	runEngineTournament,
} from "../js/gameEngine.js";
import { chooseBotAction, normalizeBotActionRequest, setBotDecisionSink } from "../js/bot.js";
import { getPlayerActionState } from "../js/shared/actionModel.js";
import {
	analyzeOutcomeLogs,
	analyzeRunDecisions,
	createEmptyMetrics,
	createEmptyOutcomeMetricsAccumulator,
	createMdfAnalysis,
	createPostflopLineReadAnalysis,
	finalizeOutcomeMetrics,
	incrementCount,
	mergeOutcomeMetrics,
	mergeRunMetrics,
	SPEEDMODE_EVENT_PREFIX,
} from "./speedmodeAnalysis.js";

const DEFAULT_RUN_COUNT = 100;
const DEFAULT_MAX_HANDS = 1000;
const DEFAULT_PLAYER_COUNT = 6;
const DEFAULT_STARTING_CHIPS = 2000;
const DEFAULT_OUTPUT_BASE = "tmp";
const DEFAULT_OUTPUT_PREFIX = "poker-engine-batch";

function formatTimestamp(date = new Date()) {
	const yyyy = String(date.getFullYear());
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	const hh = String(date.getHours()).padStart(2, "0");
	const min = String(date.getMinutes()).padStart(2, "0");
	const ss = String(date.getSeconds()).padStart(2, "0");
	return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function parsePositiveInteger(value, label) {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`Invalid ${label}: ${value}`);
	}
	return parsed;
}

function resolveOutputDir(outputDir) {
	const requestedOutputDir = outputDir || `${DEFAULT_OUTPUT_BASE}/${DEFAULT_OUTPUT_PREFIX}-${formatTimestamp()}`;
	const normalizedOutputDir = requestedOutputDir.replace(/\/+$/, "");
	if (normalizedOutputDir.startsWith("/")) {
		return normalizedOutputDir;
	}

	const normalizedCwd = Deno.cwd().replace(/\/+$/, "");
	const relativePath = normalizedOutputDir.replace(/^\.?\//, "");
	return `${normalizedCwd}/${relativePath}`;
}

function parseArgs(args) {
	const config = {
		runCount: DEFAULT_RUN_COUNT,
		maxHands: DEFAULT_MAX_HANDS,
		playerCount: DEFAULT_PLAYER_COUNT,
		startingChips: DEFAULT_STARTING_CHIPS,
		outputDir: null,
	};

	for (const arg of args) {
		if (arg === "--") {
			continue;
		} else if (arg.startsWith("--runs=")) {
			config.runCount = parsePositiveInteger(arg.slice(7), "runs");
		} else if (arg.startsWith("--max-hands=")) {
			config.maxHands = parsePositiveInteger(arg.slice(12), "max hands");
		} else if (arg.startsWith("--players=")) {
			config.playerCount = parsePositiveInteger(arg.slice(10), "players");
		} else if (arg.startsWith("--chips=")) {
			config.startingChips = parsePositiveInteger(arg.slice(8), "chips");
		} else if (arg.startsWith("--out=")) {
			config.outputDir = arg.slice(6);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}

	if (config.playerCount < 2) {
		throw new Error("Invalid players: at least 2 players are required");
	}

	return config;
}

function createStats() {
	return {
		hands: 0,
		handsWon: 0,
		vpip: 0,
		pfr: 0,
		calls: 0,
		aggressiveActs: 0,
		reveals: 0,
		showdowns: 0,
		showdownsWon: 0,
		folds: 0,
		foldsPreflop: 0,
		foldsPostflop: 0,
		allins: 0,
	};
}

function createBotPlayer(index, startingChips) {
	return {
		name: `Bot ${index + 1}`,
		isBot: true,
		seatSlot: index,
		winnerReactionEmoji: "",
		winnerReactionUntil: 0,
		isWinner: false,
		actionState: null,
		winProbability: null,
		lastNonFinalWinProbability: null,
		seatIndex: index,
		holeCards: [null, null],
		visibleHoleCards: [false, false],
		dealer: false,
		smallBlind: false,
		bigBlind: false,
		folded: false,
		chips: startingChips,
		allIn: false,
		totalBet: 0,
		roundBet: 0,
		stats: createStats(),
		botLine: createBotLineState(),
		spotState: createPlayerSpotState(),
	};
}

function createEngineBatchGameState({ playerCount, startingChips }) {
	const players = Array.from({ length: playerCount }, (_, index) => createBotPlayer(index, startingChips));
	return {
		currentPhaseIndex: 0,
		currentBet: 0,
		pot: 0,
		activeSeatIndex: null,
		handId: 0,
		nextDecisionId: 1,
		blindLevel: 0,
		gameStarted: true,
		gameFinished: false,
		openCardsMode: false,
		spectatorMode: true,
		raisesThisRound: 0,
		handInProgress: false,
		deck: INITIAL_DECK.slice(),
		cardGraveyard: [],
		communityCards: [],
		players,
		allPlayers: players.slice(),
		chipTransfer: null,
		pendingAction: null,
		smallBlind: INITIAL_SMALL_BLIND,
		bigBlind: INITIAL_BIG_BLIND,
		lastRaise: INITIAL_BIG_BLIND,
		handContext: createHandContextState(),
	};
}

function chooseEngineBotAction(gameState, player) {
	const decision = chooseBotAction(player, gameState);
	const actionRequest = normalizeBotActionRequest(decision);
	if (actionRequest) {
		return actionRequest;
	}

	const actionState = getPlayerActionState(gameState, player);
	return actionState.canCheck ? { action: "check" } : { action: "fold" };
}

async function ensureDirectory(path) {
	await Deno.mkdir(path, { recursive: true });
}

function formatSpeedmodeEventLine(event) {
	return `${SPEEDMODE_EVENT_PREFIX}${JSON.stringify(event)}`;
}

function createEmptyDecisionJoinCoverage() {
	return {
		totalDecisions: 0,
		joinedDecisions: 0,
		missingHandResult: 0,
		totalHands: 0,
		joinedHands: 0,
		missingHandResults: 0,
		pct: 0,
	};
}

function finalizeDecisionJoinCoverage(coverage) {
	return {
		...coverage,
		pct: coverage.totalDecisions > 0
			? Number(((coverage.joinedDecisions / coverage.totalDecisions) * 100).toFixed(2))
			: 100,
	};
}

function createEmptyEngineBatchMetrics() {
	return {
		decisionCount: 0,
		actionCounts: {},
		requestedActionCounts: {},
		phaseCounts: {},
		handCount: 0,
		showdownHands: 0,
		uncontestedHands: 0,
		playerBustCount: 0,
		tournamentEndCount: 0,
		stoppedCounts: {},
		decisionJoinCoverage: createEmptyDecisionJoinCoverage(),
	};
}

function analyzeEngineEvents(events, result) {
	const metrics = createEmptyEngineBatchMetrics();
	const handResultEvents = events.filter((event) => event.type === "hand_result");
	const handResultById = new Map(handResultEvents.map((event) => [event.handId, event]));

	metrics.handCount = handResultEvents.length;
	metrics.decisionJoinCoverage.totalHands = handResultEvents.length;
	metrics.decisionJoinCoverage.joinedHands = handResultEvents.length;

	for (const event of events) {
		if (event.type === "decision") {
			metrics.decisionCount += 1;
			metrics.decisionJoinCoverage.totalDecisions += 1;
			incrementCount(metrics.actionCounts, event.action);
			incrementCount(metrics.requestedActionCounts, event.requestedAction ?? "unknown");
			incrementCount(metrics.phaseCounts, event.phase);
			if (handResultById.has(event.handId)) {
				metrics.decisionJoinCoverage.joinedDecisions += 1;
			} else {
				metrics.decisionJoinCoverage.missingHandResult += 1;
			}
		} else if (event.type === "hand_result") {
			if (event.hadShowdown) {
				metrics.showdownHands += 1;
			} else {
				metrics.uncontestedHands += 1;
			}
		} else if (event.type === "player_bust") {
			metrics.playerBustCount += 1;
		} else if (event.type === "tournament_end") {
			metrics.tournamentEndCount += 1;
		}
	}

	if (result.type !== "game-over") {
		incrementCount(metrics.stoppedCounts, result.type);
	}
	metrics.decisionJoinCoverage = finalizeDecisionJoinCoverage(metrics.decisionJoinCoverage);
	return metrics;
}

function mergeDecisionJoinCoverage(target, source) {
	target.totalDecisions += source.totalDecisions;
	target.joinedDecisions += source.joinedDecisions;
	target.missingHandResult += source.missingHandResult;
	target.totalHands += source.totalHands;
	target.joinedHands += source.joinedHands;
	target.missingHandResults += source.missingHandResults;
	target.pct = 0;
}

function mergeEngineBatchMetrics(target, source) {
	target.decisionCount += source.decisionCount;
	target.handCount += source.handCount;
	target.showdownHands += source.showdownHands;
	target.uncontestedHands += source.uncontestedHands;
	target.playerBustCount += source.playerBustCount;
	target.tournamentEndCount += source.tournamentEndCount;
	mergeDecisionJoinCoverage(target.decisionJoinCoverage, source.decisionJoinCoverage);

	for (const [key, value] of Object.entries(source.actionCounts)) {
		incrementCount(target.actionCounts, key, value);
	}
	for (const [key, value] of Object.entries(source.requestedActionCounts)) {
		incrementCount(target.requestedActionCounts, key, value);
	}
	for (const [key, value] of Object.entries(source.phaseCounts)) {
		incrementCount(target.phaseCounts, key, value);
	}
	for (const [key, value] of Object.entries(source.stoppedCounts)) {
		incrementCount(target.stoppedCounts, key, value);
	}
}

function summarizePlayers(players) {
	return players.map((player) => ({
		name: player.name,
		seatIndex: player.seatIndex,
		chips: player.chips,
		isWinner: player.isWinner,
		hands: player.stats?.hands ?? 0,
		handsWon: player.stats?.handsWon ?? 0,
	}));
}

async function runSingleEngineBatch(config, runIndex, outputDir) {
	const runLabel = String(runIndex).padStart(2, "0");
	const gameState = createEngineBatchGameState(config);
	const engineEvents = [];
	const speedmodeEvents = [];
	const startedAt = Date.now();
	let result = null;

	console.log(`run ${runLabel}: engine`);
	setBotDecisionSink((decision) => {
		speedmodeEvents.push({ type: "bot_decision", ...decision });
	});
	try {
		result = runEngineTournament(gameState, chooseEngineBotAction, {
			eventSink: (event) => {
				engineEvents.push(event);
				if (event.type === "hand_start" || event.type === "hand_result") {
					speedmodeEvents.push(event);
				}
			},
			maxHands: config.maxHands,
		});
	} finally {
		setBotDecisionSink(null);
	}
	const elapsedMs = Date.now() - startedAt;
	const speedmodeLogs = speedmodeEvents.map(formatSpeedmodeEventLine);
	const runOutcome = analyzeOutcomeLogs(speedmodeLogs);
	const metrics = analyzeRunDecisions(runOutcome.decisions, runOutcome.hands);
	const engineMetrics = analyzeEngineEvents(engineEvents, result);
	const champion = result.champion?.name ?? null;
	const logPath = `${outputDir}/run-${runLabel}.log`;
	const summaryPath = `${outputDir}/run-${runLabel}.json`;
	const detailsPath = `${outputDir}/run-${runLabel}.details.json`;
	const players = summarizePlayers(gameState.players);

	await Deno.writeTextFile(logPath, speedmodeLogs.join("\n"));
	await Deno.writeTextFile(
		summaryPath,
		JSON.stringify(
			{
				run: runIndex,
				type: result.type,
				champion,
				elapsedMs,
				handCount: result.handCount,
				eventCount: engineEvents.length,
				logCount: speedmodeLogs.length,
				players,
				metrics,
				analysis: {
					postflop: {
						mdf: createMdfAnalysis(metrics.postflop.mdf),
						lineReads: createPostflopLineReadAnalysis(metrics.postflop),
					},
				},
				outcomeMetrics: runOutcome.metrics,
				engineMetrics,
			},
			null,
			2,
		),
	);
	await Deno.writeTextFile(
		detailsPath,
		JSON.stringify(
			{
				run: runIndex,
				type: result.type,
				champion,
				elapsedMs,
				engineEvents,
				speedmodeEvents,
				hands: runOutcome.hands,
				decisions: runOutcome.decisions,
				outcomeMetrics: runOutcome.metrics,
				players,
			},
			null,
			2,
		),
	);

	console.log(
		`run ${runLabel}: done type=${result.type} champion=${
			champion ?? "none"
		} hands=${result.handCount} decisions=${metrics.decisionCount}`,
	);

	return {
		run: runIndex,
		type: result.type,
		champion,
		elapsedMs,
		handCount: result.handCount,
		eventCount: engineEvents.length,
		logCount: speedmodeLogs.length,
		logPath,
		summaryPath,
		detailsPath,
		metrics,
		rawOutcomeMetrics: runOutcome.rawMetrics,
		outcomeMetrics: runOutcome.metrics,
		engineMetrics,
	};
}

async function main() {
	const args = parseArgs(Deno.args);
	const projectRootUrl = new URL("../", import.meta.url);
	const projectRootPath = Deno.realPathSync(projectRootUrl);
	const outputDir = resolveOutputDir(args.outputDir);
	const aggregateMetrics = createEmptyMetrics();
	const aggregateOutcomeMetrics = createEmptyOutcomeMetricsAccumulator();
	const aggregateEngineMetrics = createEmptyEngineBatchMetrics();
	const champions = {};
	const runSummaries = [];
	const startedAt = Date.now();

	await ensureDirectory(outputDir);

	for (let runIndex = 1; runIndex <= args.runCount; runIndex++) {
		const runSummary = await runSingleEngineBatch(args, runIndex, outputDir);
		runSummaries.push(runSummary);
		if (runSummary.champion) {
			incrementCount(champions, runSummary.champion);
		}
		mergeRunMetrics(aggregateMetrics, runSummary.metrics);
		mergeOutcomeMetrics(aggregateOutcomeMetrics, runSummary.rawOutcomeMetrics);
		mergeEngineBatchMetrics(aggregateEngineMetrics, runSummary.engineMetrics);
	}

	aggregateEngineMetrics.decisionJoinCoverage = finalizeDecisionJoinCoverage(
		aggregateEngineMetrics.decisionJoinCoverage,
	);
	const elapsedMs = Date.now() - startedAt;
	const outcomeMetrics = finalizeOutcomeMetrics(aggregateOutcomeMetrics);
	const summary = {
		generatedAt: new Date().toISOString(),
		config: {
			mode: "engine-batch",
			runCount: args.runCount,
			maxHands: args.maxHands,
			playerCount: args.playerCount,
			startingChips: args.startingChips,
			outputDir,
			projectRootPath,
		},
		elapsedMs,
		champions,
		runs: runSummaries.map((runSummary) => ({
			run: runSummary.run,
			type: runSummary.type,
			champion: runSummary.champion,
			elapsedMs: runSummary.elapsedMs,
			handCount: runSummary.handCount,
			eventCount: runSummary.eventCount,
			logCount: runSummary.logCount,
			logPath: runSummary.logPath,
			summaryPath: runSummary.summaryPath,
			detailsPath: runSummary.detailsPath,
		})),
		metrics: aggregateMetrics,
		analysis: {
			postflop: {
				mdf: createMdfAnalysis(aggregateMetrics.postflop.mdf),
				lineReads: createPostflopLineReadAnalysis(aggregateMetrics.postflop),
			},
		},
		outcomeMetrics,
		engineMetrics: aggregateEngineMetrics,
	};

	await Deno.writeTextFile(`${outputDir}/summary.json`, JSON.stringify(summary, null, 2));

	console.log(`runs=${args.runCount}`);
	console.log(`hands=${aggregateEngineMetrics.handCount}`);
	console.log(`decisions=${aggregateMetrics.decisionCount}`);
	console.log(
		`decision_join_coverage=${outcomeMetrics.decisionJoinCoverage.joinedDecisions}/${outcomeMetrics.decisionJoinCoverage.totalDecisions}`,
	);
	console.log(`preflop_spots=${aggregateMetrics.preflop.decisions}`);
	console.log(`postflop_spots=${aggregateMetrics.postflopSpots}`);
	console.log(`postflop_made_hand_folds=${aggregateMetrics.postflop.madeHandFoldCount}`);
	console.log(`preflop_premium_folds=${aggregateMetrics.preflop.premiumFoldCount}`);
	console.log(`bluff_raises_with_made_hand=${aggregateMetrics.postflop.bluffRaiseClassCounts["made-hand"] ?? 0}`);
	console.log(`showdown_hands=${aggregateEngineMetrics.showdownHands}`);
	console.log(`uncontested_hands=${aggregateEngineMetrics.uncontestedHands}`);
	console.log(`player_busts=${aggregateEngineMetrics.playerBustCount}`);
	console.log(`output_dir=${outputDir}`);
}

await main();
