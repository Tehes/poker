import {
	advanceDealer,
	createBettingRoundProgressState,
	createBettingRoundStartPlan,
	createHandEndPlan,
	createNextHandTransitionPlan,
	createShowdownCommitPlan,
	dealCommunityCardsForPhase,
	dealHoleCardsForNewHand,
	getBettingRoundStartExit,
	getBettingRoundStartIndex,
	getBlindLevelUpdateForHand,
	getNextBettingRoundStep,
	getNextPhasePlan,
	getResolvedTurnContinuation,
	hasPendingBettingRoundAction,
	isAllInRunout,
	postBlinds,
	resetPlayersForNewHand,
	resolveShowdown,
	resolveTurnAction,
	runEngineHand,
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

function applyPlayerPatches(playerPatches) {
	playerPatches.forEach(({ player, patch }) => {
		Object.assign(player, patch);
	});
}

function applyGameStatePatch(gameState, gameStatePatch) {
	Object.assign(gameState, gameStatePatch);
}

function applyHandContextPatch(gameState, handContextPatch) {
	if (!handContextPatch) {
		return;
	}
	Object.assign(gameState.handContext, handContextPatch);
}

function summarizeShowdown(result) {
	return {
		activePlayers: result.activePlayers.map((player) => player.name),
		contributors: result.contributors.map((player) => ({
			player: player.name,
			totalBet: player.totalBet,
		})),
		hadShowdown: result.hadShowdown,
		uncontestedWinner: result.uncontestedWinner?.name ?? null,
		mainPotWinners: result.mainPotWinners.map((player) => player.name),
		winningPlayers: result.winningPlayers.map((player) => player.name),
		transferQueue: result.transferQueue.map(({ player, amount }) => ({
			player: player.name,
			amount,
		})),
		potResults: result.potResults.map((potResult) => ({
			...potResult,
			players: potResult.players.slice().sort(),
		})),
		totalPayoutByPlayer: Array.from(result.totalPayoutByPlayer.entries()).map(
			([player, amount]) => ({
				player: player.name,
				amount,
			}),
		),
		totalPot: result.totalPot,
	};
}

function summarizeCommitPlan(plan) {
	return {
		playerPatches: plan.playerPatches.map(({ player, patch }) => ({
			player: player.name,
			patch,
		})),
		payoutPlayerPatches: plan.payoutPlayerPatches.map(({ player, patch }) => ({
			player: player.name,
			patch,
		})),
		payoutGameStatePatch: plan.payoutGameStatePatch,
		transferQueue: plan.transferQueue.map(({ player, amount }) => ({
			player: player.name,
			amount,
		})),
		revealPlayers: plan.revealPlayers.map((player) => player.name),
		mainPotWinners: plan.mainPotWinners.map((player) => player.name),
		winningPlayers: plan.winningPlayers.map((player) => player.name),
	};
}

function createFlowGameState({ players, deck, smallBlind = 10, bigBlind = 20 }) {
	return {
		currentPhaseIndex: 0,
		currentBet: 0,
		pot: 0,
		raisesThisRound: 0,
		blindLevel: 0,
		smallBlind,
		bigBlind,
		lastRaise: bigBlind,
		deck,
		cardGraveyard: [],
		communityCards: [],
		players,
		openCardsMode: false,
		spectatorMode: false,
		handContext: null,
		gameFinished: false,
		handInProgress: false,
		chipTransfer: null,
	};
}

function callOrCheckAction(gameState, player) {
	if (player.roundBet < gameState.currentBet) {
		return { action: "call" };
	}
	return { action: "check" };
}

function startEngineHand(gameState) {
	const nextHandPlan = createNextHandTransitionPlan(gameState, gameState.handId ?? 1);
	applyPlayerPatches(nextHandPlan.playerPatches);
	applyGameStatePatch(gameState, nextHandPlan.gameStatePatch);

	const dealerPlan = advanceDealer(gameState.players, 0);
	applyPlayerPatches(dealerPlan.playerPatches);
	gameState.players = dealerPlan.players;

	const blindPlan = postBlinds(gameState);
	applyPlayerPatches(blindPlan.playerPatches);
	applyGameStatePatch(gameState, blindPlan.gameStatePatch);

	const dealPlan = dealHoleCardsForNewHand(gameState, (deck) => deck);
	applyPlayerPatches(dealPlan.playerPatches);
	applyGameStatePatch(gameState, dealPlan.gameStatePatch);

	const roundStartPlan = applyBettingRoundStartPlanForTest(gameState);

	return {
		nextHandPlan,
		dealerPlan,
		blindPlan,
		dealPlan,
		roundStartPlan,
	};
}

function applyBettingRoundStartPlanForTest(gameState) {
	const roundStartPlan = createBettingRoundStartPlan(gameState);
	applyPlayerPatches(roundStartPlan.playerPatches);
	applyGameStatePatch(gameState, roundStartPlan.gameStatePatch);
	applyHandContextPatch(gameState, roundStartPlan.handContextPatch);
	return roundStartPlan;
}

Deno.test("resolveShowdown awards an uncontested pot", () => {
	const winner = createPlayer({
		name: "Winner",
		totalBet: 40,
		holeCards: ["AS", "AH"],
	});
	const folded = createPlayer({
		name: "Folded",
		seatIndex: 1,
		totalBet: 40,
		folded: true,
		holeCards: ["KS", "KH"],
	});
	const players = [winner, folded];
	const playersBefore = structuredClone(players);

	const result = resolveShowdown(players, ["2C", "7D", "9H", "TC", "3S"]);

	assertEquals(summarizeShowdown(result), {
		activePlayers: ["Winner"],
		contributors: [
			{ player: "Winner", totalBet: 40 },
			{ player: "Folded", totalBet: 40 },
		],
		hadShowdown: false,
		uncontestedWinner: "Winner",
		mainPotWinners: ["Winner"],
		winningPlayers: ["Winner"],
		transferQueue: [{ player: "Winner", amount: 80 }],
		potResults: [],
		totalPayoutByPlayer: [{ player: "Winner", amount: 80 }],
		totalPot: 80,
	});
	assertEquals(players, playersBefore);
});

Deno.test("resolveShowdown awards a normal showdown to the best hand", () => {
	const winner = createPlayer({
		name: "Aces",
		totalBet: 100,
		holeCards: ["AS", "AH"],
	});
	const loser = createPlayer({
		name: "Kings",
		seatIndex: 1,
		totalBet: 100,
		holeCards: ["KS", "KH"],
	});

	const result = resolveShowdown(
		[winner, loser],
		["2C", "7D", "9H", "TC", "3S"],
	);

	assertEquals(summarizeShowdown(result), {
		activePlayers: ["Aces", "Kings"],
		contributors: [
			{ player: "Aces", totalBet: 100 },
			{ player: "Kings", totalBet: 100 },
		],
		hadShowdown: true,
		uncontestedWinner: null,
		mainPotWinners: ["Aces"],
		winningPlayers: ["Aces"],
		transferQueue: [{ player: "Aces", amount: 200 }],
		potResults: [{
			players: ["Aces"],
			amount: 200,
			hand: "Pair",
			isRefundOnly: false,
		}],
		totalPayoutByPlayer: [{ player: "Aces", amount: 200 }],
		totalPot: 200,
	});
});

Deno.test("resolveShowdown splits a tied pot", () => {
	const playerA = createPlayer({
		name: "A",
		totalBet: 100,
		dealer: true,
		holeCards: ["2S", "3S"],
	});
	const playerB = createPlayer({
		name: "B",
		seatIndex: 1,
		totalBet: 100,
		holeCards: ["4D", "5D"],
	});

	const result = resolveShowdown(
		[playerA, playerB],
		["AS", "KD", "QH", "JC", "TC"],
	);

	assertEquals(summarizeShowdown(result), {
		activePlayers: ["A", "B"],
		contributors: [
			{ player: "A", totalBet: 100 },
			{ player: "B", totalBet: 100 },
		],
		hadShowdown: true,
		uncontestedWinner: null,
		mainPotWinners: ["A", "B"],
		winningPlayers: ["A", "B"],
		transferQueue: [
			{ player: "A", amount: 100 },
			{ player: "B", amount: 100 },
		],
		potResults: [{
			players: ["A", "B"],
			amount: 200,
			hand: null,
			isRefundOnly: false,
		}],
		totalPayoutByPlayer: [
			{ player: "A", amount: 100 },
			{ player: "B", amount: 100 },
		],
		totalPot: 200,
	});
});

Deno.test("resolveShowdown handles a side pot with an all-in player", () => {
	const allInWinner = createPlayer({
		name: "All-in",
		totalBet: 50,
		allIn: true,
		holeCards: ["AS", "AH"],
	});
	const sideWinner = createPlayer({
		name: "Side",
		seatIndex: 1,
		totalBet: 100,
		holeCards: ["KS", "KH"],
	});
	const loser = createPlayer({
		name: "Loser",
		seatIndex: 2,
		totalBet: 100,
		holeCards: ["QS", "QH"],
	});

	const result = resolveShowdown(
		[allInWinner, sideWinner, loser],
		["2C", "7D", "9H", "TC", "3S"],
	);

	assertEquals(summarizeShowdown(result), {
		activePlayers: ["All-in", "Side", "Loser"],
		contributors: [
			{ player: "All-in", totalBet: 50 },
			{ player: "Side", totalBet: 100 },
			{ player: "Loser", totalBet: 100 },
		],
		hadShowdown: true,
		uncontestedWinner: null,
		mainPotWinners: ["All-in"],
		winningPlayers: ["All-in", "Side"],
		transferQueue: [
			{ player: "All-in", amount: 150 },
			{ player: "Side", amount: 100 },
		],
		potResults: [
			{
				players: ["All-in"],
				amount: 150,
				hand: "Pair",
				isRefundOnly: false,
			},
			{
				players: ["Side"],
				amount: 100,
				hand: "Pair",
				isRefundOnly: false,
			},
		],
		totalPayoutByPlayer: [
			{ player: "All-in", amount: 150 },
			{ player: "Side", amount: 100 },
		],
		totalPot: 250,
	});
});

Deno.test("resolveShowdown marks refund-only side pots", () => {
	const mainWinner = createPlayer({
		name: "Main",
		totalBet: 50,
		allIn: true,
		holeCards: ["AS", "AH"],
	});
	const refunded = createPlayer({
		name: "Refunded",
		seatIndex: 1,
		totalBet: 100,
		holeCards: ["KS", "KH"],
	});

	const result = resolveShowdown(
		[mainWinner, refunded],
		["2C", "7D", "9H", "TC", "3S"],
	);

	assertEquals(summarizeShowdown(result), {
		activePlayers: ["Main", "Refunded"],
		contributors: [
			{ player: "Main", totalBet: 50 },
			{ player: "Refunded", totalBet: 100 },
		],
		hadShowdown: true,
		uncontestedWinner: null,
		mainPotWinners: ["Main"],
		winningPlayers: ["Main"],
		transferQueue: [
			{ player: "Main", amount: 100 },
			{ player: "Refunded", amount: 50 },
		],
		potResults: [
			{
				players: ["Main"],
				amount: 100,
				hand: "Pair",
				isRefundOnly: false,
			},
			{
				players: ["Refunded"],
				amount: 50,
				hand: null,
				isRefundOnly: true,
			},
		],
		totalPayoutByPlayer: [
			{ player: "Main", amount: 100 },
			{ player: "Refunded", amount: 50 },
		],
		totalPot: 150,
	});
});

Deno.test("createShowdownCommitPlan commits normal showdown stats, reveal, winners, and payout", () => {
	const winner = createPlayer({
		name: "Aces",
		chips: 900,
		roundBet: 100,
		totalBet: 100,
		stats: createStats({ hands: 3 }),
		holeCards: ["AS", "AH"],
		visibleHoleCards: [false, false],
	});
	const loser = createPlayer({
		name: "Kings",
		seatIndex: 1,
		chips: 900,
		roundBet: 100,
		totalBet: 100,
		stats: createStats({ hands: 3 }),
		holeCards: ["KS", "KH"],
		visibleHoleCards: [false, false],
	});
	const gameState = {
		pot: 200,
		players: [winner, loser],
	};
	const gameStateBefore = structuredClone(gameState);
	const showdown = resolveShowdown(
		gameState.players,
		["2C", "7D", "9H", "TC", "3S"],
	);

	const plan = createShowdownCommitPlan(gameState, showdown);
	const winnerPatch = plan.playerPatches.find((entry) => entry.player === winner).patch;
	const loserPatch = plan.playerPatches.find((entry) => entry.player === loser).patch;
	const planSummary = summarizeCommitPlan(plan);

	assertEquals({
		winnerPatch: {
			roundBet: winnerPatch.roundBet,
			visibleHoleCards: winnerPatch.visibleHoleCards,
			isWinner: winnerPatch.isWinner,
			handsWon: winnerPatch.stats.handsWon,
			showdowns: winnerPatch.stats.showdowns,
			showdownsWon: winnerPatch.stats.showdownsWon,
		},
		loserPatch: {
			roundBet: loserPatch.roundBet,
			visibleHoleCards: loserPatch.visibleHoleCards,
			handsWon: loserPatch.stats.handsWon,
			showdowns: loserPatch.stats.showdowns,
			showdownsWon: loserPatch.stats.showdownsWon,
		},
		plan: {
			payoutPlayerPatches: planSummary.payoutPlayerPatches,
			payoutGameStatePatch: planSummary.payoutGameStatePatch,
			transferQueue: planSummary.transferQueue,
			revealPlayers: planSummary.revealPlayers,
			mainPotWinners: planSummary.mainPotWinners,
			winningPlayers: planSummary.winningPlayers,
		},
	}, {
		winnerPatch: {
			roundBet: 0,
			visibleHoleCards: [true, true],
			isWinner: true,
			handsWon: 1,
			showdowns: 1,
			showdownsWon: 1,
		},
		loserPatch: {
			roundBet: 0,
			visibleHoleCards: [true, true],
			handsWon: 0,
			showdowns: 1,
			showdownsWon: 0,
		},
		plan: {
			payoutPlayerPatches: [{
				player: "Aces",
				patch: {
					chips: 1100,
				},
			}],
			payoutGameStatePatch: {
				pot: 0,
			},
			transferQueue: [{ player: "Aces", amount: 200 }],
			revealPlayers: ["Aces", "Kings"],
			mainPotWinners: ["Aces"],
			winningPlayers: ["Aces"],
		},
	});
	assertEquals(gameState, gameStateBefore);
});

Deno.test("createShowdownCommitPlan keeps uncontested wins out of showdown stats", () => {
	const winner = createPlayer({
		name: "Winner",
		chips: 960,
		roundBet: 40,
		totalBet: 40,
		stats: createStats({ hands: 2 }),
		holeCards: ["AS", "AH"],
	});
	const folded = createPlayer({
		name: "Folded",
		seatIndex: 1,
		chips: 960,
		roundBet: 40,
		totalBet: 40,
		folded: true,
		stats: createStats({ hands: 2 }),
		holeCards: ["KS", "KH"],
	});
	const gameState = {
		pot: 80,
		players: [winner, folded],
	};
	const showdown = resolveShowdown(
		gameState.players,
		["2C", "7D", "9H", "TC", "3S"],
	);

	const plan = createShowdownCommitPlan(gameState, showdown);
	const winnerPatch = plan.playerPatches.find((entry) => entry.player === winner).patch;
	const foldedPatch = plan.playerPatches.find((entry) => entry.player === folded).patch;

	assertEquals({
		winnerPatch: {
			roundBet: winnerPatch.roundBet,
			visibleHoleCards: winnerPatch.visibleHoleCards ?? null,
			isWinner: winnerPatch.isWinner,
			handsWon: winnerPatch.stats.handsWon,
			showdowns: winnerPatch.stats.showdowns,
			showdownsWon: winnerPatch.stats.showdownsWon,
		},
		foldedPatch,
		payoutPlayerPatches: summarizeCommitPlan(plan).payoutPlayerPatches,
		revealPlayers: summarizeCommitPlan(plan).revealPlayers,
	}, {
		winnerPatch: {
			roundBet: 0,
			visibleHoleCards: null,
			isWinner: true,
			handsWon: 1,
			showdowns: 0,
			showdownsWon: 0,
		},
		foldedPatch: {
			roundBet: 0,
		},
		payoutPlayerPatches: [{
			player: "Winner",
			patch: {
				chips: 1040,
			},
		}],
		revealPlayers: [],
	});
});

Deno.test("createShowdownCommitPlan pays refund-only pots without winner stats", () => {
	const mainWinner = createPlayer({
		name: "Main",
		chips: 950,
		roundBet: 50,
		totalBet: 50,
		allIn: true,
		stats: createStats(),
		holeCards: ["AS", "AH"],
	});
	const refunded = createPlayer({
		name: "Refunded",
		seatIndex: 1,
		chips: 900,
		roundBet: 100,
		totalBet: 100,
		stats: createStats(),
		holeCards: ["KS", "KH"],
	});
	const gameState = {
		pot: 150,
		players: [mainWinner, refunded],
	};
	const showdown = resolveShowdown(
		gameState.players,
		["2C", "7D", "9H", "TC", "3S"],
	);

	const plan = createShowdownCommitPlan(gameState, showdown);
	const mainWinnerPatch = plan.playerPatches.find((entry) => entry.player === mainWinner).patch;
	const refundedPatch = plan.playerPatches.find((entry) => entry.player === refunded).patch;

	assertEquals({
		mainWinner: {
			isWinner: mainWinnerPatch.isWinner,
			handsWon: mainWinnerPatch.stats.handsWon,
			showdowns: mainWinnerPatch.stats.showdowns,
			showdownsWon: mainWinnerPatch.stats.showdownsWon,
		},
		refunded: {
			isWinner: refundedPatch.isWinner ?? false,
			handsWon: refundedPatch.stats.handsWon,
			showdowns: refundedPatch.stats.showdowns,
			showdownsWon: refundedPatch.stats.showdownsWon,
		},
		payoutPlayerPatches: summarizeCommitPlan(plan).payoutPlayerPatches,
		winningPlayers: summarizeCommitPlan(plan).winningPlayers,
	}, {
		mainWinner: {
			isWinner: true,
			handsWon: 1,
			showdowns: 1,
			showdownsWon: 1,
		},
		refunded: {
			isWinner: false,
			handsWon: 0,
			showdowns: 1,
			showdownsWon: 0,
		},
		payoutPlayerPatches: [
			{ player: "Main", patch: { chips: 1050 } },
			{ player: "Refunded", patch: { chips: 950 } },
		],
		winningPlayers: ["Main"],
	});
});

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

Deno.test("createBettingRoundStartPlan keeps preflop blind bets", () => {
	const button = createPlayer({
		name: "Button",
		smallBlind: true,
		roundBet: 10,
		spotState: {
			actedThisStreet: true,
			voluntaryThisStreet: true,
			aggressiveThisStreet: true,
			enteredPreflop: true,
		},
	});
	const bigBlind = createPlayer({
		name: "Big Blind",
		seatIndex: 1,
		bigBlind: true,
		roundBet: 20,
		spotState: {
			actedThisStreet: true,
			voluntaryThisStreet: false,
			aggressiveThisStreet: false,
			enteredPreflop: false,
		},
	});
	const gameState = {
		currentPhaseIndex: 0,
		currentBet: 20,
		lastRaise: 20,
		bigBlind: 20,
		raisesThisRound: 3,
		handContext: {
			streetAggressorSeatIndex: 1,
		},
		players: [button, bigBlind],
	};
	const gameStateBefore = structuredClone(gameState);

	const result = createBettingRoundStartPlan(gameState);

	assertEquals({
		playerPatches: result.playerPatches.map(({ player, patch }) => ({
			player: player.name,
			patch,
		})),
		gameStatePatch: result.gameStatePatch,
		handContextPatch: result.handContextPatch,
		botIntentResetReason: result.botIntentResetReason,
	}, {
		playerPatches: [
			{
				player: "Button",
				patch: {
					spotState: {
						actedThisStreet: false,
						voluntaryThisStreet: false,
						aggressiveThisStreet: false,
						enteredPreflop: true,
					},
				},
			},
			{
				player: "Big Blind",
				patch: {
					spotState: {
						actedThisStreet: false,
						voluntaryThisStreet: false,
						aggressiveThisStreet: false,
						enteredPreflop: false,
					},
				},
			},
		],
		gameStatePatch: {
			raisesThisRound: 0,
		},
		handContextPatch: {
			streetAggressorSeatIndex: null,
		},
		botIntentResetReason: null,
	});
	assertEquals(gameState, gameStateBefore);
});

Deno.test("createBettingRoundStartPlan resets postflop betting state", () => {
	const playerA = createPlayer({
		name: "A",
		roundBet: 80,
		spotState: {
			actedThisStreet: true,
			voluntaryThisStreet: true,
			aggressiveThisStreet: true,
			enteredPreflop: true,
		},
	});
	const playerB = createPlayer({
		name: "B",
		seatIndex: 1,
		roundBet: 80,
		spotState: {
			actedThisStreet: true,
			voluntaryThisStreet: true,
			aggressiveThisStreet: false,
			enteredPreflop: true,
		},
	});
	const gameState = {
		currentPhaseIndex: 2,
		currentBet: 80,
		lastRaise: 40,
		bigBlind: 20,
		raisesThisRound: 2,
		handContext: {
			streetAggressorSeatIndex: 0,
		},
		players: [playerA, playerB],
	};
	const gameStateBefore = structuredClone(gameState);

	const result = createBettingRoundStartPlan(gameState);

	assertEquals({
		playerPatches: result.playerPatches.map(({ player, patch }) => ({
			player: player.name,
			patch,
		})),
		gameStatePatch: result.gameStatePatch,
		handContextPatch: result.handContextPatch,
		botIntentResetReason: result.botIntentResetReason,
	}, {
		playerPatches: [
			{
				player: "A",
				patch: {
					spotState: {
						actedThisStreet: false,
						voluntaryThisStreet: false,
						aggressiveThisStreet: false,
						enteredPreflop: true,
					},
					roundBet: 0,
				},
			},
			{
				player: "B",
				patch: {
					spotState: {
						actedThisStreet: false,
						voluntaryThisStreet: false,
						aggressiveThisStreet: false,
						enteredPreflop: true,
					},
					roundBet: 0,
				},
			},
		],
		gameStatePatch: {
			raisesThisRound: 0,
			currentBet: 0,
			lastRaise: 20,
		},
		handContextPatch: {
			streetAggressorSeatIndex: null,
		},
		botIntentResetReason: "street_reset",
	});
	assertEquals(gameState, gameStateBefore);
});

Deno.test("createBettingRoundStartPlan creates missing hand and spot state", () => {
	const player = createPlayer({ roundBet: 30 });
	const gameState = {
		currentPhaseIndex: 1,
		currentBet: 30,
		lastRaise: 20,
		bigBlind: 20,
		raisesThisRound: 1,
		handContext: null,
		players: [player],
	};
	const gameStateBefore = structuredClone(gameState);

	const result = createBettingRoundStartPlan(gameState);

	assertEquals({
		playerPatch: result.playerPatches[0].patch,
		gameStatePatch: result.gameStatePatch,
		handContextPatch: result.handContextPatch,
	}, {
		playerPatch: {
			spotState: {
				actedThisStreet: false,
				voluntaryThisStreet: false,
				aggressiveThisStreet: false,
				enteredPreflop: false,
			},
			roundBet: 0,
		},
		gameStatePatch: {
			raisesThisRound: 0,
			currentBet: 0,
			lastRaise: 20,
			handContext: {
				preflopRaiseCount: 0,
				preflopAggressorSeatIndex: null,
				streetAggressorSeatIndex: null,
				flopCheckedThrough: false,
				turnCheckedThrough: false,
				streetCheckCounts: {
					flop: 0,
					turn: 0,
					river: 0,
				},
				streetAggressiveActionCounts: {
					flop: 0,
					turn: 0,
					river: 0,
				},
			},
		},
		handContextPatch: null,
	});
	assertEquals(gameState, gameStateBefore);
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

Deno.test("createHandEndPlan clears deterministic hand-end state without mutating input", () => {
	const gameState = {
		pot: 120,
		handInProgress: true,
		activeSeatIndex: 1,
		pendingAction: { player: "A" },
		chipTransfer: { active: true },
	};
	const gameStateBefore = structuredClone(gameState);

	const result = createHandEndPlan(gameState);

	assertEquals(result, {
		gameStatePatch: {
			pot: 0,
			handInProgress: false,
			activeSeatIndex: null,
			pendingAction: null,
			chipTransfer: null,
		},
	});
	assertEquals(gameState, gameStateBefore);
});

Deno.test("createNextHandTransitionPlan starts a new hand with remaining players", () => {
	const human = createPlayer({
		name: "Human",
		chips: 140,
		isBot: false,
		stats: createStats({ hands: 2 }),
		folded: true,
		isWinner: true,
	});
	const bot = createPlayer({
		name: "Bot",
		seatIndex: 1,
		chips: 220,
		isBot: true,
		stats: createStats({ hands: 4 }),
	});
	const busted = createPlayer({
		name: "Busted",
		seatIndex: 2,
		chips: 0,
		isBot: true,
		stats: createStats({ hands: 5 }),
	});
	const gameState = {
		currentPhaseIndex: 4,
		currentBet: 80,
		pot: 160,
		raisesThisRound: 2,
		gameFinished: true,
		handInProgress: false,
		activeSeatIndex: 2,
		pendingAction: { player: "Busted" },
		chipTransfer: { active: true },
		communityCards: ["AS", "KH", "QC", "JD", "TC"],
		openCardsMode: false,
		spectatorMode: false,
		players: [human, bot, busted],
	};
	const gameStateBefore = structuredClone(gameState);

	const result = createNextHandTransitionPlan(gameState, 12);

	assertEquals({
		type: result.type,
		champion: result.champion,
		bustedPlayers: result.bustedPlayers.map((player) => player.name),
		remainingPlayers: result.remainingPlayers.map((player) => player.name),
	}, {
		type: "next-hand",
		champion: null,
		bustedPlayers: ["Busted"],
		remainingPlayers: ["Human", "Bot"],
	});
	assertEquals(gameState, gameStateBefore);

	applyPlayerPatches(result.playerPatches);
	applyGameStatePatch(gameState, result.gameStatePatch);
	assertEquals({
		currentPhaseIndex: gameState.currentPhaseIndex,
		currentBet: gameState.currentBet,
		pot: gameState.pot,
		raisesThisRound: gameState.raisesThisRound,
		gameFinished: gameState.gameFinished,
		handInProgress: gameState.handInProgress,
		handId: gameState.handId,
		nextDecisionId: gameState.nextDecisionId,
		activeSeatIndex: gameState.activeSeatIndex,
		pendingAction: gameState.pendingAction,
		chipTransfer: gameState.chipTransfer,
		communityCards: gameState.communityCards,
		players: gameState.players.map((player) => player.name),
		humanHands: human.stats.hands,
		humanWinner: human.isWinner,
		bustedChips: busted.chips,
	}, {
		currentPhaseIndex: 0,
		currentBet: 0,
		pot: 0,
		raisesThisRound: 0,
		gameFinished: false,
		handInProgress: true,
		handId: 12,
		nextDecisionId: 1,
		activeSeatIndex: null,
		pendingAction: null,
		chipTransfer: null,
		communityCards: [],
		players: ["Human", "Bot"],
		humanHands: 3,
		humanWinner: false,
		bustedChips: 0,
	});
});

Deno.test("createNextHandTransitionPlan marks the last remaining player as champion", () => {
	const champion = createPlayer({
		name: "Champion",
		chips: 400,
		isBot: false,
		stats: createStats({ hands: 7 }),
	});
	const busted = createPlayer({
		name: "Busted",
		seatIndex: 1,
		chips: -20,
		isBot: true,
		stats: createStats({ hands: 7 }),
	});
	const gameState = {
		currentPhaseIndex: 4,
		currentBet: 40,
		pot: 80,
		raisesThisRound: 1,
		gameFinished: false,
		handInProgress: true,
		activeSeatIndex: 1,
		pendingAction: { player: "Busted" },
		chipTransfer: { active: true },
		communityCards: ["2C", "3D", "4H", "5S", "6C"],
		openCardsMode: false,
		spectatorMode: false,
		players: [champion, busted],
	};
	const gameStateBefore = structuredClone(gameState);

	const result = createNextHandTransitionPlan(gameState, 18);

	assertEquals({
		type: result.type,
		champion: result.champion.name,
		bustedPlayers: result.bustedPlayers.map((player) => player.name),
		remainingPlayers: result.remainingPlayers.map((player) => player.name),
	}, {
		type: "game-over",
		champion: "Champion",
		bustedPlayers: ["Busted"],
		remainingPlayers: ["Champion"],
	});
	assertEquals(gameState, gameStateBefore);

	applyPlayerPatches(result.playerPatches);
	applyGameStatePatch(gameState, result.gameStatePatch);
	assertEquals({
		gameFinished: gameState.gameFinished,
		handInProgress: gameState.handInProgress,
		activeSeatIndex: gameState.activeSeatIndex,
		pendingAction: gameState.pendingAction,
		players: gameState.players.map((player) => player.name),
		championWinner: champion.isWinner,
		championHands: champion.stats.hands,
		bustedChips: busted.chips,
	}, {
		gameFinished: true,
		handInProgress: false,
		activeSeatIndex: null,
		pendingAction: null,
		players: ["Champion"],
		championWinner: true,
		championHands: 8,
		bustedChips: 0,
	});
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

Deno.test("heads-up setup makes dealer the small blind and starts preflop action on the dealer", () => {
	const button = createPlayer({ name: "Button", seatIndex: 0, chips: 1000 });
	const bigBlind = createPlayer({ name: "Big Blind", seatIndex: 1, chips: 1000 });
	const gameState = createFlowGameState({
		players: [button, bigBlind],
		deck: ["AS", "AH", "KS", "KH"],
	});

	startEngineHand(gameState);
	const startIndex = getBettingRoundStartIndex(gameState.players, 0);

	assertEquals({
		players: gameState.players.map((player) => ({
			name: player.name,
			dealer: player.dealer,
			smallBlind: player.smallBlind,
			bigBlind: player.bigBlind,
			roundBet: player.roundBet,
		})),
		startIndex,
		startPlayer: gameState.players[startIndex].name,
	}, {
		players: [
			{
				name: "Button",
				dealer: true,
				smallBlind: true,
				bigBlind: false,
				roundBet: 10,
			},
			{
				name: "Big Blind",
				dealer: false,
				smallBlind: false,
				bigBlind: true,
				roundBet: 20,
			},
		],
		startIndex: 0,
		startPlayer: "Button",
	});
});

Deno.test("full engine flow plays a heads-up hand to showdown", () => {
	const button = createPlayer({ name: "Button", seatIndex: 0, chips: 1000 });
	const bigBlind = createPlayer({ name: "Big Blind", seatIndex: 1, chips: 1000 });
	const gameState = createFlowGameState({
		players: [button, bigBlind],
		deck: [
			"AS",
			"AH",
			"KS",
			"KH",
			"2C",
			"7D",
			"9H",
			"TC",
			"3S",
			"4C",
			"5C",
			"6D",
		],
	});

	const runResult = runEngineHand(gameState, callOrCheckAction, {
		shuffleFn: (deck) => deck,
	});
	const showdown = runResult.showdownResult;

	assertEquals({
		runType: runResult.type,
		actions: runResult.actions.map(({ player, resolvedAction }) => ({
			player: player.name,
			action: resolvedAction.action,
		})),
		phases: runResult.phasePlans.map((phasePlan) => phasePlan.phase),
		currentPhaseIndex: gameState.currentPhaseIndex,
		handInProgress: gameState.handInProgress,
		communityCards: gameState.communityCards,
		pot: gameState.pot,
		totalBets: gameState.players.map((player) => ({
			player: player.name,
			totalBet: player.totalBet,
		})),
		flopCheckedThrough: gameState.handContext.flopCheckedThrough,
		turnCheckedThrough: gameState.handContext.turnCheckedThrough,
		showdown: summarizeShowdown(showdown),
		chips: gameState.players.map((player) => ({
			player: player.name,
			chips: player.chips,
		})),
	}, {
		runType: "showdown",
		actions: [
			{ player: "Button", action: "call" },
			{ player: "Big Blind", action: "check" },
			{ player: "Big Blind", action: "check" },
			{ player: "Button", action: "check" },
			{ player: "Big Blind", action: "check" },
			{ player: "Button", action: "check" },
			{ player: "Big Blind", action: "check" },
			{ player: "Button", action: "check" },
		],
		phases: ["flop", "turn", "river", "showdown"],
		currentPhaseIndex: 4,
		handInProgress: false,
		communityCards: ["7D", "9H", "TC", "4C", "6D"],
		pot: 0,
		totalBets: [
			{ player: "Button", totalBet: 20 },
			{ player: "Big Blind", totalBet: 20 },
		],
		flopCheckedThrough: true,
		turnCheckedThrough: true,
		showdown: {
			activePlayers: ["Button", "Big Blind"],
			contributors: [
				{ player: "Button", totalBet: 20 },
				{ player: "Big Blind", totalBet: 20 },
			],
			hadShowdown: true,
			uncontestedWinner: null,
			mainPotWinners: ["Button"],
			winningPlayers: ["Button"],
			transferQueue: [{ player: "Button", amount: 40 }],
			potResults: [{
				players: ["Button"],
				amount: 40,
				hand: "Pair",
				isRefundOnly: false,
			}],
			totalPayoutByPlayer: [{ player: "Button", amount: 40 }],
			totalPot: 40,
		},
		chips: [
			{ player: "Button", chips: 1020 },
			{ player: "Big Blind", chips: 980 },
		],
	});
});

Deno.test("full engine flow removes a busted player after a three-player hand", () => {
	const dealer = createPlayer({ name: "Dealer", seatIndex: 0, chips: 1000 });
	const smallBlind = createPlayer({ name: "Small Blind", seatIndex: 1, chips: 1000 });
	const shortStack = createPlayer({ name: "Short", seatIndex: 2, chips: 20 });
	const gameState = createFlowGameState({
		players: [dealer, smallBlind, shortStack],
		deck: [
			"AS",
			"AH",
			"KS",
			"KH",
			"QS",
			"QH",
			"2C",
			"7D",
			"9H",
			"TC",
			"3S",
			"4C",
			"5C",
			"6D",
		],
	});

	const runResult = runEngineHand(gameState, callOrCheckAction, {
		shuffleFn: (deck) => deck,
	});
	const showdown = runResult.showdownResult;
	const showdownSummary = summarizeShowdown(showdown);
	const nextHandPlan = createNextHandTransitionPlan(gameState, 2);
	applyPlayerPatches(nextHandPlan.playerPatches);
	applyGameStatePatch(gameState, nextHandPlan.gameStatePatch);

	assertEquals({
		runType: runResult.type,
		runActions: runResult.actions.map(({ player, resolvedAction }) => ({
			player: player.name,
			action: resolvedAction.action,
		})),
		nextHandType: nextHandPlan.type,
		communityCards: gameState.communityCards,
		showdown: showdownSummary,
		bustedPlayers: nextHandPlan.bustedPlayers.map((player) => player.name),
		remainingPlayers: gameState.players.map((player) => player.name),
		chips: [dealer, smallBlind, shortStack].map((player) => ({
			player: player.name,
			chips: player.chips,
		})),
	}, {
		runType: "showdown",
		runActions: [
			{ player: "Dealer", action: "call" },
			{ player: "Small Blind", action: "call" },
			{ player: "Small Blind", action: "check" },
			{ player: "Dealer", action: "check" },
			{ player: "Small Blind", action: "check" },
			{ player: "Dealer", action: "check" },
			{ player: "Small Blind", action: "check" },
			{ player: "Dealer", action: "check" },
		],
		nextHandType: "next-hand",
		communityCards: [],
		showdown: {
			activePlayers: ["Dealer", "Small Blind", "Short"],
			contributors: [
				{ player: "Dealer", totalBet: 20 },
				{ player: "Small Blind", totalBet: 20 },
				{ player: "Short", totalBet: 20 },
			],
			hadShowdown: true,
			uncontestedWinner: null,
			mainPotWinners: ["Dealer"],
			winningPlayers: ["Dealer"],
			transferQueue: [{ player: "Dealer", amount: 60 }],
			potResults: [{
				players: ["Dealer"],
				amount: 60,
				hand: "Pair",
				isRefundOnly: false,
			}],
			totalPayoutByPlayer: [{ player: "Dealer", amount: 60 }],
			totalPot: 60,
		},
		bustedPlayers: ["Short"],
		remainingPlayers: ["Dealer", "Small Blind"],
		chips: [
			{ player: "Dealer", chips: 1040 },
			{ player: "Small Blind", chips: 980 },
			{ player: "Short", chips: 0 },
		],
	});
});

Deno.test("full engine flow runs out a preflop all-in", () => {
	const button = createPlayer({ name: "Button", seatIndex: 0, chips: 1000 });
	const shortStack = createPlayer({ name: "Short", seatIndex: 1, chips: 20 });
	const gameState = createFlowGameState({
		players: [button, shortStack],
		deck: [
			"KS",
			"KH",
			"AS",
			"AH",
			"2C",
			"7D",
			"9H",
			"TC",
			"3S",
			"4C",
			"5C",
			"6D",
		],
	});

	const runResult = runEngineHand(gameState, callOrCheckAction, {
		shuffleFn: (deck) => deck,
	});
	const isRunout = isAllInRunout(gameState.players, gameState.currentBet);
	const showdown = runResult.showdownResult;

	assertEquals({
		runType: runResult.type,
		isRunout,
		phases: runResult.phasePlans.map((phasePlan) => phasePlan.phase),
		actions: runResult.actions.map(({ player, resolvedAction }) => ({
			player: player.name,
			action: resolvedAction.action,
		})),
		currentPhaseIndex: gameState.currentPhaseIndex,
		communityCards: gameState.communityCards,
		shortAllIn: shortStack.allIn,
		showdown: summarizeShowdown(showdown),
		chips: gameState.players.map((player) => ({
			player: player.name,
			chips: player.chips,
		})),
	}, {
		runType: "showdown",
		isRunout: true,
		phases: ["flop", "turn", "river", "showdown"],
		actions: [],
		currentPhaseIndex: 4,
		communityCards: ["7D", "9H", "TC", "4C", "6D"],
		shortAllIn: true,
		showdown: {
			activePlayers: ["Button", "Short"],
			contributors: [
				{ player: "Button", totalBet: 10 },
				{ player: "Short", totalBet: 20 },
			],
			hadShowdown: true,
			uncontestedWinner: null,
			mainPotWinners: ["Short"],
			winningPlayers: ["Short"],
			transferQueue: [
				{ player: "Short", amount: 20 },
				{ player: "Short", amount: 10 },
			],
			potResults: [{
				players: ["Short"],
				amount: 20,
				hand: "Pair",
				isRefundOnly: false,
			}, {
				players: ["Short"],
				amount: 10,
				hand: null,
				isRefundOnly: true,
			}],
			totalPayoutByPlayer: [{ player: "Short", amount: 30 }],
			totalPot: 30,
		},
		chips: [
			{ player: "Button", chips: 990 },
			{ player: "Short", chips: 30 },
		],
	});
});
