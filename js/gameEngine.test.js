import {
	advanceDealer,
	createBettingRoundProgressState,
	dealCommunityCardsForPhase,
	dealHoleCardsForNewHand,
	getBettingRoundStartExit,
	getBettingRoundStartIndex,
	getBlindLevelUpdateForHand,
	getNextBettingRoundStep,
	getNextPhasePlan,
	getResolvedTurnContinuation,
	hasPendingBettingRoundAction,
	postBlinds,
	resetPlayersForNewHand,
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
	...extra
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
		...extra,
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

function createStats({ hands = 0 } = {}) {
	return {
		hands,
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

Deno.test("resetPlayersForNewHand prepares remaining players and removes busted players", () => {
	const human = createPlayer({
		name: "Human",
		isBot: false,
		stats: createStats({ hands: 2 }),
		folded: true,
		allIn: true,
		totalBet: 120,
		roundBet: 40,
		holeCards: ["AS", "KS"],
		visibleHoleCards: [true, true],
		winProbability: 50,
		lastNonFinalWinProbability: 60,
		isWinner: true,
		winnerReactionEmoji: "x",
		winnerReactionUntil: 123,
	});
	const bot = createPlayer({
		name: "Bot",
		seatIndex: 1,
		isBot: true,
		stats: createStats({ hands: 3 }),
	});
	const busted = createPlayer({
		name: "Busted",
		seatIndex: 2,
		chips: -10,
		isBot: true,
		stats: createStats({ hands: 4 }),
	});
	const gameState = {
		currentPhaseIndex: 3,
		gameFinished: true,
		handInProgress: true,
		chipTransfer: { active: true },
		communityCards: ["2C", "3D"],
		openCardsMode: false,
		spectatorMode: false,
		players: [human, bot, busted],
	};
	const gameStateBefore = structuredClone(gameState);
	const result = resetPlayersForNewHand(gameState);
	const humanPatch = result.playerPatches.find((entry) => entry.player === human).patch;
	const botPatch = result.playerPatches.find((entry) => entry.player === bot).patch;
	const bustedPatch = result.playerPatches.find((entry) => entry.player === busted).patch;

	assertEquals(result.remainingPlayers.map((player) => player.name), ["Human", "Bot"]);
	assertEquals(result.bustedPlayers.map((player) => player.name), ["Busted"]);
	assertEquals({
		folded: humanPatch.folded,
		allIn: humanPatch.allIn,
		totalBet: humanPatch.totalBet,
		roundBet: humanPatch.roundBet,
		holeCards: humanPatch.holeCards,
		visibleHoleCards: humanPatch.visibleHoleCards,
		hands: humanPatch.stats.hands,
		botLinePreflopAggressor: humanPatch.botLine.preflopAggressor,
		spotActed: humanPatch.spotState.actedThisStreet,
	}, {
		folded: false,
		allIn: false,
		totalBet: 0,
		roundBet: 0,
		holeCards: [null, null],
		visibleHoleCards: [false, false],
		hands: 3,
		botLinePreflopAggressor: false,
		spotActed: false,
	});
	assertEquals(botPatch.stats.hands, 4);
	assertEquals(bustedPatch.chips, 0);
	assertEquals({
		currentPhaseIndex: result.gameStatePatch.currentPhaseIndex,
		gameFinished: result.gameStatePatch.gameFinished,
		handInProgress: result.gameStatePatch.handInProgress,
		communityCards: result.gameStatePatch.communityCards,
		openCardsMode: result.gameStatePatch.openCardsMode,
		spectatorMode: result.gameStatePatch.spectatorMode,
		players: result.gameStatePatch.players.map((player) => player.name),
	}, {
		currentPhaseIndex: 0,
		gameFinished: false,
		handInProgress: false,
		communityCards: [],
		openCardsMode: true,
		spectatorMode: false,
		players: ["Human", "Bot"],
	});
	assertEquals(gameState, gameStateBefore);
});

Deno.test("getBlindLevelUpdateForHand returns the next blind level patch", () => {
	const gameState = {
		blindLevel: 0,
		smallBlind: 10,
		bigBlind: 20,
	};

	assertEquals(getBlindLevelUpdateForHand(7, gameState), {
		gameStatePatch: {
			blindLevel: 1,
			bigBlind: 40,
			smallBlind: 20,
		},
		blindsChanged: true,
	});
	assertEquals(getBlindLevelUpdateForHand(1, gameState), null);
});

Deno.test("advanceDealer rotates the dealer to the front without mutating players", () => {
	const playerA = createPlayer({ name: "A", dealer: true });
	const playerB = createPlayer({ name: "B", seatIndex: 1 });
	const playerC = createPlayer({ name: "C", seatIndex: 2 });
	const players = [playerA, playerB, playerC];
	const playersBefore = structuredClone(players);

	const result = advanceDealer(players);

	assertEquals(result.previousDealer, playerA);
	assertEquals(result.dealer, playerB);
	assertEquals(result.players.map((player) => player.name), ["B", "C", "A"]);
	assertEquals(result.playerPatches, [
		{ player: playerA, patch: { dealer: false } },
		{ player: playerB, patch: { dealer: true } },
	]);
	assertEquals(players, playersBefore);
});

Deno.test("postBlinds creates blind player patches and pot state", () => {
	const dealer = createPlayer({ name: "Dealer" });
	const smallBlind = createPlayer({ name: "Small", seatIndex: 1, chips: 1000 });
	const bigBlind = createPlayer({ name: "Big", seatIndex: 2, chips: 1000 });
	const gameState = {
		players: [dealer, smallBlind, bigBlind],
		smallBlind: 10,
		bigBlind: 20,
		pot: 0,
	};
	const gameStateBefore = structuredClone(gameState);
	const result = postBlinds(gameState);
	const smallBlindPatch = result.playerPatches.find((entry) => entry.player === smallBlind).patch;
	const bigBlindPatch = result.playerPatches.find((entry) => entry.player === bigBlind).patch;

	assertEquals({
		smallBlindIndex: result.smallBlindIndex,
		bigBlindIndex: result.bigBlindIndex,
		smallBlindAmount: result.smallBlindAmount,
		bigBlindAmount: result.bigBlindAmount,
		smallBlindPatch,
		bigBlindPatch,
		gameStatePatch: result.gameStatePatch,
	}, {
		smallBlindIndex: 1,
		bigBlindIndex: 2,
		smallBlindAmount: 10,
		bigBlindAmount: 20,
		smallBlindPatch: {
			smallBlind: true,
			bigBlind: false,
			roundBet: 10,
			totalBet: 10,
			chips: 990,
		},
		bigBlindPatch: {
			smallBlind: false,
			bigBlind: true,
			roundBet: 20,
			totalBet: 20,
			chips: 980,
		},
		gameStatePatch: {
			pot: 30,
			currentBet: 20,
			lastRaise: 20,
		},
	});
	assertEquals(gameState, gameStateBefore);
});

Deno.test("dealHoleCardsForNewHand deals deterministic hole cards without mutating state", () => {
	const human = createPlayer({ name: "Human", isBot: false });
	const bot = createPlayer({ name: "Bot", seatIndex: 1, isBot: true });
	const gameState = {
		players: [human, bot],
		deck: ["AS", "KS", "QS", "JS", "TS"],
		cardGraveyard: ["9S"],
		openCardsMode: true,
		spectatorMode: false,
	};
	const gameStateBefore = structuredClone(gameState);
	const result = dealHoleCardsForNewHand(gameState, (deck) => deck);
	const humanPatch = result.playerPatches.find((entry) => entry.player === human).patch;
	const botPatch = result.playerPatches.find((entry) => entry.player === bot).patch;

	assertEquals({
		dealtPlayers: result.dealtPlayers.map((entry) => ({
			name: entry.player.name,
			card1: entry.card1,
			card2: entry.card2,
			showCards: entry.showCards,
		})),
		humanPatch,
		botPatch,
		gameStatePatch: result.gameStatePatch,
	}, {
		dealtPlayers: [
			{ name: "Human", card1: "AS", card2: "KS", showCards: true },
			{ name: "Bot", card1: "QS", card2: "JS", showCards: false },
		],
		humanPatch: {
			holeCards: ["AS", "KS"],
			visibleHoleCards: [true, true],
		},
		botPatch: {
			holeCards: ["QS", "JS"],
			visibleHoleCards: [false, false],
		},
		gameStatePatch: {
			deck: ["TS", "9S"],
			cardGraveyard: ["AS", "KS", "QS", "JS"],
		},
	});
	assertEquals(gameState, gameStateBefore);
});

Deno.test("getNextPhasePlan advances preflop to flop deal", () => {
	const gameState = {
		currentPhaseIndex: 0,
		players: [
			createPlayer({ name: "A" }),
			createPlayer({ name: "B", seatIndex: 1 }),
		],
		handContext: {
			streetAggressorSeatIndex: null,
			flopCheckedThrough: false,
			turnCheckedThrough: false,
		},
	};
	const gameStateBefore = structuredClone(gameState);

	const result = getNextPhasePlan(gameState);

	assertEquals({
		type: result.type,
		reason: result.reason,
		completedPhase: result.completedPhase,
		phase: result.phase,
		cardsToDeal: result.cardsToDeal,
		gameStatePatch: result.gameStatePatch,
		handContextPatch: result.handContextPatch,
		botIntentResetReason: result.botIntentResetReason,
	}, {
		type: "deal",
		reason: "deal",
		completedPhase: "preflop",
		phase: "flop",
		cardsToDeal: 3,
		gameStatePatch: {
			currentPhaseIndex: 1,
		},
		handContextPatch: null,
		botIntentResetReason: null,
	});
	assertEquals(gameState, gameStateBefore);
});

Deno.test("getNextPhasePlan records checked-through flop before turn", () => {
	const gameState = {
		currentPhaseIndex: 1,
		players: [
			createPlayer({ name: "A" }),
			createPlayer({ name: "B", seatIndex: 1 }),
		],
		handContext: {
			streetAggressorSeatIndex: null,
			flopCheckedThrough: false,
			turnCheckedThrough: false,
		},
	};
	const gameStateBefore = structuredClone(gameState);

	const result = getNextPhasePlan(gameState);

	assertEquals({
		type: result.type,
		completedPhase: result.completedPhase,
		phase: result.phase,
		cardsToDeal: result.cardsToDeal,
		handContextPatch: result.handContextPatch,
		streetEndReason: result.streetEndReason,
		checkedThrough: result.checkedThrough,
		botIntentResetReason: result.botIntentResetReason,
	}, {
		type: "deal",
		completedPhase: "flop",
		phase: "turn",
		cardsToDeal: 1,
		handContextPatch: {
			flopCheckedThrough: true,
		},
		streetEndReason: "street_end_no_bet",
		checkedThrough: true,
		botIntentResetReason: "street_end_no_bet",
	});
	assertEquals(gameState, gameStateBefore);
});

Deno.test("getNextPhasePlan records fired turn before river", () => {
	const gameState = {
		currentPhaseIndex: 2,
		players: [
			createPlayer({ name: "A" }),
			createPlayer({ name: "B", seatIndex: 1 }),
		],
		handContext: {
			streetAggressorSeatIndex: 1,
			flopCheckedThrough: true,
			turnCheckedThrough: true,
		},
	};

	const result = getNextPhasePlan(gameState);

	assertEquals({
		type: result.type,
		completedPhase: result.completedPhase,
		phase: result.phase,
		cardsToDeal: result.cardsToDeal,
		handContextPatch: result.handContextPatch,
		streetEndReason: result.streetEndReason,
		checkedThrough: result.checkedThrough,
	}, {
		type: "deal",
		completedPhase: "turn",
		phase: "river",
		cardsToDeal: 1,
		handContextPatch: {
			turnCheckedThrough: false,
		},
		streetEndReason: "street_end_unfired",
		checkedThrough: false,
	});
});

Deno.test("getNextPhasePlan returns showdown on river or single active player", () => {
	const riverGameState = {
		currentPhaseIndex: 3,
		players: [
			createPlayer({ name: "A" }),
			createPlayer({ name: "B", seatIndex: 1 }),
		],
		handContext: {
			streetAggressorSeatIndex: null,
		},
	};
	const foldedGameState = {
		currentPhaseIndex: 2,
		players: [
			createPlayer({ name: "A" }),
			createPlayer({ name: "B", seatIndex: 1, folded: true }),
		],
		handContext: {
			streetAggressorSeatIndex: null,
		},
	};

	const riverPlan = getNextPhasePlan(riverGameState);
	const foldedPlan = getNextPhasePlan(foldedGameState);

	assertEquals({
		type: riverPlan.type,
		reason: riverPlan.reason,
		completedPhase: riverPlan.completedPhase,
		phase: riverPlan.phase,
		cardsToDeal: riverPlan.cardsToDeal,
		gameStatePatch: riverPlan.gameStatePatch,
		streetEndReason: riverPlan.streetEndReason,
	}, {
		type: "showdown",
		reason: "showdown",
		completedPhase: "river",
		phase: "showdown",
		cardsToDeal: 0,
		gameStatePatch: {
			currentPhaseIndex: 4,
		},
		streetEndReason: "street_end_no_bet",
	});
	assertEquals({
		type: foldedPlan.type,
		reason: foldedPlan.reason,
		phase: foldedPlan.phase,
		gameStatePatch: foldedPlan.gameStatePatch,
		botIntentResetReason: foldedPlan.botIntentResetReason,
		activePlayers: foldedPlan.activePlayers.map((player) => player.name),
	}, {
		type: "showdown",
		reason: "onlyActivePlayer",
		phase: "showdown",
		gameStatePatch: {},
		botIntentResetReason: "hand_end",
		activePlayers: ["A"],
	});
});

Deno.test("dealCommunityCardsForPhase burns and deals without mutating state", () => {
	const gameState = {
		deck: ["2C", "3C", "4C", "5C"],
		cardGraveyard: ["AS"],
		communityCards: ["KH", "QD", "JS"],
	};
	const gameStateBefore = structuredClone(gameState);

	const result = dealCommunityCardsForPhase(gameState, 1);

	assertEquals(result, {
		burnedCard: "2C",
		dealtCards: ["3C"],
		gameStatePatch: {
			deck: ["4C", "5C"],
			cardGraveyard: ["AS", "2C", "3C"],
			communityCards: ["KH", "QD", "JS", "3C"],
		},
	});
	assertEquals(gameState, gameStateBefore);
});

Deno.test("dealCommunityCardsForPhase rejects overfilled boards without mutating state", () => {
	const gameState = {
		deck: ["2C", "3C"],
		cardGraveyard: [],
		communityCards: ["KH", "QD", "JS", "TC"],
	};
	const gameStateBefore = structuredClone(gameState);

	assertEquals(dealCommunityCardsForPhase(gameState, 2), null);
	assertEquals(gameState, gameStateBefore);
});
