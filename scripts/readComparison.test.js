import * as bot from "../js/bot.js";
import { createStatsSnapshot } from "../js/playerProfile.js";
import { runComparisonTournament } from "./readComparison.js";

function assertEquals(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Expected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
	}
}

Deno.test("comparison tournaments repeat the same cards, seats, and decision random streams", () => {
	const options = {
		baselineBot: bot,
		variant: "individual",
		style: "normal",
		seed: 8123,
		heroSeat: 0,
		targetSeat: 1,
	};
	const first = runComparisonTournament(options);
	assertEquals(runComparisonTournament(options), first);
	assertEquals(first.historicalHands, 0);
	assertEquals(first.placement >= 1 && first.placement <= 6, true);
});

Deno.test("empty history preserves decisions and populated history never enters live hand counters", () => {
	const options = {
		baselineBot: bot,
		variant: "individual",
		style: "calling",
		seed: 4567,
		heroSeat: 1,
		targetSeat: 3,
	};
	const cold = runComparisonTournament(options);
	const empty = runComparisonTournament({ ...options, variant: "history", history: createStatsSnapshot() });
	assertEquals(empty, cold);
	const history = createStatsSnapshot({ hands: 200, vpip: 140, pfr: 20, calls: 60, aggressiveActs: 10 });
	const before = JSON.stringify(history);
	const warm = runComparisonTournament({ ...options, variant: "history", history });
	assertEquals(warm.historicalHands, 200);
	assertEquals(JSON.stringify(history), before);
});
