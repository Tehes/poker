import { getPlayerSolvedHand } from "../js/gameEngine.js";
import { getEffectiveRaiseCap, getPlayerActionState } from "../js/shared/actionModel.js";

const ranks = "23456789TJQKA";
const streets = ["flop", "turn", "river"];
const straights = [
	[14, 2, 3, 4, 5],
	...Array.from(
		{ length: 9 },
		(_, index) => Array.from({ length: 5 }, (_, offset) => index + offset + 2),
	),
];

// Strength tiers run from air and kickers through pairs, strong made hands and near-nut hands.
const profiles = {
	tag: {
		value: [0, 0, 0.07, 0.72, 0.84, 0.92, 0.94],
		valueRaise: [0, 0, 0, 0.03, 0.29, 0.65, 0.84],
		call: [0, 0.10, 0.23, 0.34, 0.40, 0.48, 0.50],
		bluff: [0.29, 0.30, 0.27],
		semiBluff: 0.58,
		checkRaise: 0.23,
		drawPatience: 0.015,
		pressure: 0.04,
		size: [0.40, 0.60, 0.66],
		raiseSize: 0.52,
	},
	lag: {
		value: [0, 0, 0.19, 0.81, 0.88, 0.93, 0.95],
		valueRaise: [0, 0, 0, 0.08, 0.41, 0.73, 0.88],
		call: [0, 0.15, 0.28, 0.39, 0.44, 0.49, 0.50],
		bluff: [0.55, 0.57, 0.46],
		semiBluff: 0.80,
		checkRaise: 0.45,
		drawPatience: 0.035,
		pressure: 0.035,
		size: [0.43, 0.68, 0.79],
		raiseSize: 0.59,
	},
	callingStation: {
		value: [0, 0, 0.02, 0.30, 0.56, 0.76, 0.89],
		valueRaise: [0, 0, 0, 0, 0.04, 0.18, 0.37],
		call: [0, 0.21, 0.36, 0.45, 0.48, 0.50, 0.50],
		bluff: [0, 0, 0],
		semiBluff: 0,
		checkRaise: 0,
		drawPatience: 0.12,
		pressure: 0.015,
		size: [0.42, 0.46, 0.55],
		raiseSize: 0.43,
	},
	nit: {
		value: [0, 0, 0, 0.24, 0.50, 0.79, 0.92],
		valueRaise: [0, 0, 0, 0, 0.04, 0.37, 0.76],
		call: [0, 0, 0.13, 0.27, 0.36, 0.47, 0.50],
		bluff: [0, 0, 0],
		semiBluff: 0,
		checkRaise: 0,
		drawPatience: -0.025,
		pressure: 0.055,
		size: [0.48, 0.58, 0.69],
		raiseSize: 0.51,
	},
};

const rankOf = (card) => ranks.indexOf(card[0]) + 2;
const suitOf = (card) => card[1].toUpperCase();

function getBoardInfo(board) {
	const rankCounts = Array(15).fill(0);
	const suitCounts = {};
	for (const card of board) {
		rankCounts[rankOf(card)]++;
		const suit = suitOf(card);
		suitCounts[suit] = (suitCounts[suit] ?? 0) + 1;
	}
	const straightCards = straights.map((window) => window.filter((rank) => rankCounts[rank] > 0).length);
	return {
		rankCounts,
		suitCounts,
		highest: rankCounts.findLastIndex((count) => count > 0),
		highestUnpaired: rankCounts.findLastIndex((count) => count === 1),
		paired: rankCounts.some((count) => count > 1),
		maxSuit: Math.max(...Object.values(suitCounts)),
		straightTexture: Math.max(...straightCards),
		highestPossibleStraight: straightCards.findLastIndex((count) => count >= 3) + 5,
	};
}

function getMadeHand(player, board, info) {
	const hand = getPlayerSolvedHand(player, board);
	const { holeCards } = player;
	const { rankCounts, maxSuit, paired, highest, highestUnpaired, straightTexture, highestPossibleStraight } = info;
	const holeRanks = holeCards.map(rankOf);
	const handRanks = hand.cards.map((card) => rankOf(card.value));
	const [first, , kicker, , last] = handRanks;
	const aceHigh = holeRanks.includes(14) && rankCounts[14] === 0;

	if (board.length === 5 && hand.rank >= 5) {
		const publicHand = getPlayerSolvedHand({ holeCards: [] }, board);
		if (hand.compare(publicHand) === 0) {
			const forcedChop = (hand.rank === 5 && first === 14 && maxSuit <= 2) ||
				(hand.rank === 8 && last === 14) || (hand.rank === 9 && first === 14);
			return { tier: forcedChop ? 6 : 0, weakKicker: false, forcedChop, hand };
		}
	}

	let tier = aceHigh ? 1 : 0;
	let weakKicker = false;
	if (hand.rank === 2 || hand.rank === 3) {
		const pairs = hand.rank === 2 ? [first] : [first, kicker];
		const privatePairs = pairs.filter((rank) => rankCounts[rank] < 2);
		if (privatePairs.length === 2) {
			tier = 4;
		} else if (privatePairs.length === 1) {
			const [pair] = privatePairs;
			tier = pair >= (paired ? highestUnpaired : highest) ? 3 : 2;
			weakKicker = holeRanks[0] !== holeRanks[1] && holeRanks.some((rank) => rank !== pair && rank < 10);
		}
	} else if (hand.rank === 4 && rankCounts[first] < 3) {
		tier = rankCounts[first] === 1 || holeRanks.some((rank) => rank !== first && rank >= 12) ? 5 : 4;
	} else if (hand.rank === 5) {
		tier = maxSuit >= 3 || straightTexture >= 4 ? 4 : 5;
		if (!paired && maxSuit < 3 && first === highestPossibleStraight) {
			tier = 6;
		}
	} else if (hand.rank === 6) {
		const flushSuit = hand.cards[0].suit.toUpperCase();
		const bestPrivate = Math.max(...holeCards.filter((card) => suitOf(card) === flushSuit).map(rankOf));
		const higherMissing = [...ranks].map(rankOf).filter((rank) =>
			rank > bestPrivate && !board.some((card) =>
				suitOf(card) === flushSuit && rankOf(card) === rank
			)
		).length;
		tier = paired || higherMissing > 0 ? 5 : 6;
		if (maxSuit >= 4 && higherMissing > 2) {
			tier = 4;
		}
	} else if (hand.rank === 7) {
		tier = maxSuit >= 3 || rankCounts.some((count, rank) => count >= 2 && rank > first) ? 5 : 6;
	} else if (hand.rank >= 8) {
		tier = rankCounts[first] === 4 && last !== 14 ? 1 : 6;
	}
	return { tier, weakKicker, forcedChop: false, hand };
}

function getDraw(hole, info, handRank) {
	const suits = { ...info.suitCounts };
	for (const card of hole) {
		const suit = suitOf(card);
		suits[suit] = (suits[suit] ?? 0) + 1;
	}
	const flushSuit = handRank < 6 ? Object.keys(suits).find((suit) => suits[suit] === 4) : undefined;
	const holeRanks = hole.map(rankOf);
	const missingRanks = new Set();
	if (handRank < 5) {
		for (const window of straights) {
			const missing = window.filter((rank) => info.rankCounts[rank] === 0 && !holeRanks.includes(rank));
			if (
				missing.length === 1 && holeRanks.some((rank) => info.rankCounts[rank] === 0 && window.includes(rank))
			) {
				missingRanks.add(missing[0]);
			}
		}
	}
	// On a turn board with four in one suit, the remaining card cannot create a private draw.
	const privateFlush = flushSuit && info.suitCounts[flushSuit] !== 4;
	const weakFlush = privateFlush && info.suitCounts[flushSuit] === 3 &&
		!hole.some((card) => suitOf(card) === flushSuit && rankOf(card) >= 12);
	const outs = missingRanks.size * (privateFlush ? 3 : 4) + (privateFlush ? 9 : 0);
	return { outs, vulnerable: weakFlush || info.paired || (info.maxSuit >= 3 && !privateFlush) };
}

export function chooseMatchupPostflopAction(name, player, state, line = {}) {
	const profile = profiles[name];
	const { players, communityCards: board, pot, handContext } = state;
	const street = state.currentPhaseIndex - 1;
	const river = street === 2;
	const opponents = players.filter((seat) => seat !== player && !seat.folded);
	const multiway = opponents.length > 1;
	const inPosition = opponents.every((seat) =>
		seat.allIn || player.dealer || (!seat.dealer && players.indexOf(player) > players.indexOf(seat))
	);
	const checkedTo = inPosition && opponents.every((seat) => seat.allIn || seat.spotState.actedThisStreet);
	const preflopAggressor = handContext.preflopAggressorSeatIndex === player.seatIndex;
	const previousAggressor = street === 1 ? line.flop : line.turn;
	const initiative = street === 0 ? handContext.preflopAggressorSeatIndex : previousAggressor;
	const ownedPrevious = previousAggressor === player.seatIndex;
	const { needToCall, canCheck, minRaise, maxRaiseAmount } = getPlayerActionState(state, player);
	const raiseCap = getEffectiveRaiseCap(state, player);
	const canRaise = player.chips > needToCall && raiseCap > needToCall &&
		(!player.spotState.actedThisStreet || needToCall >= state.lastRaise);
	const foldEquity = !opponents.some((seat) => seat.allIn);
	const callCost = Math.min(needToCall, player.chips);
	const odds = callCost / (pot + callCost);
	const info = getBoardInfo(board);
	const { tier, weakKicker, forcedChop, hand } = getMadeHand(player, board, info);
	const draw = river ? { outs: 0, vulnerable: false } : getDraw(player.holeCards, info, hand.rank);
	const wet = info.maxSuit >= 2 || info.straightTexture >= 3;
	const dangerous = info.maxSuit >= 3 || info.straightTexture >= 4;
	const overcards = player.holeCards.every((card) => rankOf(card) > info.highest);
	const suitedBlocker = player.holeCards.some((card) =>
		info.suitCounts[suitOf(card)] >= 3 && rankOf(card) >= 12 &&
		![...ranks].slice(ranks.indexOf(card[0]) + 1).some((rank) =>
			!board.some((publicCard) => publicCard[0] === rank && suitOf(publicCard) === suitOf(card))
		)
	);
	const newCard = board.at(-1);
	const previousBoard = street === 0 ? board : board.slice(0, -1);
	const highRunout = street > 0 && previousBoard.every((card) => rankOf(card) < rankOf(newCard));

	const raise = (amount) => ({
		action: "raise",
		amount: Math.min(maxRaiseAmount, Math.max(minRaise, Math.round(amount / 10) * 10)),
	});
	const bet = () => {
		const dryCbet = street === 0 && preflopAggressor && !wet && !multiway;
		const sizing = profile.size[street] + (dryCbet ? -0.07 : wet && !river ? 0.12 : 0);
		return raise(pot * sizing);
	};
	const wager = () => raise(needToCall + (pot + needToCall) * profile.raiseSize);

	if (forcedChop) {
		return { action: canCheck ? "check" : "call" };
	}

	if (canCheck) {
		if (!canRaise) {
			return { action: "check" };
		}
		const actingBeforeAggressor = opponents.some((seat) =>
			seat.seatIndex === initiative && !seat.allIn && !seat.spotState.actedThisStreet
		);
		const leadDiscount = actingBeforeAggressor ? (tier <= 3 ? 0.50 : 0.28) : 0;
		const valueDiscount = tier <= 4
			? (dangerous ? 0.22 : 0) + (multiway ? 0.17 : 0) + (weakKicker && river ? 0.22 : 0)
			: 0;
		const checkedToBonus = tier >= 3 && checkedTo ? 0.06 : 0;
		const nitFlopValue = name === "nit" && street === 0 && tier === 3 && opponents.length === 1 &&
			checkedTo && foldEquity && !info.paired && !dangerous &&
			player.chips > state.bigBlind && raiseCap >= state.bigBlind &&
			(rankOf(player.holeCards[0]) === rankOf(player.holeCards[1]) ||
				player.holeCards.some((card) => rankOf(card) >= 11 && rankOf(card) !== info.highest));
		const valueFrequency = profile.value[tier] + checkedToBonus - valueDiscount - leadDiscount +
			(nitFlopValue ? 0.25 : 0);
		const mayLeadValue = tier >= 3 || (!multiway && checkedTo && !dangerous);
		if (mayLeadValue && profile.value[tier] > 0 && Math.random() < valueFrequency) {
			return bet();
		}

		// Air and draws use the initiative or a checked-to opportunity. A river bluff needs a candidate.
		const cbet = street === 0 && preflopAggressor;
		const delayed = street === 1 && line.flop == null && preflopAggressor;
		const checkedOpportunity = checkedTo && (!river || line.turn == null && line.flop != null);
		const initiativeWeight = cbet || ownedPrevious ? 1 : delayed ? 0.80 : checkedOpportunity ? 0.60 : 0;
		if (tier <= 2 && foldEquity && initiativeWeight > 0) {
			const aggression = initiativeWeight * (inPosition ? 1 : 0.72);
			const semiBluff = draw.outs >= 8 && (!multiway || inPosition && !draw.vulnerable)
				? profile.semiBluff * aggression * (multiway ? 0.48 : draw.vulnerable ? 0.70 : 1)
				: 0;
			let bluff = 0;
			if (!multiway && tier <= 1) {
				if (street === 0 && (!wet || overcards)) {
					bluff = profile.bluff[street] * aggression;
				} else if (street === 1 && (highRunout || suitedBlocker || ownedPrevious && !wet)) {
					bluff = profile.bluff[street] * aggression * (dangerous && !suitedBlocker ? 0.45 : 1);
				} else if (river && (tier === 0 || suitedBlocker)) {
					const turnInfo = getBoardInfo(previousBoard);
					const turnDraw = getDraw(player.holeCards, turnInfo, hand.rank);
					const completesDraw = info.suitCounts[suitOf(newCard)] === 3 ||
						info.straightTexture >= 4 && info.straightTexture > turnInfo.straightTexture;
					const missedDraw = turnDraw.outs >= 8 && !completesDraw;
					const credibleOvercard = ownedPrevious && highRunout && preflopAggressor && !completesDraw;
					if (suitedBlocker || missedDraw || credibleOvercard) {
						bluff = profile.bluff[street] * aggression;
					} else if (ownedPrevious && !completesDraw && turnDraw.outs >= 4) {
						bluff = profile.bluff[street] * aggression * 0.55;
					}
				}
			}
			const frequency = Math.max(semiBluff, bluff);
			const action = bet();
			if (frequency > 0 && action.amount < Math.min(player.chips, raiseCap) && Math.random() < frequency) {
				return action;
			}
		}
		return { action: "check" };
	}

	const firstBet = handContext.streetAggressiveActionCounts[streets[street]] === 1;
	const aggressor = handContext.streetAggressorSeatIndex;
	const priorPressure = Number(line.flop != null && line.flop === aggressor) +
		Number(line.turn != null && line.turn === aggressor);
	const checkRaiseFrequency = canRaise && firstBet && !multiway && foldEquity && player.spotState.actedThisStreet &&
			!player.spotState.aggressiveThisStreet && draw.outs >= 8 && !draw.vulnerable && odds <= 0.30
		? profile.checkRaise
		: 0;
	const valueRaise = canRaise && (firstBet || tier === 6) ? profile.valueRaise[tier] : 0;
	const raiseFrequency = Math.max(checkRaiseFrequency, valueRaise * (dangerous && tier < 5 ? 0.3 : 1));
	if (raiseFrequency > 0 && Math.random() < raiseFrequency) {
		const action = wager();
		if (valueRaise > 0 || action.amount < Math.min(player.chips, raiseCap)) {
			return action;
		}
	}

	const pressure = profile.pressure * (priorPressure + Number(!firstBet) + Number(multiway));
	const boardPenalty = (dangerous ? 0.045 : 0) + (weakKicker && river ? 0.035 : 0);
	const madeLimit = profile.call[tier] - (tier <= 4 ? pressure + boardPenalty : tier === 5 && dangerous ? 0.03 : 0);
	const unseen = 52 - board.length - player.holeCards.length;
	const cleanOuts = draw.outs * (draw.vulnerable || multiway ? 0.73 : 1);
	const nextCardChance = cleanOuts / unseen;
	const closesBetting = !multiway && (callCost === player.chips || !foldEquity);
	const drawChance = street === 0 && closesBetting
		? nextCardChance + (1 - nextCardChance) * cleanOuts / (unseen - 1)
		: nextCardChance;
	const impliedOdds = !closesBetting && raiseCap >= pot && draw.outs >= 8 && !draw.vulnerable ? 0.055 : 0;
	const drawLimit = draw.outs > 0 ? drawChance + profile.drawPatience + impliedOdds - pressure / 2 : 0;
	if (odds <= Math.max(madeLimit, drawLimit)) {
		return { action: "call" };
	}
	const float = name === "lag" && street === 0 && inPosition && !multiway && firstBet &&
		!closesBetting && overcards && odds <= 0.18 && Math.random() < 0.32;
	return { action: float ? "call" : "fold" };
}
