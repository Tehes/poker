import { resolveTurnAction } from "./gameEngine.js";

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
} = {}) {
	return {
		name,
		seatIndex,
		chips,
		roundBet,
		totalBet,
		folded,
		allIn,
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
