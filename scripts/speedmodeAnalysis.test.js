import { getPlayerStatsRates } from "../js/gameEngine.js";
import {
	analyzeRunDecisions,
	createEmptyMetrics,
	createEmptyPlayerStatsMetrics,
	finalizePlayerStatsMetrics,
	mergePlayerStatsMetrics,
	mergeRunMetrics,
} from "./speedmodeAnalysis.js";

function assertEquals(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Expected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
	}
}

Deno.test("player stats rates use the shared hand and flop denominators", () => {
	assertEquals(
		getPlayerStatsRates({
			hands: 10,
			flopsSeen: 4,
			showdowns: 2,
			threeBets: 3,
			threeBetOpportunities: 10,
			foldsToThreeBet: 2,
			foldToThreeBetOpportunities: 4,
			raisesFirstIn: 3,
			raiseFirstInOpportunities: 6,
			stealAttempts: 1,
			stealOpportunities: 4,
			foldsBigBlindToSteal: 3,
			bigBlindStealOpportunities: 5,
			flopCbets: 3,
			flopCbetOpportunities: 4,
			foldsToFlopCbet: 1,
			foldToFlopCbetOpportunities: 4,
			calls: 2,
			aggressiveActs: 5,
		}),
		{
			flopSeenPct: 40,
			wtsdPct: 50,
			threeBetPct: 30,
			foldToThreeBetPct: 50,
			raiseFirstInPct: 50,
			attemptToStealPct: 25,
			foldBigBlindToStealPct: 60,
			flopCbetPct: 75,
			foldToFlopCbetPct: 25,
			aggressionFactor: 2.5,
		},
	);
});

Deno.test("player stats rates distinguish missing samples from observed zero", () => {
	const empty = createEmptyPlayerStatsMetrics();
	const before = { ...empty };
	assertEquals(finalizePlayerStatsMetrics(empty).rates, {
		flopSeenPct: null,
		wtsdPct: null,
		threeBetPct: null,
		foldToThreeBetPct: null,
		raiseFirstInPct: null,
		attemptToStealPct: null,
		foldBigBlindToStealPct: null,
		flopCbetPct: null,
		foldToFlopCbetPct: null,
		aggressionFactor: null,
	});
	assertEquals(empty, before);
	assertEquals(getPlayerStatsRates({ ...empty, hands: 10, threeBetOpportunities: 10 }), {
		flopSeenPct: 0,
		wtsdPct: null,
		threeBetPct: 0,
		foldToThreeBetPct: null,
		raiseFirstInPct: null,
		attemptToStealPct: null,
		foldBigBlindToStealPct: null,
		flopCbetPct: null,
		foldToFlopCbetPct: null,
		aggressionFactor: null,
	});
});

Deno.test("player stats aggregate raw observations instead of averaging percentages", () => {
	const first = Object.freeze({
		hands: 10,
		flopsSeen: 2,
		showdowns: 1,
		threeBets: 1,
		threeBetOpportunities: 2,
		foldsToThreeBet: 1,
		foldToThreeBetOpportunities: 2,
		raisesFirstIn: 1,
		raiseFirstInOpportunities: 2,
		stealAttempts: 1,
		stealOpportunities: 2,
		foldsBigBlindToSteal: 1,
		bigBlindStealOpportunities: 2,
		flopCbets: 1,
		flopCbetOpportunities: 2,
		foldsToFlopCbet: 1,
		foldToFlopCbetOpportunities: 2,
		calls: 2,
		aggressiveActs: 1,
	});
	const second = Object.freeze({
		hands: 200,
		flopsSeen: 90,
		showdowns: 9,
		threeBets: 9,
		threeBetOpportunities: 90,
		foldsToThreeBet: 9,
		foldToThreeBetOpportunities: 90,
		raisesFirstIn: 9,
		raiseFirstInOpportunities: 90,
		stealAttempts: 9,
		stealOpportunities: 90,
		foldsBigBlindToSteal: 9,
		bigBlindStealOpportunities: 90,
		flopCbets: 9,
		flopCbetOpportunities: 90,
		foldsToFlopCbet: 9,
		foldToFlopCbetOpportunities: 90,
		calls: 90,
		aggressiveActs: 9,
	});
	const total = createEmptyPlayerStatsMetrics();
	mergePlayerStatsMetrics(total, finalizePlayerStatsMetrics(first));
	mergePlayerStatsMetrics(total, finalizePlayerStatsMetrics(second));
	assertEquals(finalizePlayerStatsMetrics(total), {
		hands: 210,
		flopsSeen: 92,
		showdowns: 10,
		threeBets: 10,
		threeBetOpportunities: 92,
		foldsToThreeBet: 10,
		foldToThreeBetOpportunities: 92,
		raisesFirstIn: 10,
		raiseFirstInOpportunities: 92,
		stealAttempts: 10,
		stealOpportunities: 92,
		foldsBigBlindToSteal: 10,
		bigBlindStealOpportunities: 92,
		flopCbets: 10,
		flopCbetOpportunities: 92,
		foldsToFlopCbet: 10,
		foldToFlopCbetOpportunities: 92,
		calls: 92,
		aggressiveActs: 10,
		rates: {
			flopSeenPct: 92 / 210 * 100,
			wtsdPct: 10 / 92 * 100,
			threeBetPct: 10 / 92 * 100,
			foldToThreeBetPct: 10 / 92 * 100,
			raiseFirstInPct: 10 / 92 * 100,
			attemptToStealPct: 10 / 92 * 100,
			foldBigBlindToStealPct: 10 / 92 * 100,
			flopCbetPct: 10 / 92 * 100,
			foldToFlopCbetPct: 10 / 92 * 100,
			aggressionFactor: 10 / 92,
		},
	});
});

Deno.test("postflop rates preserve zero observations and undefined aggression without calls", () => {
	const stats = createEmptyPlayerStatsMetrics();
	stats.flopCbetOpportunities = 5;
	stats.foldToFlopCbetOpportunities = 4;
	stats.aggressiveActs = 3;
	const rates = getPlayerStatsRates(stats);
	assertEquals([rates.flopCbetPct, rates.foldToFlopCbetPct, rates.aggressionFactor], [0, 0, null]);
	assertEquals(JSON.parse(JSON.stringify(rates)).aggressionFactor, null);
	stats.calls = 2;
	assertEquals(getPlayerStatsRates(stats).aggressionFactor, 1.5);
	stats.aggressiveActs = 0;
	assertEquals(getPlayerStatsRates(stats).aggressionFactor, 0);
});

Deno.test("batch read diagnostics preserve individual samples and merge historical-read counts", () => {
	const first = analyzeRunDecisions([{
		action: "check",
		phase: "preflop",
		opponentReads: [
			{ seatIndex: 1, hands: 205, historicalHands: 200, weight: 1 },
			{ seatIndex: 2, hands: 3, historicalHands: 0, weight: 0 },
		],
	}], []);
	assertEquals(first.opponentReads, {
		decisions: 1,
		decisionsWithHistory: 1,
		count: 2,
		historicalCount: 1,
		zeroWeightCount: 1,
		weightSum: 1,
	});
	const legacy = analyzeRunDecisions([{ action: "check", phase: "preflop" }], []);
	const total = createEmptyMetrics();
	mergeRunMetrics(total, first);
	mergeRunMetrics(total, legacy);
	assertEquals(total.opponentReads, first.opponentReads);
});
