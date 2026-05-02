import {
	createBettingRoundProgressState,
	getBettingRoundStartExit,
	getBettingRoundStartIndex,
	getNextBettingRoundStep,
	getResolvedTurnContinuation,
	hasPendingBettingRoundAction,
	resolveTurnAction,
} from "./gameEngine.js";

function assertEquals(actual, expected, message = "") {
	const actualJson = JSON.stringify(actual);
	const expectedJson = JSON.stringify(expected);
	if (actualJson !== expectedJson) {
		throw new Error(
			`${message}\nExpected: ${expectedJson}\nActual:   ${actualJson}`,
		);
	}
}

function createPlayer({
	name = "Hero",
	seatIndex = 0,
	chips = 1000,
	roundBet = 0,
	totalBet = roundBet,
	folded = false,
	allIn = false,
	dealer = false,
	bigBlind = false,
} = {}) {
	return {
		name,
		seatIndex,
		chips,
		roundBet,
		totalBet,
		folded,
		allIn,
		dealer,
		bigBlind,
	};
}

function createGameState({
	player = createPlayer(),
	opponents = null,
	currentPhaseIndex = 1,
	currentBet = 0,
	lastRaise = 20,
	pot = 0,
	raisesThisRound = 0,
} = {}) {
	const tableOpponents = opponents ?? [
		createPlayer({
			name: "Villain",
			seatIndex: 1,
			chips: 1000,
			roundBet: currentBet,
			totalBet: currentBet,
		}),
	];

	return {
		gameState: {
			currentPhaseIndex,
			currentBet,
			lastRaise,
			pot,
			raisesThisRound,
			players: [player, ...tableOpponents],
		},
		player,
	};
}

Deno.test("resolveTurnAction allows check with no call required", () => {
	const { gameState, player } = createGameState();

	assertEquals(resolveTurnAction(gameState, player, { action: "check" }), {
		action: "check",
		amount: 0,
		actionMeta: {
			aggressive: false,
			voluntary: false,
		},
		playerPatch: {},
		gameStatePatch: {},
	});
});

Deno.test("resolveTurnAction rejects check while facing a bet", () => {
	const player = createPlayer({ chips: 200, roundBet: 0 });
	const { gameState } = createGameState({
		player,
		currentBet: 20,
		lastRaise: 20,
	});

	assertEquals(resolveTurnAction(gameState, player, { action: "check" }), null);
});

Deno.test("resolveTurnAction resolves a normal call", () => {
	const player = createPlayer({ chips: 200, roundBet: 10 });
	const { gameState } = createGameState({
		player,
		currentBet: 50,
		lastRaise: 20,
		pot: 100,
	});

	assertEquals(resolveTurnAction(gameState, player, { action: "call" }), {
		action: "call",
		amount: 40,
		actionMeta: {
			aggressive: false,
			voluntary: true,
		},
		playerPatch: {
			roundBet: 50,
			totalBet: 50,
			chips: 160,
		},
		gameStatePatch: {
			pot: 140,
		},
	});
});

Deno.test("resolveTurnAction resolves a short call as all-in", () => {
	const player = createPlayer({ chips: 50, roundBet: 0 });
	const { gameState } = createGameState({
		player,
		currentBet: 100,
		lastRaise: 20,
		pot: 300,
	});

	assertEquals(resolveTurnAction(gameState, player, { action: "call" }), {
		action: "allin",
		amount: 50,
		actionMeta: {
			aggressive: false,
			voluntary: true,
		},
		playerPatch: {
			roundBet: 50,
			totalBet: 50,
			chips: 0,
			allIn: true,
		},
		gameStatePatch: {
			pot: 350,
		},
	});
});

Deno.test("resolveTurnAction applies a legal raise", () => {
	const player = createPlayer({ chips: 300, roundBet: 10 });
	const { gameState } = createGameState({
		player,
		currentBet: 50,
		lastRaise: 20,
		pot: 100,
	});

	assertEquals(resolveTurnAction(gameState, player, { action: "raise", amount: 100 }), {
		action: "raise",
		amount: 100,
		actionMeta: {
			aggressive: true,
			voluntary: true,
		},
		playerPatch: {
			roundBet: 110,
			totalBet: 110,
			chips: 200,
		},
		gameStatePatch: {
			pot: 200,
			currentBet: 110,
			lastRaise: 60,
			raisesThisRound: 1,
		},
	});
});

Deno.test("resolveTurnAction snaps a too-small non-all-in raise to the minimum", () => {
	const player = createPlayer({ chips: 300, roundBet: 10 });
	const { gameState } = createGameState({
		player,
		currentBet: 50,
		lastRaise: 20,
		pot: 100,
	});

	assertEquals(resolveTurnAction(gameState, player, { action: "raise", amount: 50 }), {
		action: "raise",
		amount: 60,
		actionMeta: {
			aggressive: true,
			voluntary: true,
		},
		playerPatch: {
			roundBet: 70,
			totalBet: 70,
			chips: 240,
		},
		gameStatePatch: {
			pot: 160,
			currentBet: 70,
			lastRaise: 20,
			raisesThisRound: 1,
		},
	});
});

Deno.test("resolveTurnAction clamps a side-pot raise to the callable cap", () => {
	const player = createPlayer({ chips: 1000, roundBet: 0 });
	const opponent = createPlayer({
		name: "Villain",
		seatIndex: 1,
		chips: 80,
		roundBet: 100,
	});
	const { gameState } = createGameState({
		player,
		opponents: [opponent],
		currentBet: 100,
		lastRaise: 50,
		pot: 400,
	});

	assertEquals(resolveTurnAction(gameState, player, { action: "raise", amount: 300 }), {
		action: "raise",
		amount: 180,
		actionMeta: {
			aggressive: true,
			voluntary: true,
		},
		playerPatch: {
			roundBet: 180,
			totalBet: 180,
			chips: 820,
		},
		gameStatePatch: {
			pot: 580,
			currentBet: 180,
			lastRaise: 80,
			raisesThisRound: 1,
		},
	});
});

Deno.test("resolveTurnAction keeps an all-in below min-raise from incrementing raises", () => {
	const player = createPlayer({ chips: 150, roundBet: 0 });
	const { gameState } = createGameState({
		player,
		currentBet: 100,
		lastRaise: 100,
		pot: 300,
		raisesThisRound: 2,
	});

	assertEquals(resolveTurnAction(gameState, player, { action: "allin" }), {
		action: "allin",
		amount: 150,
		actionMeta: {
			aggressive: true,
			voluntary: true,
		},
		playerPatch: {
			roundBet: 150,
			totalBet: 150,
			chips: 0,
			allIn: true,
		},
		gameStatePatch: {
			pot: 450,
			currentBet: 150,
		},
	});
});

Deno.test("resolveTurnAction does not mutate inputs", () => {
	const player = createPlayer({ chips: 200, roundBet: 10 });
	const { gameState } = createGameState({
		player,
		currentBet: 50,
		lastRaise: 20,
		pot: 100,
	});
	const playerBefore = structuredClone(player);
	const gameStateBefore = structuredClone(gameState);

	resolveTurnAction(gameState, player, { action: "raise", amount: 70 });

	assertEquals(player, playerBefore);
	assertEquals(gameState, gameStateBefore);
});

Deno.test("betting round progress starts from preflop big blind and postflop dealer", () => {
	const players = [
		createPlayer({ name: "Dealer", seatIndex: 0, dealer: true }),
		createPlayer({ name: "Big Blind", seatIndex: 1, bigBlind: true }),
		createPlayer({ name: "Button", seatIndex: 2 }),
	];
	const preflopGameState = {
		currentPhaseIndex: 0,
		players,
	};
	const postflopGameState = {
		currentPhaseIndex: 1,
		players,
	};

	assertEquals(getBettingRoundStartIndex(players, 0), 2);
	assertEquals(createBettingRoundProgressState(preflopGameState), {
		nextIndex: 2,
		cycles: 0,
	});
	assertEquals(getBettingRoundStartIndex(players, 1), 1);
	assertEquals(createBettingRoundProgressState(postflopGameState), {
		nextIndex: 1,
		cycles: 0,
	});
});

Deno.test("getBettingRoundStartExit advances with one actionable player", () => {
	const player = createPlayer({ chips: 100 });
	const allInOpponent = createPlayer({
		name: "Villain",
		seatIndex: 1,
		chips: 0,
		allIn: true,
	});
	const { gameState } = createGameState({
		player,
		opponents: [allInOpponent],
	});

	assertEquals(getBettingRoundStartExit(gameState), {
		type: "advance",
		reason: "startBettingRound",
		activePlayerCount: 2,
		actionablePlayerCount: 1,
	});
});

Deno.test("getNextBettingRoundStep advances when no actionable players remain", () => {
	const player = createPlayer({ chips: 0, allIn: true });
	const opponent = createPlayer({
		name: "Villain",
		seatIndex: 1,
		chips: 0,
		allIn: true,
	});
	const { gameState } = createGameState({
		player,
		opponents: [opponent],
	});
	const step = getNextBettingRoundStep(gameState, { nextIndex: 0, cycles: 0 });

	assertEquals({
		type: step.type,
		reason: step.reason,
		progressState: step.progressState,
		activePlayerCount: step.activePlayers.length,
	}, {
		type: "advance",
		reason: "nextPlayer",
		progressState: { nextIndex: 0, cycles: 0 },
		activePlayerCount: 2,
	});
});

Deno.test("getNextBettingRoundStep skips folded and all-in players with progress", () => {
	const player = createPlayer({ folded: true });
	const { gameState } = createGameState({
		player,
		opponents: [
			createPlayer({ name: "Villain 1", seatIndex: 1 }),
			createPlayer({ name: "Villain 2", seatIndex: 2 }),
		],
	});

	assertEquals(getNextBettingRoundStep(gameState, { nextIndex: 0, cycles: 0 }), {
		type: "skip",
		reason: "foldedAllIn",
		player,
		index: 0,
		previousCycles: 0,
		cycles: 1,
		progressState: { nextIndex: 1, cycles: 1 },
	});
});

Deno.test("getNextBettingRoundStep lets the big blind act once preflop", () => {
	const player = createPlayer({
		bigBlind: true,
		roundBet: 20,
	});
	const { gameState } = createGameState({
		player,
		currentPhaseIndex: 0,
		currentBet: 20,
	});

	assertEquals(getNextBettingRoundStep(gameState, { nextIndex: 0, cycles: 0 }), {
		type: "act",
		reason: "firstPassMatched",
		player,
		index: 0,
		previousCycles: 0,
		cycles: 1,
		progressState: { nextIndex: 1, cycles: 1 },
	});
});

Deno.test("getNextBettingRoundStep keeps postflop first-pass checks available", () => {
	const player = createPlayer({ roundBet: 0 });
	const { gameState } = createGameState({
		player,
		currentPhaseIndex: 1,
		currentBet: 0,
	});

	assertEquals(getNextBettingRoundStep(gameState, { nextIndex: 0, cycles: 0 }), {
		type: "act",
		reason: "firstPassMatched",
		player,
		index: 0,
		previousCycles: 0,
		cycles: 1,
		progressState: { nextIndex: 1, cycles: 1 },
	});
});

Deno.test("getNextBettingRoundStep advances matched players after the first cycle", () => {
	const player = createPlayer({ roundBet: 20 });
	const { gameState } = createGameState({
		player,
		currentBet: 20,
		opponents: [
			createPlayer({
				name: "Villain",
				seatIndex: 1,
				roundBet: 20,
			}),
		],
	});

	assertEquals(getNextBettingRoundStep(gameState, { nextIndex: 0, cycles: 2 }), {
		type: "advance",
		reason: "matched",
		player,
		index: 0,
		previousCycles: 2,
		cycles: 3,
		progressState: { nextIndex: 1, cycles: 3 },
	});
});

Deno.test("getNextBettingRoundStep returns act when player is below current bet", () => {
	const player = createPlayer({ roundBet: 10 });
	const { gameState } = createGameState({
		player,
		currentBet: 20,
	});

	assertEquals(getNextBettingRoundStep(gameState, { nextIndex: 0, cycles: 3 }), {
		type: "act",
		reason: "owesAction",
		player,
		index: 0,
		previousCycles: 3,
		cycles: 4,
		progressState: { nextIndex: 1, cycles: 4 },
	});
});

Deno.test("getResolvedTurnContinuation returns next, wait, and advance", () => {
	const player = createPlayer({ roundBet: 20 });
	const opponent = createPlayer({
		name: "Villain",
		seatIndex: 1,
		roundBet: 10,
	});
	const { gameState } = createGameState({
		player,
		opponents: [opponent],
		currentBet: 20,
	});

	assertEquals(getResolvedTurnContinuation(gameState, 1), { type: "next" });
	assertEquals(getResolvedTurnContinuation(gameState, 2), { type: "wait" });
	opponent.roundBet = 20;
	assertEquals(getResolvedTurnContinuation(gameState, 2), { type: "advance" });
});

Deno.test("betting round progress helpers do not mutate inputs", () => {
	const player = createPlayer({ roundBet: 20, bigBlind: true });
	const { gameState } = createGameState({
		player,
		currentPhaseIndex: 0,
		currentBet: 20,
	});
	const gameStateBefore = structuredClone(gameState);
	const progressState = { nextIndex: 0, cycles: 0 };
	const progressStateBefore = structuredClone(progressState);

	createBettingRoundProgressState(gameState);
	getBettingRoundStartExit(gameState);
	hasPendingBettingRoundAction(gameState, 0);
	getNextBettingRoundStep(gameState, progressState);
	getResolvedTurnContinuation(gameState, 2);

	assertEquals(gameState, gameStateBefore);
	assertEquals(progressState, progressStateBefore);
});
