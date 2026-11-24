import { chooseBotAction } from "../js/bot.js";
import { postBlinds, recordPlayerActionStats, resolveTurnAction, runEngineHand } from "../js/gameEngine.js";
import { createEngineBatchGameState } from "./engineBatch.js";
import baseline from "./matchupBaseline.js";
import { chooseSeededAction, getPostflopBettingLine, runMatchupBatch } from "./matchupBatch.js";
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

function createPreflopSpot(playerCount = 6, startingChips = 2000) {
	const state = createEngineBatchGameState({ playerCount, startingChips });
	state.players[0].dealer = true;
	const { playerPatches, gameStatePatch } = postBlinds(state);
	for (const { player, patch } of playerPatches) {
		Object.assign(player, patch);
	}
	Object.assign(state, gameStatePatch);
	return state;
}

function playAction(state, player, action, amount) {
	const resolution = resolveTurnAction(state, player, { action, amount });
	Object.assign(player, resolution.playerPatch);
	Object.assign(state, resolution.gameStatePatch);
	recordPlayerActionStats(state, player, resolution.action, resolution.actionMeta);
}

Deno.test("preflop profiles open different hands in early position and on the button", () => {
	const state = createPreflopSpot();
	const early = state.players[3];
	const [button] = state.players;
	early.holeCards = ["6s", "7s"];
	assertEquals(opponentStrategies.tag(early, state).action, "fold");
	assertEquals(opponentStrategies.lag(early, state), { action: "raise", amount: 50 });
	assertEquals(opponentStrategies.callingStation(early, state).action, "call");
	assertEquals(opponentStrategies.nit(early, state).action, "fold");

	button.holeCards = early.holeCards;
	assertEquals(opponentStrategies.tag(button, state), { action: "raise", amount: 50 });
	assertEquals(opponentStrategies.nit(button, state).action, "fold");

	early.holeCards = button.holeCards = ["8s", "8h"];
	assertEquals(opponentStrategies.nit(early, state).action, "call");
	assertEquals(opponentStrategies.nit(button, state).action, "raise");
	button.holeCards = ["As", "Ad"];
	assertEquals(opponentStrategies.callingStation(button, state).action, "raise");
});

Deno.test("preflop profiles distinguish a limped pot from an unopened pot", () => {
	const state = createPreflopSpot();
	const [button, , bigBlind, early, middle] = state.players;
	button.holeCards = ["As", "Ks"];
	assertEquals(opponentStrategies.tag(button, state), { action: "raise", amount: 50 });

	playAction(state, early, "call");
	assertEquals(opponentStrategies.tag(button, state), { action: "raise", amount: 80 });
	playAction(state, middle, "call");
	assertEquals(opponentStrategies.tag(button, state), { action: "raise", amount: 100 });
	bigBlind.holeCards = button.holeCards;
	assertEquals(opponentStrategies.tag(bigBlind, state), { action: "raise", amount: 90 });

	button.holeCards = ["5h", "6h"];
	assertEquals(opponentStrategies.tag(button, state).action, "call");
	button.holeCards = ["Ks", "7h"];
	assertEquals(opponentStrategies.callingStation(button, state).action, "call");
	assertEquals(opponentStrategies.nit(button, state).action, "fold");
});

Deno.test("big blind defense responds to open position and price", () => {
	for (const [openerSeat, amount, tagAction] of [[0, 40, "call"], [3, 40, "fold"], [0, 100, "fold"]]) {
		const state = createPreflopSpot();
		const bigBlind = state.players[2];
		playAction(state, state.players[openerSeat], "raise", amount);
		bigBlind.holeCards = ["Qs", "9s"];
		assertEquals(opponentStrategies.tag(bigBlind, state).action, tagAction);
		assertEquals(opponentStrategies.nit(bigBlind, state).action, "fold");
		if (amount === 40) {
			assertEquals(opponentStrategies.callingStation(bigBlind, state).action, "call");
		}
	}
});

Deno.test("the LAG mixes a light three-bet against a late open", () => {
	for (const openerSeat of [0, 3]) {
		const state = createPreflopSpot();
		const bigBlind = state.players[2];
		playAction(state, state.players[openerSeat], "raise", 50);
		bigBlind.holeCards = ["8s", "9s"];
		const aggressive = chooseSeededAction(opponentStrategies.lag, bigBlind, state, () => 0.2);
		const passive = chooseSeededAction(opponentStrategies.lag, bigBlind, state, () => 0.9);
		assertEquals(aggressive, openerSeat === 0 ? { action: "raise", amount: 160 } : { action: "fold" });
		assertEquals(passive.action, openerSeat === 0 ? "call" : "fold");
	}
});

Deno.test("TAG defends its own opening range differently from a cold three-bet", () => {
	const state = createPreflopSpot();
	const [button, , , early, middle] = state.players;
	playAction(state, early, "raise", 50);
	playAction(state, middle, "raise", 150);
	button.holeCards = early.holeCards = ["As", "Qs"];
	assertEquals(opponentStrategies.tag(button, state).action, "fold");
	assertEquals(opponentStrategies.tag(early, state).action, "call");
	early.holeCards = ["Ac", "Ad"];
	assertEquals(opponentStrategies.tag(early, state), { action: "raise", amount: 330 });
});

Deno.test("short stacks change opening ranges, sizing and calls against a shove", () => {
	const deep = createPreflopSpot();
	const short = createPreflopSpot(6, 160);
	deep.players[0].holeCards = short.players[0].holeCards = ["7s", "6s"];
	assertEquals(opponentStrategies.tag(deep.players[0], deep).action, "raise");
	assertEquals(opponentStrategies.tag(short.players[0], short).action, "fold");
	short.players[0].holeCards = ["Ah", "Td"];
	assertEquals(opponentStrategies.tag(short.players[0], short).action, "allin");
	assertEquals(opponentStrategies.nit(short.players[0], short).action, "fold");

	const headsUp = createPreflopSpot(2, 160);
	const [smallBlind, bigBlind] = headsUp.players;
	smallBlind.holeCards = ["Qh", "9d"];
	assertEquals(opponentStrategies.tag(smallBlind, headsUp).action, "allin");
	playAction(headsUp, smallBlind, "allin");
	bigBlind.holeCards = ["As", "Td"];
	assertEquals(opponentStrategies.callingStation(bigBlind, headsUp).action, "call");
	assertEquals(opponentStrategies.tag(bigBlind, headsUp).action, "call");
	assertEquals(opponentStrategies.nit(bigBlind, headsUp).action, "fold");

	const deepHeadsUp = createPreflopSpot(2);
	playAction(deepHeadsUp, deepHeadsUp.players[0], "allin");
	deepHeadsUp.players[1].holeCards = bigBlind.holeCards;
	assertEquals(opponentStrategies.callingStation(deepHeadsUp.players[1], deepHeadsUp).action, "fold");
});

function createPostflopSpot(board, cards, playerCount = 2) {
	const state = createEngineBatchGameState({ playerCount, startingChips: 2000 });
	const [player, opponent] = state.players;
	player.dealer = true;
	player.holeCards = cards;
	state.currentPhaseIndex = board.length - 2;
	state.communityCards = board;
	state.pot = 100;
	return { state, player, opponent };
}

function chooseProfile(name, player, state, randomValue = 0.5, line) {
	return chooseSeededAction(opponentStrategies[name], player, state, () => randomValue, line);
}

Deno.test("postflop history records the last resolved aggressor on each preceding street", () => {
	const state = createEngineBatchGameState({ playerCount: 2, startingChips: 2000 });
	const result = runEngineHand(state, (game, player, _step, { actions }) => {
		const { currentPhaseIndex, currentBet } = game;
		if (currentPhaseIndex === 0) {
			return { action: player.dealer ? "call" : "check" };
		}
		if (currentPhaseIndex === 1) {
			if (currentBet > 0) {
				return { action: "call" };
			}
			return player.dealer ? { action: "raise", amount: 40 } : { action: "check" };
		}
		if (currentPhaseIndex === 2) {
			return player.dealer ? { action: "call" } : { action: "raise", amount: 60 };
		}
		const [button, bigBlind] = game.players;
		assertEquals(getPostflopBettingLine(actions, currentPhaseIndex), {
			flop: button.seatIndex,
			turn: bigBlind.seatIndex,
		});
		return { action: "check" };
	}, { shuffleFn: (deck) => deck });
	assertEquals(result.type, "showdown");
});

Deno.test("LAG barrels a live draw and can bluff the miss when it owns the previous street", () => {
	const board = ["2s", "7d", "Tc", "3c", "5d"];
	const { state, player, opponent } = createPostflopSpot(board.slice(0, 3), ["9h", "8h"]);
	state.handContext.preflopAggressorSeatIndex = player.seatIndex;
	opponent.spotState.actedThisStreet = true;
	assertEquals(chooseProfile("lag", player, state, 0.60).action, "raise");
	assertEquals(chooseProfile("tag", player, state, 0.60).action, "check");

	state.currentPhaseIndex = 2;
	state.communityCards = board.slice(0, 4);
	assertEquals(chooseProfile("lag", player, state, 0.60, { flop: player.seatIndex }).action, "raise");
	assertEquals(chooseProfile("lag", player, state, 0.60, { flop: opponent.seatIndex }).action, "check");

	state.currentPhaseIndex = 3;
	state.communityCards = board;
	const line = { flop: player.seatIndex, turn: player.seatIndex };
	assertEquals(chooseProfile("lag", player, state, 0.30, line), { action: "raise", amount: 80 });
	assertEquals(chooseProfile("lag", player, state, 0.30, { ...line, turn: opponent.seatIndex }).action, "check");
	assertEquals(chooseProfile("callingStation", player, state, 0, line).action, "check");
	assertEquals(chooseProfile("nit", player, state, 0, line).action, "check");
	state.communityCards = [...board.slice(0, 4), "5c"];
	assertEquals(chooseProfile("lag", player, state, 0.30, line).action, "check");
	player.holeCards = ["Ac", "8h"];
	assertEquals(chooseProfile("lag", player, state, 0.30, line).action, "raise");
});

Deno.test("the LAG uses selective heads-up semi-bluff check-raises and checks multiway air", () => {
	const { state, player: button, opponent: bigBlind } = createPostflopSpot(["Ts", "7d", "2c"], ["Qh", "3h"], 3);
	const third = state.players[2];
	state.handContext.preflopAggressorSeatIndex = button.seatIndex;
	assertEquals(chooseProfile("lag", button, state, 0.2).action, "check");
	third.folded = true;
	assertEquals(chooseProfile("lag", button, state, 0.2).action, "raise");

	bigBlind.holeCards = ["9h", "8h"];
	playAction(state, bigBlind, "check");
	playAction(state, button, "raise", 50);
	assertEquals(chooseProfile("lag", bigBlind, state, 0.35).action, "raise");
	assertEquals(chooseProfile("callingStation", bigBlind, state, 0.35).action, "call");
	bigBlind.spotState.actedThisStreet = false;
	assertEquals(chooseProfile("lag", bigBlind, state, 0.35).action, "call");
});

Deno.test("a Calling Station continues with real straight and flush draws when the price fits", () => {
	for (
		const [board, cards] of [
			[["Ts", "7d", "2c"], ["9h", "8h"]],
			[["Ts", "7s", "2c"], ["9s", "4s"]],
		]
	) {
		const cheap = createPostflopSpot(board, cards);
		playAction(cheap.state, cheap.opponent, "raise", 30);
		assertEquals(chooseProfile("callingStation", cheap.player, cheap.state).action, "call");

		const expensive = createPostflopSpot([...board, "3d"], cards);
		playAction(expensive.state, expensive.opponent, "raise", 160);
		assertEquals(chooseProfile("callingStation", expensive.player, expensive.state).action, "fold");
	}
	const sharedFlush = createPostflopSpot(["As", "Js", "8s", "3s"], ["7h", "2d"]);
	playAction(sharedFlush.state, sharedFlush.opponent, "raise", 30);
	assertEquals(chooseProfile("callingStation", sharedFlush.player, sharedFlush.state).action, "fold");
});

Deno.test("combo draws count a card that completes both draws once", () => {
	const { state, player, opponent } = createPostflopSpot(["Ts", "7d", "2s", "3c"], ["9s", "8s"]);
	playAction(state, opponent, "raise", 200);
	assertEquals(chooseProfile("tag", player, state).action, "fold");
	assertEquals(chooseProfile("callingStation", player, state).action, "call");
});

Deno.test("relative river strength distinguishes a private pair from a full house on a paired board", () => {
	const { state, player, opponent } = createPostflopSpot(["Ah", "Ad", "7c", "6h", "4d"], ["7d", "2h"]);
	opponent.chips = 1000;
	playAction(state, opponent, "allin");
	assertEquals(chooseProfile("nit", player, state).action, "fold");
	player.holeCards = ["Ac", "7d"];
	assertEquals(chooseProfile("nit", player, state).action, "call");
});

Deno.test("river decisions separate a low flush, the top flush and a forced board chop", () => {
	const { state, player, opponent } = createPostflopSpot(["Qs", "9s", "7s", "5s", "2h"], ["3s", "Kd"]);
	opponent.chips = 1000;
	playAction(state, opponent, "allin");
	assertEquals(chooseProfile("nit", player, state).action, "fold");
	player.holeCards = ["As", "Kd"];
	assertEquals(chooseProfile("nit", player, state).action, "call");
	state.communityCards = ["Ts", "Jd", "Qs", "Kd", "Ah"];
	player.holeCards = ["3s", "5h"];
	assertEquals(chooseProfile("nit", player, state).action, "call");
});

Deno.test("calling down with a marginal pair after two barrels distinguishes passive profiles", () => {
	const { state, player, opponent } = createPostflopSpot(["As", "7d", "2c", "9s", "3d"], ["Qd", "7h"]);
	const line = { flop: opponent.seatIndex, turn: opponent.seatIndex };
	playAction(state, opponent, "raise", 50);
	assertEquals(chooseProfile("callingStation", player, state, 0.5, line).action, "call");
	assertEquals(chooseProfile("nit", player, state, 0.5, line).action, "fold");
});

Deno.test("TAG value bets top pair and adjusts its size to the flop texture", () => {
	const { state, player } = createPostflopSpot(["2s", "7d", "Jc"], ["Js", "Qh"]);
	state.handContext.preflopAggressorSeatIndex = player.seatIndex;
	assertEquals(chooseProfile("tag", player, state), { action: "raise", amount: 30 });
	state.communityCards = ["7s", "9s", "Jc"];
	assertEquals(chooseProfile("tag", player, state), { action: "raise", amount: 50 });
	player.holeCards = ["7c", "Qh"];
	assertEquals(chooseProfile("tag", player, state).action, "check");
});

Deno.test("a TAG checks top pair to the aggressor more often when acting first", () => {
	const { state, player: button, opponent: bigBlind } = createPostflopSpot(["2s", "7d", "Jc"], ["2d", "Qs"]);
	bigBlind.holeCards = ["Js", "Qh"];
	state.handContext.preflopAggressorSeatIndex = button.seatIndex;
	assertEquals(chooseProfile("tag", bigBlind, state).action, "check");
	state.handContext.preflopAggressorSeatIndex = bigBlind.seatIndex;
	assertEquals(chooseProfile("tag", bigBlind, state), { action: "raise", amount: 30 });
});
