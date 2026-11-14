import { getPlayerStatsRates } from "../js/gameEngine.js";
import {
	createEmptyPlayerStatsMetrics,
	finalizePlayerStatsMetrics,
	mergePlayerStatsMetrics,
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
		}),
		{
			flopSeenPct: 40,
			wtsdPct: 50,
			threeBetPct: 30,
			foldToThreeBetPct: 50,
			raiseFirstInPct: 50,
			attemptToStealPct: 25,
			foldBigBlindToStealPct: 60,
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
		rates: {
			flopSeenPct: 92 / 210 * 100,
			wtsdPct: 10 / 92 * 100,
			threeBetPct: 10 / 92 * 100,
			foldToThreeBetPct: 10 / 92 * 100,
			raiseFirstInPct: 10 / 92 * 100,
			attemptToStealPct: 10 / 92 * 100,
			foldBigBlindToStealPct: 10 / 92 * 100,
		},
	});
});
