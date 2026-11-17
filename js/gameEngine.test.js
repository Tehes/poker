import {
	advanceDealer,
	createBettingRoundProgressState,
	createBettingRoundStartPlan,
	createHandEndPlan,
	createNextHandTransitionPlan,
	createPlayerSpotState,
	createShowdownCommitPlan,
	dealCommunityCardsForPhase,
	dealHoleCardsForNewHand,
	getBettingRoundStartExit,
	getBettingRoundStartIndex,
	getBlindLevelUpdateForHand,
	getNextBettingRoundStep,
	getNextPhasePlan,
	getPlayerActionStatsContext,
	getPlayerTournamentPlacement,
	getResolvedTurnContinuation,
	hasPendingBettingRoundAction,
	INITIAL_DECK,
	isAllInRunout,
	postBlinds,
	recordPlayerActionStats,
	resetPlayersForNewHand,
	resolveShowdown,
	resolveTurnAction,
	runEngineHand,
	runEngineTournament,
	secureRandomInt,
	shuffleArray,
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
		flopsSeen: 0,
		handsWonAfterFlop: 0,
		vpip: 0,
		pfr: 0,
		threeBets: 0,
		threeBetOpportunities: 0,
		foldsToThreeBet: 0,
		foldToThreeBetOpportunities: 0,
		raisesFirstIn: 0,
		raiseFirstInOpportunities: 0,
		stealAttempts: 0,
		stealOpportunities: 0,
		foldsBigBlindToSteal: 0,
		bigBlindStealOpportunities: 0,
		flopCbets: 0,
		flopCbetOpportunities: 0,
		foldsToFlopCbet: 0,
		foldToFlopCbetOpportunities: 0,
		calls: 0,
		aggressiveActs: 0,
		reveals: 0,
		showdowns: 0,
		showdownsWon: 0,
		folds: 0,
		foldsPreflop: 0,
		foldsPostflop: 0,
		allins: 0,
		allinCalls: 0,
		aggressiveAllins: 0,
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

function applyActionForStatsTest(gameState, player, actionRequest) {
	const resolved = resolveTurnAction(gameState, player, actionRequest);
	Object.assign(resolved.actionMeta, getPlayerActionStatsContext(gameState, player));
	Object.assign(player, resolved.playerPatch);
	Object.assign(gameState, resolved.gameStatePatch);
	recordPlayerActionStats(gameState, player, resolved.action, resolved.actionMeta);
	return resolved;
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

function createPreflopStatsTable(playerCount = 6) {
	const players = Array.from(
		{ length: playerCount },
		(_, seatIndex) => createPlayer({ seatIndex, stats: createStats() }),
	);
	const gameState = createFlowGameState({ players, deck: INITIAL_DECK.slice() });
	startEngineHand(gameState);
	return { players, gameState };
}

function createFlopStatsTable(playerCount = 3, threeBet = false) {
	const table = createPreflopStatsTable(playerCount);
	const { players, gameState } = table;
	applyActionForStatsTest(gameState, players[0], { action: "raise", amount: 80 });
	if (threeBet) {
		applyActionForStatsTest(gameState, players[1], { action: "raise", amount: 200 });
	}
	for (const player of players) {
		if (player.roundBet < gameState.currentBet) {
			applyActionForStatsTest(gameState, player, { action: "call" });
		}
	}
	const phasePlan = getNextPhasePlan(gameState);
	applyGameStatePatch(gameState, phasePlan.gameStatePatch);
	applyHandContextPatch(gameState, phasePlan.handContextPatch);
	const dealPlan = dealCommunityCardsForPhase(gameState, phasePlan.cardsToDeal);
	applyPlayerPatches(dealPlan.playerPatches);
	applyGameStatePatch(gameState, dealPlan.gameStatePatch);
	applyBettingRoundStartPlanForTest(gameState);
	return table;
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

Deno.test("preflop stats count a call and repeated raises once per hand", () => {
	const player = createPlayer({ stats: createStats({ hands: 1 }) });
	const gameState = { currentPhaseIndex: 0, players: [player] };

	recordPlayerActionStats(gameState, player, "call");
	assertEquals([player.stats.vpip, player.stats.pfr], [1, 0]);
	recordPlayerActionStats(gameState, player, "raise");
	recordPlayerActionStats(gameState, player, "raise");
	recordPlayerActionStats(gameState, player, "call");
	assertEquals([player.stats.vpip, player.stats.pfr], [1, 1]);
	assertEquals(gameState.handContext.preflopRaiseCount, 2);
});

Deno.test("preflop stats count a raise first in as both VPIP and PFR", () => {
	const player = createPlayer({ stats: createStats({ hands: 1 }) });
	const gameState = { currentPhaseIndex: 0, players: [player] };

	recordPlayerActionStats(gameState, player, "raise");
	recordPlayerActionStats(gameState, player, "raise");
	assertEquals([player.stats.vpip, player.stats.pfr], [1, 1]);
});

Deno.test("preflop stats exclude forced blinds, checks, and folds", () => {
	const players = [
		createPlayer({ stats: createStats({ hands: 1 }) }),
		createPlayer({ seatIndex: 1, stats: createStats({ hands: 1 }) }),
	];
	const gameState = { currentPhaseIndex: 0, players, smallBlind: 10, bigBlind: 20 };
	const blindPlan = postBlinds(gameState);
	applyPlayerPatches(blindPlan.playerPatches);
	applyGameStatePatch(gameState, blindPlan.gameStatePatch);
	recordPlayerActionStats(gameState, players[0], "fold");
	recordPlayerActionStats(gameState, players[1], "check");

	assertEquals(players.map((player) => [player.stats.vpip, player.stats.pfr]), [[0, 0], [0, 0]]);
});

Deno.test("preflop stats distinguish all-in calls from all-in raises", () => {
	for (const chips of [10, 20, 100]) {
		const player = createPlayer({ chips, stats: createStats({ hands: 1 }) });
		const { gameState } = createGameState({ player, currentPhaseIndex: 0, currentBet: 20 });
		const resolved = resolveTurnAction(gameState, player, { action: "allin" });
		Object.assign(player, resolved.playerPatch);
		Object.assign(gameState, resolved.gameStatePatch);
		recordPlayerActionStats(gameState, player, resolved.action, resolved.actionMeta);

		assertEquals([player.stats.vpip, player.stats.pfr], [1, chips > 20 ? 1 : 0]);
		assertEquals([player.stats.calls, player.stats.aggressiveActs, player.stats.allins], [0, 0, 1]);
		assertEquals([player.stats.allinCalls, player.stats.aggressiveAllins], chips > 20 ? [0, 1] : [1, 0]);
	}
});

Deno.test("preflop stats count again in the next hand without changing earlier totals", () => {
	const players = [
		createPlayer({ stats: createStats() }),
		createPlayer({ seatIndex: 1, stats: createStats() }),
	];
	const gameState = { players };
	for (const handId of [1, 2]) {
		const plan = createNextHandTransitionPlan(gameState, handId);
		applyPlayerPatches(plan.playerPatches);
		applyGameStatePatch(gameState, plan.gameStatePatch);
		recordPlayerActionStats(gameState, players[0], "call");
		recordPlayerActionStats(gameState, players[0], "raise");
		recordPlayerActionStats(gameState, players[0], "raise");
		assertEquals([players[0].stats.hands, players[0].stats.vpip, players[0].stats.pfr], [handId, handId, handId]);
	}
});

Deno.test("preflop stats preserve hand markers through save and restore", () => {
	const player = createPlayer({ stats: createStats({ hands: 1 }) });
	const gameState = { currentPhaseIndex: 0, players: [player] };
	recordPlayerActionStats(gameState, player, "raise");
	const restoredState = JSON.parse(JSON.stringify(gameState));
	const restoredPlayer = restoredState.players[0];
	recordPlayerActionStats(restoredState, restoredPlayer, "call");
	recordPlayerActionStats(restoredState, restoredPlayer, "raise");
	assertEquals([restoredPlayer.stats.vpip, restoredPlayer.stats.pfr], [1, 1]);
});

Deno.test("postflop actions do not change VPIP or PFR and still count each raise", () => {
	const player = createPlayer({ stats: createStats({ hands: 1 }) });
	const gameState = { currentPhaseIndex: 1, players: [player] };
	recordPlayerActionStats(gameState, player, "raise");
	recordPlayerActionStats(gameState, player, "raise");
	recordPlayerActionStats(gameState, player, "call");
	assertEquals([player.stats.vpip, player.stats.pfr, player.stats.aggressiveActs, player.stats.calls], [0, 0, 2, 1]);
});

Deno.test("postflop all-in calls count as calls on every street", () => {
	for (const currentPhaseIndex of [1, 2, 3]) {
		for (const chips of [40, 100]) {
			for (const action of ["call", "allin"]) {
				const player = createPlayer({ chips, roundBet: 50, stats: createStats({ hands: 1 }) });
				const { gameState } = createGameState({ player, currentPhaseIndex, currentBet: 150 });
				const resolved = resolveTurnAction(gameState, player, { action });
				Object.assign(player, resolved.playerPatch);
				Object.assign(gameState, resolved.gameStatePatch);
				recordPlayerActionStats(gameState, player, resolved.action, resolved.actionMeta);

				assertEquals(resolved.action, "allin");
				assertEquals([player.stats.calls, player.stats.aggressiveActs, player.stats.allins], [1, 0, 1]);
				assertEquals([player.stats.allinCalls, player.stats.aggressiveAllins], [1, 0]);
			}
		}
	}
});

Deno.test("postflop all-in bets and raises stay aggressive instead of counting as calls", () => {
	for (
		const { currentBet, lastRaise, chips } of [
			{ currentBet: 0, lastRaise: 20, chips: 100 },
			{ currentBet: 20, lastRaise: 20, chips: 100 },
			{ currentBet: 100, lastRaise: 100, chips: 110 },
		]
	) {
		const player = createPlayer({ chips, stats: createStats({ hands: 1 }) });
		const { gameState } = createGameState({ player, currentPhaseIndex: 1, currentBet, lastRaise });
		const resolved = resolveTurnAction(gameState, player, { action: "allin" });
		Object.assign(player, resolved.playerPatch);
		Object.assign(gameState, resolved.gameStatePatch);
		recordPlayerActionStats(gameState, player, resolved.action, resolved.actionMeta);

		assertEquals([player.stats.calls, player.stats.aggressiveActs, player.stats.allins], [0, 1, 1]);
		assertEquals([player.stats.allinCalls, player.stats.aggressiveAllins], [0, 1]);
	}
});

Deno.test("flop c-bets count the last preflop raiser's first bet after checks", () => {
	for (const threeBet of [false, true]) {
		const { players, gameState } = createFlopStatsTable(3, threeBet);
		const aggressor = players[threeBet ? 1 : 0];
		for (const player of [players[1], players[2], players[0]]) {
			if (player === aggressor) {
				break;
			}
			applyActionForStatsTest(gameState, player, { action: "check" });
		}
		applyActionForStatsTest(gameState, aggressor, { action: "raise", amount: 100 });
		assertEquals([aggressor.stats.flopCbetOpportunities, aggressor.stats.flopCbets], [1, 1]);
		assertEquals(gameState.handContext.flopCbetSeatIndex, aggressor.seatIndex);
		assertEquals(players.filter((player) => player !== aggressor).map((player) => player.stats.flopCbets), [0, 0]);
	}
});

Deno.test("flop c-bet checks count as opportunities without turning a later check-raise into a c-bet", () => {
	const { players, gameState } = createFlopStatsTable(3, true);
	applyActionForStatsTest(gameState, players[1], { action: "check" });
	applyActionForStatsTest(gameState, players[2], { action: "raise", amount: 100 });
	applyActionForStatsTest(gameState, players[0], { action: "call" });
	applyActionForStatsTest(gameState, players[1], { action: "raise", amount: 300 });
	assertEquals([players[1].stats.flopCbetOpportunities, players[1].stats.flopCbets], [1, 0]);
	assertEquals(gameState.handContext.flopCbetSeatIndex, null);
	assertEquals(players.map((player) => player.stats.foldToFlopCbetOpportunities), [0, 0, 0]);
});

Deno.test("donk bets and limped pots do not produce flop c-bet observations", () => {
	const { players, gameState } = createFlopStatsTable();
	applyActionForStatsTest(gameState, players[1], { action: "raise", amount: 100 });
	applyActionForStatsTest(gameState, players[2], { action: "fold" });
	applyActionForStatsTest(gameState, players[0], { action: "raise", amount: 300 });
	assertEquals(players.map((player) => player.stats.flopCbetOpportunities), [0, 0, 0]);
	assertEquals(players.map((player) => player.stats.foldToFlopCbetOpportunities), [0, 0, 0]);

	const limped = createFlopStatsTable();
	limped.gameState.handContext.preflopAggressorSeatIndex = null;
	applyActionForStatsTest(limped.gameState, limped.players[1], { action: "raise", amount: 100 });
	applyActionForStatsTest(limped.gameState, limped.players[2], { action: "fold" });
	assertEquals(limped.players.map((player) => player.stats.flopCbets), [0, 0, 0]);
	assertEquals(limped.players[2].stats.foldToFlopCbetOpportunities, 0);
});

Deno.test("fold-to-flop-c-bet counts folds, calls, raises, and short all-in calls after a check", () => {
	for (const action of ["fold", "call", "raise", "allin"]) {
		for (const chips of [40, 100, 920]) {
			const { players, gameState } = createFlopStatsTable();
			players[1].chips = chips;
			applyActionForStatsTest(gameState, players[1], { action: "check" });
			applyActionForStatsTest(gameState, players[2], { action: "check" });
			applyActionForStatsTest(gameState, players[0], { action: "raise", amount: 100 });
			const resolved = applyActionForStatsTest(gameState, players[1], { action, amount: 300 });
			assertEquals([players[1].stats.foldToFlopCbetOpportunities, players[1].stats.foldsToFlopCbet], [
				1,
				action === "fold" ? 1 : 0,
			]);
			assertEquals([players[1].stats.calls, players[1].stats.aggressiveActs], [
				resolved.actionMeta.voluntary && !resolved.actionMeta.aggressive ? 1 : 0,
				resolved.actionMeta.aggressive ? 1 : 0,
			]);
		}
	}
});

Deno.test("multiway c-bet responses include an intervening call but exclude an intervening raise", () => {
	for (const action of ["call", "raise", "allin"]) {
		const { players, gameState } = createFlopStatsTable(3, true);
		applyActionForStatsTest(gameState, players[1], { action: "raise", amount: 100 });
		applyActionForStatsTest(gameState, players[2], { action, amount: 300 });
		applyActionForStatsTest(gameState, players[0], { action: "fold" });
		assertEquals(players[2].stats.foldToFlopCbetOpportunities, 1);
		assertEquals(players[0].stats.foldToFlopCbetOpportunities, action === "call" ? 1 : 0);
		assertEquals(players[0].stats.foldsToFlopCbet, action === "call" ? 1 : 0);
		assertEquals(players[1].stats.foldToFlopCbetOpportunities, 0);
	}
});

Deno.test("a c-bet caller's later response to a check-raise does not count twice", () => {
	const { players, gameState } = createFlopStatsTable(3, true);
	applyActionForStatsTest(gameState, players[1], { action: "raise", amount: 100 });
	applyActionForStatsTest(gameState, players[2], { action: "call" });
	applyActionForStatsTest(gameState, players[0], { action: "raise", amount: 300 });
	applyActionForStatsTest(gameState, players[1], { action: "fold" });
	applyActionForStatsTest(gameState, players[2], { action: "fold" });
	assertEquals([players[2].stats.foldToFlopCbetOpportunities, players[2].stats.foldsToFlopCbet], [1, 0]);
	assertEquals(players[1].stats.flopCbets, 1);
	assertEquals(players[1].stats.foldToFlopCbetOpportunities, 0);
});

Deno.test("short all-in flop bets count as c-bets, but all-in runouts offer no c-bet decision", () => {
	const { players, gameState } = createFlopStatsTable(2);
	players[0].chips = 10;
	applyActionForStatsTest(gameState, players[1], { action: "check" });
	applyActionForStatsTest(gameState, players[0], { action: "allin" });
	applyActionForStatsTest(gameState, players[1], { action: "call" });
	assertEquals([players[0].stats.flopCbetOpportunities, players[0].stats.flopCbets], [1, 1]);
	assertEquals([players[1].stats.foldToFlopCbetOpportunities, players[1].stats.foldsToFlopCbet], [1, 0]);
	for (const seat of [0, 1]) {
		const runout = createFlopStatsTable(2);
		runout.players[seat].chips = 0;
		runout.players[seat].allIn = true;
		assertEquals(getPlayerActionStatsContext(runout.gameState, runout.players[0]).flopCbetOpportunity, false);
	}
});

Deno.test("c-bet tracking uses public actions even when the aggressor has no stats or bot line", () => {
	const { players, gameState } = createFlopStatsTable(3, true);
	delete players[1].stats;
	delete players[1].botLine;
	applyActionForStatsTest(gameState, players[1], { action: "raise", amount: 100 });
	applyActionForStatsTest(gameState, players[2], { action: "fold" });
	assertEquals(gameState.handContext.flopCbetSeatIndex, 1);
	assertEquals([players[2].stats.foldToFlopCbetOpportunities, players[2].stats.foldsToFlopCbet], [1, 1]);
});

Deno.test("c-bet observations survive restore, stay on the flop, and reset at a new hand", () => {
	const { players, gameState } = createFlopStatsTable(3, true);
	applyActionForStatsTest(gameState, players[1], { action: "raise", amount: 100 });
	const restored = JSON.parse(JSON.stringify(gameState));
	applyActionForStatsTest(restored, restored.players[2], { action: "call" });
	applyActionForStatsTest(restored, restored.players[0], { action: "fold" });
	assertEquals(restored.handContext.flopCbetSeatIndex, 1);
	assertEquals(restored.players[1].spotState.flopCbetOpportunityCounted, true);
	assertEquals(restored.players[2].spotState.foldToFlopCbetOpportunityCounted, true);
	for (const currentPhaseIndex of [2, 3]) {
		restored.currentPhaseIndex = currentPhaseIndex;
		applyBettingRoundStartPlanForTest(restored);
		applyActionForStatsTest(restored, restored.players[1], { action: "raise", amount: 100 });
		applyActionForStatsTest(restored, restored.players[2], { action: "call" });
		assertEquals(restored.players[1].stats.flopCbets, 1);
		assertEquals(
			[restored.players[2].stats.foldToFlopCbetOpportunities, restored.players[2].stats.foldsToFlopCbet],
			[1, 0],
		);
	}
	const next = createNextHandTransitionPlan(restored, 2);
	applyPlayerPatches(next.playerPatches);
	applyGameStatePatch(restored, next.gameStatePatch);
	assertEquals(restored.handContext.flopCbetSeatIndex, null);
	assertEquals(restored.players[1].spotState.flopCbetOpportunityCounted, false);
	assertEquals(restored.players[2].spotState.foldToFlopCbetOpportunityCounted, false);
	assertEquals(restored.players[1].stats.flopCbets, 1);
});

Deno.test("hand positions stay fixed when players fold and cover every table size", () => {
	for (
		const positions of [
			["smallBlind", "bigBlind"],
			["button", "smallBlind", "bigBlind"],
			["button", "smallBlind", "bigBlind", "cutoff"],
			["button", "smallBlind", "bigBlind", "early", "cutoff"],
			["button", "smallBlind", "bigBlind", "early", "middle", "cutoff"],
		]
	) {
		const { players, gameState } = createPreflopStatsTable(positions.length);
		assertEquals(players.map((player) => player.spotState.position), positions);
		assertEquals(players.map((player) => player.spotState.tableSize), positions.map(() => positions.length));
		if (positions.length === 6) {
			applyActionForStatsTest(gameState, players[3], { action: "fold" });
			applyActionForStatsTest(gameState, players[4], { action: "fold" });
			assertEquals(players.map((player) => player.spotState.position), positions);
			const context = getPlayerActionStatsContext(gameState, players[5]);
			assertEquals([context.raiseFirstInOpportunity, context.stealOpportunity], [true, true]);
		}
	}
});

Deno.test("steal attempts and big blind responses cover cutoff, button, and small blind", () => {
	for (const seat of [5, 0, 1]) {
		for (const action of ["fold", "call", "raise", "allin"]) {
			const { players, gameState } = createPreflopStatsTable();
			const order = [3, 4, 5, 0, 1, 2];
			for (const before of order.slice(0, order.indexOf(seat))) {
				applyActionForStatsTest(gameState, players[before], { action: "fold" });
			}
			applyActionForStatsTest(gameState, players[seat], { action: "raise", amount: 80 });
			for (const after of order.slice(order.indexOf(seat) + 1, -1)) {
				applyActionForStatsTest(gameState, players[after], { action: "fold" });
			}
			applyActionForStatsTest(gameState, players[2], { action, amount: 160 });
			const opener = players[seat].stats;
			assertEquals([opener.raiseFirstInOpportunities, opener.raisesFirstIn], [1, 1]);
			assertEquals([opener.stealOpportunities, opener.stealAttempts], [1, 1]);
			assertEquals(gameState.handContext.stealAttemptSeatIndex, seat);
			assertEquals(players[2].stats.bigBlindStealOpportunities, 1);
			assertEquals(players[2].stats.foldsBigBlindToSteal, action === "fold" ? 1 : 0);
		}
	}
});

Deno.test("heads-up small blind raises count as steals and big blind folds count as defence opportunities", () => {
	const { players, gameState } = createPreflopStatsTable(2);
	applyActionForStatsTest(gameState, players[0], { action: "raise", amount: 80 });
	applyActionForStatsTest(gameState, players[1], { action: "fold" });
	assertEquals([players[0].stats.raiseFirstInOpportunities, players[0].stats.raisesFirstIn], [1, 1]);
	assertEquals([players[0].stats.stealOpportunities, players[0].stats.stealAttempts], [1, 1]);
	assertEquals([players[1].stats.bigBlindStealOpportunities, players[1].stats.foldsBigBlindToSteal], [1, 1]);
});

Deno.test("limps and isolation raises do not become raise-first-in or steal attempts", () => {
	const { players, gameState } = createPreflopStatsTable();
	applyActionForStatsTest(gameState, players[3], { action: "call" });
	applyActionForStatsTest(gameState, players[4], { action: "fold" });
	applyActionForStatsTest(gameState, players[5], { action: "fold" });
	applyActionForStatsTest(gameState, players[0], { action: "raise", amount: 80 });
	applyActionForStatsTest(gameState, players[1], { action: "fold" });
	applyActionForStatsTest(gameState, players[2], { action: "fold" });
	assertEquals([players[3].stats.raiseFirstInOpportunities, players[3].stats.raisesFirstIn], [1, 0]);
	assertEquals([players[3].stats.stealOpportunities, players[3].stats.stealAttempts], [0, 0]);
	assertEquals([players[0].stats.raiseFirstInOpportunities, players[0].stats.stealOpportunities], [0, 0]);
	assertEquals(players[2].stats.bigBlindStealOpportunities, 0);
});

Deno.test("raise-first-in excludes short all-in calls and pots with no callable raise opponent", () => {
	for (const mode of ["short-stack", "all-in-opponent"]) {
		const { players, gameState } = createPreflopStatsTable(2);
		if (mode === "short-stack") {
			players[0].chips = 10;
		} else {
			players[1].chips = 0;
			players[1].allIn = true;
		}
		applyActionForStatsTest(gameState, players[0], { action: "call" });
		assertEquals([players[0].stats.raiseFirstInOpportunities, players[0].stats.stealOpportunities], [0, 0]);
	}
});

Deno.test("big blind steal defence excludes an intervening caller or 3-bet", () => {
	for (const action of ["call", "raise"]) {
		const { players, gameState } = createPreflopStatsTable(3);
		applyActionForStatsTest(gameState, players[0], { action: "raise", amount: 80 });
		applyActionForStatsTest(gameState, players[1], { action, amount: 200 });
		applyActionForStatsTest(gameState, players[2], { action: "fold" });
		assertEquals(players[2].stats.bigBlindStealOpportunities, 0);
		assertEquals(players[2].stats.foldsBigBlindToSteal, 0);
	}
});

Deno.test("fold-to-3-bet counts opener responses and treats calls and 4-bets as continued play", () => {
	for (const action of ["fold", "call", "raise", "allin"]) {
		const { players, gameState } = createPreflopStatsTable(3);
		applyActionForStatsTest(gameState, players[0], { action: "raise", amount: 80 });
		applyActionForStatsTest(gameState, players[1], { action: "raise", amount: 200 });
		applyActionForStatsTest(gameState, players[2], { action: "fold" });
		applyActionForStatsTest(gameState, players[0], { action, amount: 500 });
		assertEquals(players[0].stats.foldToThreeBetOpportunities, 1);
		assertEquals(players[0].stats.foldsToThreeBet, action === "fold" ? 1 : 0);
		assertEquals(players[2].stats.foldToThreeBetOpportunities, 0);
	}
});

Deno.test("fold-to-3-bet includes short all-in calls but excludes an intervening 4-bet", () => {
	const { players, gameState } = createPreflopStatsTable(3);
	players[0].chips = 100;
	applyActionForStatsTest(gameState, players[0], { action: "raise", amount: 40 });
	applyActionForStatsTest(gameState, players[1], { action: "raise", amount: 200 });
	applyActionForStatsTest(gameState, players[2], { action: "fold" });
	applyActionForStatsTest(gameState, players[0], { action: "call" });
	assertEquals([players[0].stats.foldToThreeBetOpportunities, players[0].stats.foldsToThreeBet], [1, 0]);
	assertEquals(players[0].allIn, true);

	const other = createPreflopStatsTable(4);
	applyActionForStatsTest(other.gameState, other.players[3], { action: "raise", amount: 80 });
	applyActionForStatsTest(other.gameState, other.players[0], { action: "raise", amount: 200 });
	applyActionForStatsTest(other.gameState, other.players[1], { action: "raise", amount: 600 });
	applyActionForStatsTest(other.gameState, other.players[2], { action: "fold" });
	applyActionForStatsTest(other.gameState, other.players[3], { action: "fold" });
	assertEquals(other.players[3].stats.foldToThreeBetOpportunities, 0);
});

Deno.test("preflop opportunities, positions, and opener survive restore and reset at a new hand", () => {
	const { players, gameState } = createPreflopStatsTable(3);
	applyActionForStatsTest(gameState, players[0], { action: "raise", amount: 80 });
	applyActionForStatsTest(gameState, players[1], { action: "raise", amount: 200 });
	applyActionForStatsTest(gameState, players[2], { action: "fold" });
	const restored = JSON.parse(JSON.stringify(gameState));
	applyActionForStatsTest(restored, restored.players[0], { action: "fold" });
	assertEquals(restored.players[0].stats.raiseFirstInOpportunities, 1);
	assertEquals(restored.players[0].stats.foldToThreeBetOpportunities, 1);
	assertEquals(restored.players[0].stats.foldsToThreeBet, 1);
	assertEquals(restored.players[0].spotState.position, "button");
	const next = createNextHandTransitionPlan(restored, 2);
	applyPlayerPatches(next.playerPatches);
	applyGameStatePatch(restored, next.gameStatePatch);
	assertEquals(restored.handContext.preflopOpenerSeatIndex, null);
	assertEquals(restored.handContext.stealAttemptSeatIndex, null);
	assertEquals(restored.players[0].spotState.raiseFirstInOpportunityCounted, false);
	assertEquals(restored.players[0].spotState.foldToThreeBetOpportunityCounted, false);
	assertEquals(restored.players[0].spotState.position, null);
	assertEquals(restored.players[2].spotState.bigBlindStealOpportunityCounted, false);
});

Deno.test("3-bet opportunities distinguish folds, calls, raises, and all-in calls", () => {
	for (
		const { action, chips, opportunities, threeBets } of [
			{ action: "fold", chips: 300, opportunities: 1, threeBets: 0 },
			{ action: "call", chips: 300, opportunities: 1, threeBets: 0 },
			{ action: "raise", chips: 300, opportunities: 1, threeBets: 1 },
			{ action: "allin", chips: 40, opportunities: 0, threeBets: 0 },
			{ action: "allin", chips: 80, opportunities: 0, threeBets: 0 },
			{ action: "allin", chips: 90, opportunities: 1, threeBets: 1 },
			{ action: "allin", chips: 300, opportunities: 1, threeBets: 1 },
		]
	) {
		const player = createPlayer({ chips, roundBet: 20, stats: createStats({ hands: 1 }) });
		const { gameState } = createGameState({ player, currentPhaseIndex: 0, currentBet: 100, lastRaise: 80 });
		gameState.handContext = { preflopRaiseCount: 1, preflopAggressorSeatIndex: 1 };
		applyActionForStatsTest(gameState, player, { action, amount: 160 });
		assertEquals([player.stats.threeBetOpportunities, player.stats.threeBets], [opportunities, threeBets]);
	}
});

Deno.test("3-bet opportunities require a remaining opponent who can contest another raise", () => {
	const player = createPlayer({ chips: 500, stats: createStats() });
	const allInOpener = createPlayer({ seatIndex: 1, roundBet: 100, chips: 0, allIn: true });
	for (
		const { chips, folded, expected } of [
			{ chips: 0, folded: false, expected: false },
			{ chips: 50, folded: false, expected: false },
			{ chips: 100, folded: false, expected: false },
			{ chips: 200, folded: true, expected: false },
			{ chips: 200, folded: false, expected: true },
		]
	) {
		const other = createPlayer({ seatIndex: 2, chips, folded });
		const { gameState } = createGameState({
			player,
			opponents: [allInOpener, other],
			currentPhaseIndex: 0,
			currentBet: 100,
		});
		gameState.handContext = { preflopRaiseCount: 1 };
		const before = structuredClone(gameState);
		assertEquals(getPlayerActionStatsContext(gameState, player).threeBetOpportunity, expected);
		assertEquals(gameState, before);
	}
});

Deno.test("a short all-in does not reopen a 3-bet opportunity for a player who already acted", () => {
	for (
		const { currentBet, actedThisStreet, expected } of [
			{ currentBet: 30, actedThisStreet: true, expected: false },
			{ currentBet: 30, actedThisStreet: false, expected: true },
			{ currentBet: 40, actedThisStreet: true, expected: true },
		]
	) {
		const player = createPlayer({ roundBet: 20, spotState: { actedThisStreet } });
		const { gameState } = createGameState({ player, currentPhaseIndex: 0, currentBet, lastRaise: 20 });
		gameState.handContext = { preflopRaiseCount: 1 };
		assertEquals(getPlayerActionStatsContext(gameState, player).threeBetOpportunity, expected);
	}
});

Deno.test("3-bet opportunities are counted once across save and restore and reset for the next hand", () => {
	const players = [
		createPlayer({ stats: createStats({ hands: 1 }) }),
		createPlayer({ seatIndex: 1, stats: createStats({ hands: 1 }) }),
	];
	const gameState = { players, currentPhaseIndex: 0 };
	const meta = { aggressive: false, voluntary: true, threeBetOpportunity: true };
	recordPlayerActionStats(gameState, players[0], "call", meta);
	const restored = JSON.parse(JSON.stringify(gameState));
	recordPlayerActionStats(restored, restored.players[0], "call", meta);
	assertEquals(restored.players[0].stats.threeBetOpportunities, 1);
	const next = createNextHandTransitionPlan(restored, 2);
	applyPlayerPatches(next.playerPatches);
	applyGameStatePatch(restored, next.gameStatePatch);
	assertEquals(restored.players[0].spotState.threeBetOpportunityCounted, false);
	recordPlayerActionStats(restored, restored.players[0], "raise", { ...meta, aggressive: true });
	assertEquals(restored.players[0].stats.threeBetOpportunities, 2);
	assertEquals(restored.players[0].stats.threeBets, 1);
});

Deno.test("engine flow counts cold 3-bets and calls but excludes open raises and 4-bets", () => {
	const players = [0, 1, 2].map((seatIndex) => createPlayer({ seatIndex, stats: createStats() }));
	const state = createFlowGameState({ players, deck: INITIAL_DECK.slice() });
	const result = runEngineHand(state, (gameState, player) => {
		const raises = gameState.handContext.preflopRaiseCount;
		if (player.seatIndex === 0 && raises === 0) {
			return { action: "raise", amount: 80 };
		}
		if (player.seatIndex === 1 && raises === 1) {
			return { action: "call" };
		}
		if (player.seatIndex === 2 && raises === 1) {
			return { action: "raise", amount: 200 };
		}
		if (player.seatIndex === 0 && raises === 2) {
			return { action: "raise", amount: 500 };
		}
		return { action: "fold" };
	}, { shuffleFn: (deck) => deck });
	assertEquals(result.type, "showdown");
	assertEquals(state.handContext.preflopRaiseCount, 3);
	assertEquals(players.map((player) => player.stats.threeBetOpportunities), [0, 1, 1]);
	assertEquals(players.map((player) => player.stats.threeBets), [0, 0, 1]);
	assertEquals(players.map((player) => player.stats.raiseFirstInOpportunities), [1, 0, 0]);
	assertEquals(players.map((player) => player.stats.raisesFirstIn), [1, 0, 0]);
	assertEquals(players.map((player) => player.stats.stealAttempts), [1, 0, 0]);
	assertEquals(players.map((player) => player.stats.foldToThreeBetOpportunities), [1, 0, 0]);
	assertEquals(players.map((player) => player.stats.foldsToThreeBet), [0, 0, 0]);
	assertEquals(players.map((player) => player.stats.bigBlindStealOpportunities), [0, 0, 0]);
});

Deno.test("engine flow counts a limp-reraise as a 3-bet", () => {
	const players = [0, 1, 2].map((seatIndex) => createPlayer({ seatIndex, stats: createStats() }));
	const state = createFlowGameState({ players, deck: INITIAL_DECK.slice() });
	const result = runEngineHand(state, (gameState, player) => {
		const raises = gameState.handContext.preflopRaiseCount;
		if (player.seatIndex === 0 && raises === 0) {
			return { action: "call" };
		}
		if (player.seatIndex === 1 && raises === 0) {
			return { action: "raise", amount: 80 };
		}
		if (player.seatIndex === 0 && raises === 1) {
			return { action: "raise", amount: 200 };
		}
		return { action: "fold" };
	}, { shuffleFn: (deck) => deck });
	assertEquals(result.type, "showdown");
	assertEquals(players.map((player) => player.stats.threeBetOpportunities), [1, 0, 1]);
	assertEquals(players.map((player) => player.stats.threeBets), [1, 0, 0]);
	assertEquals(players.map((player) => player.stats.raisesFirstIn), [0, 0, 0]);
	assertEquals(players.map((player) => player.stats.stealAttempts), [0, 0, 0]);
	assertEquals(players.map((player) => player.stats.foldToThreeBetOpportunities), [0, 1, 0]);
	assertEquals(players.map((player) => player.stats.foldsToThreeBet), [0, 1, 0]);
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

Deno.test("getBettingRoundStartExit advances with one matched actionable player", () => {
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

Deno.test("getBettingRoundStartExit keeps one actionable player when they owe a bet", () => {
	const smallBlind = createPlayer({
		name: "Small Blind",
		chips: 990,
		roundBet: 10,
		totalBet: 10,
	});
	const allInBigBlind = createPlayer({
		name: "Big Blind",
		seatIndex: 1,
		chips: 0,
		roundBet: 20,
		totalBet: 20,
		allIn: true,
	});
	const { gameState } = createGameState({
		player: smallBlind,
		opponents: [allInBigBlind],
		currentBet: 20,
	});

	assertEquals(getBettingRoundStartExit(gameState), null);
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
				sawFlop: false,
				threeBetOpportunityCounted: false,
				raiseFirstInOpportunityCounted: false,
				foldToThreeBetOpportunityCounted: false,
				bigBlindStealOpportunityCounted: false,
				flopCbetOpportunityCounted: false,
				foldToFlopCbetOpportunityCounted: false,
				position: null,
				tableSize: null,
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
				preflopOpenerSeatIndex: null,
				stealAttemptSeatIndex: null,
				flopCbetSeatIndex: null,
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
		botLinePreflopAggressor: humanPatch.botLine.preflopAggressor,
		spotActed: humanPatch.spotState.actedThisStreet,
	}, {
		folded: false,
		allIn: false,
		totalBet: 0,
		roundBet: 0,
		holeCards: [null, null],
		visibleHoleCards: [false, false],
		botLinePreflopAggressor: false,
		spotActed: false,
	});
	assertEquals(humanPatch.stats, undefined);
	assertEquals(botPatch.stats, undefined);
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

Deno.test("tournament placement waits for a player's finish and uses the remaining field", () => {
	const players = [createPlayer(), createPlayer({ seatIndex: 1 }), createPlayer({ seatIndex: 2 })];
	const before = structuredClone(players);
	assertEquals(getPlayerTournamentPlacement(players, players[0]), null);
	assertEquals(players, before);
	players[0].chips = 0;
	players[0].totalBet = 1000;
	assertEquals(getPlayerTournamentPlacement(players, players[0]), 3);
	players[1].chips = 0;
	players[1].totalBet = 500;
	assertEquals(getPlayerTournamentPlacement(players, players[2]), 1);
	assertEquals(getPlayerTournamentPlacement(players, players[0]), 2);
	assertEquals(getPlayerTournamentPlacement(players.slice(1), players[0]), null);
});

Deno.test("simultaneous eliminations rank larger starting stacks higher and keep ties", () => {
	const players = [
		createPlayer({ chips: 5000 }),
		createPlayer({ seatIndex: 1, chips: 0, totalBet: 1000 }),
		createPlayer({ seatIndex: 2, chips: 0, totalBet: 500 }),
		createPlayer({ seatIndex: 3, chips: 0, totalBet: 500 }),
		createPlayer({ seatIndex: 4, chips: 0, totalBet: 200 }),
	];
	const before = structuredClone(players);
	assertEquals(players.map((player) => getPlayerTournamentPlacement(players, player)), [1, 2, 3, 3, 5]);
	assertEquals(players, before);
});

Deno.test("createNextHandTransitionPlan counts the first hand from zero", () => {
	const players = [
		createPlayer({ stats: createStats() }),
		createPlayer({ seatIndex: 1, stats: createStats() }),
	];
	const gameState = { players };
	const plan = createNextHandTransitionPlan(gameState, 1);

	assertEquals(plan.type, "next-hand");
	assertEquals(players.map((player) => player.stats.hands), [0, 0]);
	applyPlayerPatches(plan.playerPatches);
	applyGameStatePatch(gameState, plan.gameStatePatch);
	assertEquals(players.map((player) => player.stats.hands), [1, 1]);
	assertEquals(gameState.handId, 1);
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
		botHands: bot.stats.hands,
		bustedHands: busted.stats.hands,
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
		botHands: 5,
		bustedHands: 5,
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
		bustedHands: busted.stats.hands,
		bustedChips: busted.chips,
	}, {
		gameFinished: true,
		handInProgress: false,
		activeSeatIndex: null,
		pendingAction: null,
		players: ["Champion"],
		championWinner: true,
		championHands: 7,
		bustedHands: 7,
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
			spotState: { ...createPlayerSpotState(), position: "smallBlind", tableSize: 3 },
			roundBet: 10,
			totalBet: 10,
			chips: 990,
		},
		bigBlindPatch: {
			smallBlind: false,
			bigBlind: true,
			spotState: { ...createPlayerSpotState(), position: "bigBlind", tableSize: 3 },
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
		playerPatches: [],
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

Deno.test("flop stats include all-in players, exclude preflop folds, and count only once", () => {
	const players = [
		createPlayer({ stats: createStats() }),
		createPlayer({ seatIndex: 1, folded: true, stats: createStats() }),
		createPlayer({ seatIndex: 2, chips: 0, allIn: true, stats: createStats() }),
	];
	const gameState = createFlowGameState({ players, deck: INITIAL_DECK.slice() });
	gameState.currentPhaseIndex = 1;
	const before = structuredClone(gameState);
	const flopPlan = dealCommunityCardsForPhase(gameState, 3);
	assertEquals(gameState, before);
	applyPlayerPatches(flopPlan.playerPatches);
	applyGameStatePatch(gameState, flopPlan.gameStatePatch);
	assertEquals(players.map((player) => player.stats.flopsSeen), [1, 0, 1]);
	assertEquals(players.map((player) => player.spotState?.sawFlop === true), [true, false, true]);

	const roundPlan = createBettingRoundStartPlan(gameState);
	applyPlayerPatches(roundPlan.playerPatches);
	applyGameStatePatch(gameState, roundPlan.gameStatePatch);
	assertEquals(players[0].spotState.sawFlop, true);
	players[0].folded = true;
	for (const currentPhaseIndex of [2, 3]) {
		gameState.currentPhaseIndex = currentPhaseIndex;
		const plan = dealCommunityCardsForPhase(gameState, 1);
		applyPlayerPatches(plan.playerPatches);
		applyGameStatePatch(gameState, plan.gameStatePatch);
	}
	assertEquals(players.map((player) => player.stats.flopsSeen), [1, 0, 1]);
	assertEquals(players[0].spotState.sawFlop, true);

	const nextHandPlan = createNextHandTransitionPlan(gameState, 2);
	applyPlayerPatches(nextHandPlan.playerPatches);
	applyGameStatePatch(gameState, nextHandPlan.gameStatePatch);
	assertEquals(gameState.players.map((player) => player.spotState.sawFlop), [false, false]);
	assertEquals(players.map((player) => player.stats.flopsSeen), [1, 0, 1]);
});

Deno.test("a preflop uncontested win does not count as a flop or a win after seeing the flop", () => {
	const players = [
		createPlayer({ stats: createStats() }),
		createPlayer({ seatIndex: 1, stats: createStats() }),
	];
	const gameState = createFlowGameState({ players, deck: INITIAL_DECK.slice() });
	const result = runEngineHand(gameState, () => ({ action: "fold" }), { shuffleFn: (deck) => deck });
	assertEquals(result.type, "showdown");
	assertEquals(players.map((player) => player.stats.flopsSeen), [0, 0]);
	assertEquals(players.map((player) => player.stats.handsWonAfterFlop), [0, 0]);
	assertEquals(result.showdownResult.winningPlayers.length, 1);
});

Deno.test("an uncontested flop win counts after a preflop fold and a postflop fold", () => {
	const players = [
		createPlayer({ name: "Winner", stats: createStats() }),
		createPlayer({ name: "Flop Fold", seatIndex: 1, stats: createStats() }),
		createPlayer({ name: "Preflop Fold", seatIndex: 2, stats: createStats() }),
	];
	const gameState = createFlowGameState({ players, deck: INITIAL_DECK.slice() });
	const result = runEngineHand(gameState, (state, player) => {
		if (
			(state.currentPhaseIndex === 0 && player.name === "Preflop Fold") ||
			(state.currentPhaseIndex === 1 && player.name === "Flop Fold")
		) {
			return { action: "fold" };
		}
		return callOrCheckAction(state, player);
	}, { shuffleFn: (deck) => deck });
	assertEquals(result.type, "showdown");
	assertEquals(result.showdownResult.hadShowdown, false);
	assertEquals(players.map((player) => player.stats.flopsSeen), [1, 1, 0]);
	assertEquals(players.map((player) => player.stats.handsWonAfterFlop), [1, 0, 0]);
});

Deno.test("split pots count as one win after seeing the flop for each winner", () => {
	const players = [
		createPlayer({ totalBet: 100, holeCards: ["AS", "KD"], stats: createStats(), spotState: { sawFlop: true } }),
		createPlayer({
			seatIndex: 1,
			totalBet: 100,
			holeCards: ["AH", "KC"],
			stats: createStats(),
			spotState: { sawFlop: true },
		}),
	];
	const showdown = resolveShowdown(players, ["2C", "3D", "4H", "5S", "9C"]);
	const plan = createShowdownCommitPlan({ players }, showdown);
	applyPlayerPatches(plan.playerPatches);
	assertEquals(showdown.winningPlayers.length, 2);
	assertEquals(players.map((player) => player.stats.handsWonAfterFlop), [1, 1]);
});

Deno.test("flop win stats count side pot winners once and exclude refund-only payouts", () => {
	for (
		const { cards, wins } of [
			{ cards: [["AS", "AH"], ["KS", "KH"], ["QS", "QH"]], wins: [1, 1, 0] },
			{ cards: [["QS", "QH"], ["KS", "KH"], ["AS", "AH"]], wins: [0, 0, 1] },
		]
	) {
		const players = cards.map((holeCards, seatIndex) =>
			createPlayer({
				name: `Player ${seatIndex}`,
				seatIndex,
				totalBet: [50, 100, 200][seatIndex],
				holeCards,
				stats: createStats(),
				spotState: { sawFlop: true },
			})
		);
		const showdown = resolveShowdown(players, ["2C", "7D", "9H", "TC", "3S"]);
		const plan = createShowdownCommitPlan({ players }, showdown);
		applyPlayerPatches(plan.playerPatches);
		assertEquals(players.map((player) => player.stats.handsWonAfterFlop), wins);
		assertEquals(showdown.potResults.some((pot) => pot.isRefundOnly), true);
	}
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
	assertEquals(getPlayerTournamentPlacement(gameState.players, shortStack), 3);
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
		actions: [
			{ player: "Button", action: "call" },
		],
		currentPhaseIndex: 4,
		communityCards: ["7D", "9H", "TC", "4C", "6D"],
		shortAllIn: true,
		showdown: {
			activePlayers: ["Button", "Short"],
			contributors: [
				{ player: "Button", totalBet: 20 },
				{ player: "Short", totalBet: 20 },
			],
			hadShowdown: true,
			uncontestedWinner: null,
			mainPotWinners: ["Short"],
			winningPlayers: ["Short"],
			transferQueue: [{ player: "Short", amount: 40 }],
			potResults: [{
				players: ["Short"],
				amount: 40,
				hand: "Pair",
				isRefundOnly: false,
			}],
			totalPayoutByPlayer: [{ player: "Short", amount: 40 }],
			totalPot: 40,
		},
		chips: [
			{ player: "Button", chips: 980 },
			{ player: "Short", chips: 40 },
		],
	});
});

Deno.test("runEngineTournament plays a browserless mini tournament to champion", () => {
	const shortButton = createPlayer({ name: "Short Button", seatIndex: 0, chips: 20, stats: createStats() });
	const bigBlind = createPlayer({ name: "Big Blind", seatIndex: 1, chips: 1000, stats: createStats() });
	const events = [];
	const gameState = createFlowGameState({
		players: [shortButton, bigBlind],
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

	const result = runEngineTournament(gameState, callOrCheckAction, {
		eventSink: (event) => {
			events.push(event);
		},
		maxHands: 5,
		shuffleFn: (deck) => deck,
	});

	assertEquals([shortButton.stats.flopsSeen, bigBlind.stats.flopsSeen], [1, 1]);
	assertEquals([shortButton.stats.handsWonAfterFlop, bigBlind.stats.handsWonAfterFlop], [0, 1]);

	assertEquals({
		type: result.type,
		champion: result.champion.name,
		handCount: result.handCount,
		handTypes: result.handResults.map((handResult) => handResult.type),
		events: events.map((event) => event.type),
		eventCountMatches: events.length === result.events.length,
		players: gameState.players.map((player) => ({
			name: player.name,
			chips: player.chips,
			isWinner: player.isWinner,
		})),
		decision: events.find((event) => event.type === "decision"),
		handResult: events.find((event) => event.type === "hand_result"),
	}, {
		type: "game-over",
		champion: "Big Blind",
		handCount: 1,
		handTypes: ["showdown", "game-over"],
		events: [
			"hand_start",
			"decision",
			"decision",
			"hand_result",
			"player_bust",
			"tournament_end",
		],
		eventCountMatches: true,
		players: [{
			name: "Big Blind",
			chips: 1020,
			isWinner: true,
		}],
		decision: {
			type: "decision",
			handId: 1,
			phase: "preflop",
			player: "Short Button",
			seatIndex: 0,
			requestedAction: "call",
			requestedAmount: null,
			action: "allin",
			amount: 10,
		},
		handResult: {
			type: "hand_result",
			handId: 1,
			communityCards: ["7D", "9H", "TC", "4C", "6D"],
			hadShowdown: true,
			uncontestedWinner: null,
			uncontestedWinnerSeatIndex: null,
			mainPotWinners: ["Big Blind"],
			mainPotWinnerSeatIndexes: [1],
			winningPlayers: ["Big Blind"],
			winningSeatIndexes: [1],
			potResults: [{
				players: ["Big Blind"],
				amount: 40,
				hand: "Pair",
				isRefundOnly: false,
			}],
			totalPayoutByPlayer: [{
				player: "Big Blind",
				seatIndex: 1,
				amount: 40,
			}],
			totalPayoutBySeatIndex: {
				"1": 40,
			},
			totalBetBySeatIndex: {
				"0": 20,
				"1": 20,
			},
			totalPot: 40,
		},
	});
});

Deno.test("secureRandomInt stays within range", () => {
	for (const n of [1, 2, 3, 7, 52]) {
		for (let draw = 0; draw < 1000; draw++) {
			const value = secureRandomInt(n);
			assertEquals(Number.isInteger(value) && value >= 0 && value < n, true, `n=${n} value=${value}`);
		}
	}
});

Deno.test("secureRandomInt rejects values in the biased top range", () => {
	// 2^32 % 52 === 48, so values from 4294967248 upward must be redrawn.
	const values = [4294967295, 4294967248, 4294967247];
	let calls = 0;
	const fillRandom = (array) => {
		array[0] = values[calls];
		calls++;
	};

	assertEquals(secureRandomInt(52, fillRandom), 4294967247 % 52);
	assertEquals(calls, 3);
});

Deno.test("shuffleArray keeps every card without using Math.random", () => {
	const deck = ["2C", "3D", "4H", "5S", "6C", "7D", "8H", "9S", "TC", "JD", "QH", "KS", "AC"];
	const originalRandom = Math.random;
	Math.random = () => {
		throw new Error("Math.random must not be used for shuffling");
	};
	try {
		const shuffled = shuffleArray(deck.slice());
		assertEquals(shuffled.slice().sort(), deck.slice().sort());
	} finally {
		Math.random = originalRandom;
	}
});
