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
		getPlayerStatsRates({ hands: 10, flopsSeen: 4, showdowns: 2, threeBets: 3, threeBetOpportunities: 10 }),
		{
			flopSeenPct: 40,
			wtsdPct: 50,
			threeBetPct: 30,
		},
	);
});

Deno.test("player stats rates distinguish missing samples from observed zero", () => {
	const empty = createEmptyPlayerStatsMetrics();
	assertEquals(finalizePlayerStatsMetrics(empty).rates, { flopSeenPct: null, wtsdPct: null, threeBetPct: null });
	assertEquals(empty, { hands: 0, flopsSeen: 0, showdowns: 0, threeBets: 0, threeBetOpportunities: 0 });
	assertEquals(getPlayerStatsRates({ ...empty, hands: 10, threeBetOpportunities: 10 }), {
		flopSeenPct: 0,
		wtsdPct: null,
		threeBetPct: 0,
	});
});

Deno.test("player stats aggregate raw observations instead of averaging percentages", () => {
	const first = Object.freeze({ hands: 10, flopsSeen: 2, showdowns: 1, threeBets: 1, threeBetOpportunities: 2 });
	const second = Object.freeze({ hands: 200, flopsSeen: 90, showdowns: 9, threeBets: 9, threeBetOpportunities: 90 });
	const total = createEmptyPlayerStatsMetrics();
	mergePlayerStatsMetrics(total, finalizePlayerStatsMetrics(first));
	mergePlayerStatsMetrics(total, finalizePlayerStatsMetrics(second));
	assertEquals(finalizePlayerStatsMetrics(total), {
		hands: 210,
		flopsSeen: 92,
		showdowns: 10,
		threeBets: 10,
		threeBetOpportunities: 92,
		rates: { flopSeenPct: 92 / 210 * 100, wtsdPct: 10 / 92 * 100, threeBetPct: 10 / 92 * 100 },
	});
});
