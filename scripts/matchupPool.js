import { chooseBotAction } from "../js/bot.js";
import { getCurrentPhase, getHighestBoardRank, getPlayerSolvedHand } from "../js/gameEngine.js";
import { getEffectiveRaiseCap, getPlayerActionState } from "../js/shared/actionModel.js";

// Version 1 models broad poker styles. Extend a profile when a control run exposes missing behavior.
// See docs/bot-tuning-playbook.md for the evidence and versioning rules.
const ranks = "23456789TJQKA";
const profiles = {
	tag: {
		entry: 17,
		open: 17.5,
		reraise: 22,
		preflopOdds: 0.28,
		valueTier: 3,
		valueBet: 0.85,
		valueRaise: 0.60,
		callTier: 2,
		postflopOdds: 0.30,
		bluff: [0.14, 0.10, 0.06],
	},
	lag: {
		entry: 15,
		open: 15.7,
		reraise: 19,
		preflopOdds: 0.33,
		valueTier: 2,
		valueBet: 0.90,
		valueRaise: 0.80,
		callTier: 2,
		postflopOdds: 0.35,
		bluff: [0.36, 0.34, 0.25],
	},
	callingStation: {
		entry: 14,
		open: 22.5,
		reraise: 25.5,
		preflopOdds: 0.42,
		valueTier: 3,
		valueBet: 0.25,
		valueRaise: 0.10,
		callTier: 1,
		postflopOdds: 0.38,
		bluff: [0, 0, 0],
	},
	nit: {
		entry: 19.5,
		open: 24,
		reraise: 27,
		preflopOdds: 0.39,
		valueTier: 4,
		valueBet: 0.40,
		valueRaise: 0.15,
		callTier: 3,
		postflopOdds: 0.25,
		bluff: [0, 0, 0],
	},
};

function getStartingHandScore(player, state) {
	const [first, second] = player.holeCards;
	const firstRank = ranks.indexOf(first[0]) + 2;
	const secondRank = ranks.indexOf(second[0]) + 2;
	const high = Math.max(firstRank, secondRank);
	const low = Math.min(firstRank, secondRank);
	const suited = first[1] === second[1] ? 2 : 0;
	const shape = high === low ? 6 : high - low === 1 ? 1 : 0;
	const position = player.dealer ? 0.5 : 0;
	return high + low * 0.6 + suited + shape + position + (6 - state.players.length) * 0.65;
}

function getPostflopTier(player, board) {
	const hand = getPlayerSolvedHand(player, board);
	const publicHand = getPlayerSolvedHand({ holeCards: [] }, board);
	if (hand.rank >= 3 && hand.rank > publicHand.rank) {
		return 4;
	}
	if (hand.rank === 2 && publicHand.rank === 1) {
		const pairRank = ranks.indexOf(hand.cards[0].value);
		const highestBoardRank = ranks.indexOf(getHighestBoardRank(board, ranks));
		return pairRank >= highestBoardRank ? 3 : 2;
	}
	if (
		board.length < 5 &&
		player.holeCards.some((hole) =>
			[...player.holeCards, ...board].filter((card) => card[1] === hole[1]).length === 4
		)
	) {
		return 1;
	}
	return 0;
}

function createOpponent(profile) {
	return (player, state) => {
		const { needToCall, canCheck, minRaise, maxRaiseAmount } = getPlayerActionState(state, player);
		const callCost = Math.min(needToCall, player.chips);
		const potOdds = callCost / (state.pot + callCost);
		const canRaise = player.chips > needToCall && getEffectiveRaiseCap(state, player) > state.currentBet;

		const raise = (amount) => ({
			action: "raise",
			amount: Math.min(maxRaiseAmount, Math.max(minRaise, Math.round(amount / 10) * 10)),
		});

		if (state.currentPhaseIndex === 0) {
			const score = getStartingHandScore(player, state);
			const opened = state.currentBet > state.bigBlind;
			const extraRaises = Math.max(0, state.raisesThisRound - 1);
			const raiseThreshold = opened ? profile.reraise + extraRaises : profile.open;
			if (canRaise && score >= raiseThreshold) {
				return raise((opened ? state.currentBet * 3 : state.bigBlind * 2.5) - player.roundBet);
			}
			if (canCheck) {
				return { action: "check" };
			}
			const entryThreshold = profile.entry + (opened ? 1.5 + extraRaises : 0);
			return { action: score >= entryThreshold && potOdds <= profile.preflopOdds ? "call" : "fold" };
		}

		const tier = getPostflopTier(player, state.communityCards);
		if (canCheck) {
			if (canRaise && tier >= profile.valueTier && Math.random() < profile.valueBet) {
				return raise(state.pot * 0.60);
			}
			if (
				canRaise && tier < 2 && state.players.filter((seat) => !seat.folded).length === 2 &&
				Math.random() < profile.bluff[state.currentPhaseIndex - 1]
			) {
				const bet = raise(state.pot * 0.55);
				if (bet.amount < player.chips) {
					return bet;
				}
			}
			return { action: "check" };
		}
		if (canRaise && tier === 4 && state.raisesThisRound === 1 && Math.random() < profile.valueRaise) {
			return raise(needToCall * 3);
		}
		return {
			action: tier === 4 || (tier >= profile.callTier && potOdds <= profile.postflopOdds) ? "call" : "fold",
		};
	};
}

export const opponentStrategies = Object.fromEntries(
	Object.entries(profiles).map(([name, profile]) => [name, createOpponent(profile)]),
);

const reference = {
	test: "current",
	opponent: "current",
	field1: "current",
	field2: "current",
	field3: "current",
	field4: "current",
};
const mixed = { ...reference, opponent: "tag", field1: "lag", field2: "callingStation", field3: "nit" };

export default {
	seed: 20261124,
	runs: 120,
	strategies: { current: chooseBotAction, ...opponentStrategies },
	strategyVersions: {
		current: "workspace-current-bot",
		...Object.fromEntries(Object.keys(opponentStrategies).map((name) => [name, "opponent-pool-v1"])),
	},
	lineups: {
		reference,
		mixed,
		pressure: { ...mixed, field4: "lag" },
	},
	classifySpot(state, player) {
		const phase = getCurrentPhase(state.currentPhaseIndex);
		if (phase === "preflop") {
			return state.currentBet > state.bigBlind ? "preflop-facing-raise" : "preflop-unraised";
		}
		const situation = state.currentBet > player.roundBet ? "facing-bet" : "free-action";
		return `${phase}-${situation}`;
	},
};
