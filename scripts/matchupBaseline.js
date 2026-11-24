import { chooseBotAction } from "../js/bot.js";
import { getPlayerSolvedHand } from "../js/gameEngine.js";
import { getPlayerActionState } from "../js/shared/actionModel.js";

// These River profiles isolate changes in bluff frequency and calling behavior.
// See docs/bot-tuning-playbook.md for when to extend a diagnostic profile or the wider pool.
function getRiverOpponent(player, state) {
	if (state.communityCards.length !== 5 || state.raisesThisRound > 1) {
		return null;
	}
	const opponents = state.players.filter((seat) => seat !== player && !seat.folded);
	return opponents.length === 1 && !opponents[0].allIn ? opponents[0] : null;
}

function createRiverBettor(bluffFrequency) {
	return (player, state) => {
		const opponent = getRiverOpponent(player, state);
		if (opponent && state.currentBet === 0 && opponent.spotState.actedThisStreet) {
			const bet = Math.round(state.pot / 20) * 10;
			if (bet >= state.lastRaise && bet < Math.min(player.chips, opponent.chips)) {
				const rank = getPlayerSolvedHand(player, state.communityCards).rank;
				const boardRank = getPlayerSolvedHand({ holeCards: [] }, state.communityCards).rank;
				if ((rank >= 3 && rank > boardRank) || (rank === 1 && Math.random() < bluffFrequency)) {
					return { action: "raise", amount: bet };
				}
				return { action: "check" };
			}
		}
		return chooseBotAction(player, state);
	};
}

function callHeavy(player, state) {
	if (getRiverOpponent(player, state) && state.raisesThisRound === 1) {
		const { needToCall } = getPlayerActionState(state, player);
		const rank = getPlayerSolvedHand(player, state.communityCards).rank;
		if (
			needToCall > 0 && needToCall < player.chips && needToCall / (state.pot + needToCall) <= 1 / 3 && rank >= 2
		) {
			return { action: "call" };
		}
	}
	return chooseBotAction(player, state);
}

function classifySpot(state, player) {
	const opponent = getRiverOpponent(player, state);
	if (opponent && state.raisesThisRound === 1 && state.currentBet > player.roundBet) {
		return "river-facing-first-bet";
	}
	if (opponent && state.currentBet === 0 && opponent.spotState.actedThisStreet) {
		return "river-checked-to";
	}
	return null;
}

const neutral = {
	test: "current",
	opponent: "current",
	field1: "current",
	field2: "current",
	field3: "current",
	field4: "current",
};

export default {
	seed: 20261124,
	runs: 60,
	strategies: {
		current: chooseBotAction,
		overbluff: createRiverBettor(0.70),
		valuePressure: createRiverBettor(0),
		callHeavy,
	},
	lineups: {
		neutral,
		overbluff: { ...neutral, opponent: "overbluff" },
		valuePressure: { ...neutral, opponent: "valuePressure" },
		callHeavy: { ...neutral, opponent: "callHeavy" },
		mixed: { ...neutral, opponent: "overbluff", field1: "valuePressure", field2: "callHeavy" },
	},
	classifySpot,
};
