import { chooseBotAction } from "../js/bot.js";
import { createEngineBatchGameState } from "./engineBatch.js";
import baseline from "./matchupBaseline.js";
import { runMatchupBatch } from "./matchupBatch.js";
import { opponentStrategies } from "./matchupPool.js";

function assertEquals(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Expected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
	}
}

Deno.test("matchup lineups share seeded deals and rotate the same roles", () => {
	const current = { test: "current", opponent: "current", field: "current" };
	const report = runMatchupBatch({
		seed: 42,
		runs: 3,
		maxHands: 12,
		strategies: { current: chooseBotAction },
		lineups: { baseline: current, repeat: current },
		classifySpot: (_state, _player, role) => role === "test" ? "all" : null,
	});

	assertEquals(report.results.baseline, report.results.repeat);
	const seats = report.results.baseline.runs.map((run) => run.seating.indexOf("test"));
	assertEquals(seats.toSorted(), [0, 1, 2]);
	const taggedActions = Object.values(report.results.baseline.roles.test.spots.all);
	assertEquals(taggedActions.some((row) => row.count > 0), true);
});

Deno.test("matchup spot returns exclude chips invested before a fold", () => {
	const report = runMatchupBatch({
		seed: 42,
		runs: 1,
		maxHands: 1,
		strategies: { fold: () => ({ action: "fold" }) },
		lineups: { baseline: { test: "fold", opponent: "fold" } },
		classifySpot: () => "first-action",
	});
	const roles = Object.values(report.results.baseline.roles);
	const folder = roles.find((role) => role.spots["first-action"]);
	assertEquals(folder.spots["first-action"].fold, { count: 1, netBb: 0 });
	assertEquals(folder.netBb, -0.5);
	assertEquals(roles.reduce((net, role) => net + role.netBb, 0), 0);
});

Deno.test("the river betting profiles share value bets and differ on potential bluffs", () => {
	const player = { chips: 500, holeCards: ["Qd", "3h"] };
	const opponent = { chips: 500, folded: false, allIn: false, spotState: { actedThisStreet: true } };
	const state = {
		players: [player, opponent],
		communityCards: ["2s", "4h", "7d", "9c", "Js"],
		raisesThisRound: 0,
		currentBet: 0,
		lastRaise: 20,
		pot: 100,
	};
	const { overbluff, valuePressure } = baseline.strategies;
	const random = Math.random;
	Math.random = () => 0.5;
	try {
		assertEquals(overbluff(player, state), { action: "raise", amount: 50 });
		assertEquals(valuePressure(player, state), { action: "check" });
		player.holeCards = ["7h", "7c"];
		assertEquals(overbluff(player, state), { action: "raise", amount: 50 });
		assertEquals(valuePressure(player, state), { action: "raise", amount: 50 });
	} finally {
		Math.random = random;
	}
});

Deno.test("opponent archetypes differ in whether and how they enter an unraised pot", () => {
	const state = createEngineBatchGameState({ playerCount: 6, startingChips: 2000 });
	state.currentBet = state.bigBlind;
	state.lastRaise = state.bigBlind;
	state.pot = state.smallBlind + state.bigBlind;
	const player = state.players[0];
	player.holeCards = ["Js", "8h"];

	assertEquals(opponentStrategies.tag(player, state).action, "fold");
	assertEquals(opponentStrategies.lag(player, state).action, "raise");
	assertEquals(opponentStrategies.callingStation(player, state).action, "call");
	assertEquals(opponentStrategies.nit(player, state).action, "fold");
});

Deno.test("the loose-aggressive archetype applies pressure on every postflop street", () => {
	const state = createEngineBatchGameState({ playerCount: 2, startingChips: 2000 });
	state.lastRaise = state.bigBlind;
	state.pot = 100;
	const player = state.players[0];
	player.holeCards = ["Qd", "3h"];
	const board = ["2s", "4h", "7d", "9c", "Js"];
	const random = Math.random;
	Math.random = () => 0.2;
	try {
		for (let street = 1; street <= 3; street++) {
			state.currentPhaseIndex = street;
			state.communityCards = board.slice(0, 2 + street);
			assertEquals(opponentStrategies.lag(player, state).action, "raise");
			assertEquals(opponentStrategies.tag(player, state).action, "check");
			assertEquals(opponentStrategies.callingStation(player, state).action, "check");
			assertEquals(opponentStrategies.nit(player, state).action, "check");
		}
	} finally {
		Math.random = random;
	}
});

Deno.test("the tight-aggressive archetype value bets top pair on a Broadway board", () => {
	const state = createEngineBatchGameState({ playerCount: 2, startingChips: 2000 });
	state.currentPhaseIndex = 1;
	state.communityCards = ["2s", "7d", "Jc"];
	state.lastRaise = state.bigBlind;
	state.pot = 100;
	const player = state.players[0];
	const random = Math.random;
	Math.random = () => 0.5;
	try {
		player.holeCards = ["Js", "Qh"];
		assertEquals(opponentStrategies.tag(player, state).action, "raise");
		player.holeCards = ["2c", "Qh"];
		assertEquals(opponentStrategies.tag(player, state).action, "check");
	} finally {
		Math.random = random;
	}
});
