import {
	analyzeDrawPotential,
	buildAggregateRead,
	chooseBotAction,
	getOpponentRead,
	normalizeBotActionRequest,
	setBotDecisionSink,
} from "./bot.js";
import { createStatsSnapshot } from "./playerProfile.js";
import { createEngineBatchGameState } from "../scripts/engineBatch.js";

function assertEquals(actual, expected, message = "") {
	const actualJson = JSON.stringify(actual);
	const expectedJson = JSON.stringify(expected);
	if (actualJson !== expectedJson) {
		throw new Error(
			`${message}\nExpected: ${expectedJson}\nActual:   ${actualJson}`,
		);
	}
}

Deno.test("straight draws count the low ace and the Broadway gutshot correctly", () => {
	assertEquals(analyzeDrawPotential(["AS", "2D"], ["3C", "4H", "KS"]), {
		flushDraw: false,
		straightDraw: true,
		outs: 4,
	});
	assertEquals(analyzeDrawPotential(["AS", "KD"], ["QC", "JH", "3S"]), {
		flushDraw: false,
		straightDraw: true,
		outs: 4,
	});
});

Deno.test("combo draws count cards that complete both draws only once", () => {
	assertEquals(analyzeDrawPotential(["8H", "7H"], ["6H", "9C", "2H"]), {
		flushDraw: true,
		straightDraw: true,
		outs: 15,
	});
});

Deno.test("ace and six both complete an open-ended straight draw on the turn", () => {
	assertEquals(analyzeDrawPotential(["2C", "3D"], ["4C", "5H", "KS", "JH"]), {
		flushDraw: false,
		straightDraw: true,
		outs: 8,
	});
});

Deno.test("made straights suppress straight outs while preserving flush outs", () => {
	assertEquals(analyzeDrawPotential(["AS", "2D"], ["3C", "4H", "5S", "KD"]), {
		flushDraw: false,
		straightDraw: false,
		outs: 0,
	});
	assertEquals(analyzeDrawPotential(["8H", "7H"], ["6H", "9C", "5S", "2H"]), {
		flushDraw: true,
		straightDraw: false,
		outs: 9,
	});
});

Deno.test("normalizeBotActionRequest returns null for missing decisions", () => {
	assertEquals(normalizeBotActionRequest(null), null);
	assertEquals(normalizeBotActionRequest(undefined), null);
});

Deno.test("normalizeBotActionRequest keeps non-amount actions", () => {
	for (const action of ["fold", "check", "call", "allin"]) {
		assertEquals(
			normalizeBotActionRequest({ action, amount: 500 }),
			{ action },
		);
	}
});

Deno.test("normalizeBotActionRequest parses raise amount", () => {
	assertEquals(
		normalizeBotActionRequest({ action: "raise", amount: "125" }),
		{ action: "raise", amount: 125 },
	);
});

Deno.test("normalizeBotActionRequest rejects invalid raise amount", () => {
	assertEquals(normalizeBotActionRequest({ action: "raise", amount: "abc" }), null);
});

Deno.test("normalizeBotActionRequest rejects unknown actions", () => {
	assertEquals(normalizeBotActionRequest({ action: "bet", amount: 100 }), null);
});

Deno.test("opponent reads combine frozen history with live observations without changing either", () => {
	const opponent = {
		stats: createStatsSnapshot({ hands: 5, vpip: 2, pfr: 1, folds: 3, calls: 1, aggressiveActs: 2, showdowns: 1 }),
		readHistory: createStatsSnapshot({
			hands: 200,
			vpip: 100,
			pfr: 40,
			folds: 80,
			calls: 20,
			aggressiveActs: 40,
			showdowns: 20,
			showdownsWon: 10,
		}),
	};
	const before = JSON.stringify(opponent);
	const read = getOpponentRead(opponent);
	assertEquals([read.hands, read.historicalHands, read.vpip, read.pfr], [205, 200, 103 / 207, 42 / 207]);
	assertEquals([read.foldRate, read.agg, read.showdowns, read.showdownWin], [84 / 207, 43 / 22, 21, 11 / 23]);
	assertEquals(read.weight > 0.999, true);
	assertEquals(JSON.stringify(opponent), before);
});

Deno.test("a known opponent cannot lend confidence to a three-hand opponent", () => {
	const known = {
		stats: createStatsSnapshot({ hands: 200, vpip: 120, pfr: 60, folds: 80, calls: 20, aggressiveActs: 50 }),
	};
	const unknown = { stats: createStatsSnapshot({ hands: 3, vpip: 3, pfr: 3, folds: 0, aggressiveActs: 10 }) };
	const knownRead = getOpponentRead(known);
	assertEquals(getOpponentRead(unknown).weight, 0);
	const group = buildAggregateRead([known, unknown]);
	assertEquals(group.weight, knownRead.weight / 2);
	assertEquals(group.vpip, knownRead.vpip * knownRead.weight / 2);
	assertEquals(group.agg, 1 + (knownRead.agg - 1) * knownRead.weight / 2);
	unknown.stats.vpip = 0;
	unknown.stats.pfr = 0;
	unknown.stats.folds = 3;
	unknown.stats.aggressiveActs = 0;
	assertEquals(buildAggregateRead([known, unknown]), group);
	assertEquals(buildAggregateRead([unknown]), {
		vpip: 0,
		pfr: 0,
		foldRate: 0,
		agg: 1,
		showdownWin: 0.5,
		showdowns: 0,
		weight: 0,
	});
});

Deno.test("individual confidence uses the existing ten-hand threshold and growth", () => {
	for (const hands of [0, 3, 10, 20, 40]) {
		const read = getOpponentRead({ stats: createStatsSnapshot({ hands }) });
		assertEquals(read.weight, hands <= 10 ? 0 : 1 - Math.exp(-(hands - 10) / 10));
		assertEquals(read.historicalHands, 0);
	}
	assertEquals(buildAggregateRead([]), {
		vpip: 0,
		pfr: 0,
		foldRate: 0,
		agg: 1,
		showdownWin: 0.5,
		showdowns: 0,
		weight: 0,
	});
});

Deno.test("opponent history is seat-specific and contains no private-card information", () => {
	const first = {
		stats: createStatsSnapshot({ hands: 2 }),
		readHistory: createStatsSnapshot({ hands: 100, vpip: 80 }),
		holeCards: ["AS", "AH"],
	};
	const second = { stats: createStatsSnapshot({ hands: 2 }), holeCards: ["2C", "7D"] };
	const before = getOpponentRead(first);
	first.holeCards = second.holeCards;
	assertEquals(getOpponentRead(first), before);
	assertEquals([getOpponentRead(first).hands, getOpponentRead(second).hands], [102, 2]);
});

Deno.test("folded-player history cannot change a decision against the remaining opponents", () => {
	const template = createEngineBatchGameState({ playerCount: 6, startingChips: 2000 });
	template.currentBet = 20;
	template.players[0].dealer = true;
	template.players[1].smallBlind = true;
	template.players[1].roundBet = 10;
	template.players[2].bigBlind = true;
	template.players[2].roundBet = 20;
	for (const player of template.players) {
		player.stats.hands = 5;
		player.holeCards = ["AS", "AH"];
	}
	template.players[4].folded = true;
	const decide = (history) => {
		const state = structuredClone(template);
		state.players[4].readHistory = history;
		const originalRandom = Math.random;
		let diagnostic;
		Math.random = () => 0.5;
		setBotDecisionSink((decision) => diagnostic = decision);
		try {
			chooseBotAction(state.players[3], state);
			return diagnostic;
		} finally {
			Math.random = originalRandom;
			setBotDecisionSink(null);
		}
	};
	const cold = decide(null);
	const warm = decide(createStatsSnapshot({ hands: 200, vpip: 180, folds: 150, aggressiveActs: 100 }));
	assertEquals(warm, cold);
	assertEquals(warm.opponentReads.some((read) => read.seatIndex === 4), false);
	assertEquals(warm.opponentReads.every((read) => read.weight === 0), true);
});
