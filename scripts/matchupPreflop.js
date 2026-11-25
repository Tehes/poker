import { getEffectiveRaiseCap, getPlayerActionState } from "../js/shared/actionModel.js";

const ranks = "23456789TJQKA";

function range(notation) {
	return new Set(
		notation.split(" ").filter(Boolean).flatMap((token) => {
			if (!token.endsWith("+")) {
				return [token];
			}
			const [high, low, suit] = token.slice(0, -1);
			const end = high === low ? ranks.length : ranks.indexOf(high);
			return [...ranks.slice(ranks.indexOf(low), end)].map((rank) =>
				high === low ? rank.repeat(2) : `${high}${rank}${suit}`
			);
		}),
	);
}

// Middle, cutoff and button add hands to the preceding position. The blinds have their own ranges.
function positions(early, middle, cutoff, button, smallBlind, headsUp) {
	return {
		early: range(early),
		middle: range(`${early} ${middle}`),
		cutoff: range(`${early} ${middle} ${cutoff}`),
		button: range(`${early} ${middle} ${cutoff} ${button}`),
		smallBlind: range(smallBlind),
		headsUp: range(headsUp),
	};
}

const profiles = {
	tag: {
		open: positions(
			"55+ ATs+ A5s AJo+ KTs+ KQo QTs+ JTs T9s",
			"44 A9s A4s K9s Q9s J9s 98s",
			"33 A7s+ A3s ATo KJo QJo JTo T8s 97s 87s 76s 65s",
			"22 A2s+ A8o+ K7s+ KTo+ Q8s+ QTo+ J8s T9o 86s 75s 54s",
			"22+ A2s+ A7o+ K8s+ KTo+ Q9s+ QTo+ J9s+ JTo T8s+ 98s 87s 76s",
			"22+ A2s+ A2o+ K3s+ K7o+ Q5s+ Q8o+ J7s+ J9o+ T7s+ T9o 97s+ 86s+ 75s+ 65s 54s",
		),
		limp: range(""),
		overlimp: range("22 33 44 54s 65s 76s 87s 97s 98s"),
		complete: range("A2o+ K2s+ K7o+ Q5s+ Q9o+ J7s+ J9o+ T7s+ 96s+ 86s+ 75s+ 64s+ 54s"),
		isolate: range("55+ A8s+ ATo+ K9s+ KJo+ Q9s+ QJo JTs T9s 98s"),
		threeBet: range("QQ+ AKs AKo"),
		lateThreeBet: range("TT+ AJs+ AQo+ KQs"),
		lightThreeBet: range("A5s A4s 76s"),
		lightFrequency: 0.25,
		flat: range("77+ AJs+ AQo+ KQs"),
		lateFlat: range("44+ A8s+ AJo+ KTs+ KQo QTs+ JTs T9s 98s"),
		bigBlindFlat: range("22+ A2s+ A8o+ K7s+ KTo+ Q8s+ QTo+ J8s+ JTo T8s+ T9o 97s+ 86s+ 75s+ 65s 54s"),
		cheapBlindFlat: range("A2o+ K2s+ K8o+ Q5s+ Q9o+ J7s+ J9o+ T7s+ 96s+ 85s+ 74s+ 64s 53s"),
		fourBet: range("KK+ AKs"),
		callThreeBet: range("TT+ AQs+ AKo"),
		stackOff: range("QQ+ AKs AKo"),
		shortOpen: range("66+ A9s+ ATo+ KJs+ KQo QJs"),
		shortSteal: range("22+ A2s+ A5o+ K8s+ KTo+ Q9s+ QTo+ J9s+ JTo T9s 98s"),
		shortHeadsUp: range("22+ A2s+ A2o+ K4s+ K7o+ Q7s+ Q9o+ J8s+ JTo T8s+ 98s 87s"),
		shortCall: range("66+ A9s+ ATo+ KQs"),
		headsUpCall: range("22+ A2s+ A5o+ K9s+ KJo+ QTs+ JTs"),
		callOdds: 0.39,
		shortCallOdds: 0.46,
	},
	lag: {
		open: positions(
			"44+ A8s+ A5s A4s ATo+ K9s+ KJo+ Q9s+ QJo J9s+ T8s+ 98s 87s 76s",
			"33 A6s+ A3s A9o K8s KTo Q8s QTo J8s JTo 97s 86s 65s",
			"22 A2s+ A7o+ K6s+ K9o+ Q7s+ Q9o+ J7s+ J9o+ T7s+ T9o 96s 98o 85s 75s 54s",
			"A2o+ K3s+ K7o+ Q4s+ Q8o+ J6s+ J8o+ T6s+ T8o+ 95s+ 97o+ 84s+ 87o 74s+ 64s+ 53s",
			"22+ A2s+ A2o+ K4s+ K8o+ Q6s+ Q9o+ J7s+ J9o+ T7s+ T9o 96s+ 98o 85s+ 75s+ 64s+ 54s",
			"22+ A2s+ A2o+ K2s+ K4o+ Q3s+ Q6o+ J4s+ J7o+ T5s+ T7o+ 95s+ 97o+ 84s+ 86o+ 74s+ 76o 63s+ 54s",
		),
		limp: range(""),
		overlimp: range("22 33 44 54s 64s 65s 75s 76s 86s"),
		complete: range("K2s+ K5o+ Q3s+ Q7o+ J4s+ J8o+ T5s+ T8o+ 94s+ 97o+ 84s+ 86o+ 74s+ 63s+ 53s"),
		isolate: range("44+ A5s+ A9o+ K8s+ KTo+ Q8s+ QTo+ J8s+ JTo T8s+ 97s+ 87s 76s"),
		threeBet: range("JJ+ AQs+ AKo"),
		lateThreeBet: range("88+ ATs+ AJo+ KJs+ KQo QJs"),
		lightThreeBet: range("A5s A4s A3s K9s Q9s J9s 98s 87s 76s 65s"),
		lightFrequency: 0.55,
		flat: range("55+ ATs+ AJo+ KJs+ KQo QJs JTs T9s"),
		lateFlat: range("22+ A5s+ ATo+ K9s+ KJo+ Q9s+ QJo J9s+ T8s+ 98s 87s 76s 65s"),
		bigBlindFlat: range("22+ A2s+ A2o+ K4s+ K8o+ Q6s+ Q9o+ J7s+ J9o+ T7s+ T9o 96s+ 98o 85s+ 87o 75s+ 64s+ 54s"),
		cheapBlindFlat: range("K2s+ K6o+ Q3s+ Q7o+ J5s+ J8o+ T6s+ T8o+ 95s+ 97o+ 84s+ 86o+ 74s+ 63s+ 53s"),
		fourBet: range("QQ+ AKs AKo"),
		callThreeBet: range("88+ AJs+ AQo+ KQs"),
		stackOff: range("JJ+ AQs+ AKo"),
		shortOpen: range("44+ A7s+ A5s A9o+ KTs+ KJo+ QTs+ JTs"),
		shortSteal: range("22+ A2s+ A2o+ K6s+ K8o+ Q8s+ Q9o+ J8s+ JTo T8s+ 98s 87s"),
		shortHeadsUp: range("22+ A2s+ A2o+ K2s+ K4o+ Q4s+ Q7o+ J6s+ J8o+ T7s+ T9o 97s+ 86s+ 76s"),
		shortCall: range("55+ A7s+ A9o+ KJs+ KQo QJs"),
		headsUpCall: range("22+ A2s+ A2o+ K7s+ KTo+ Q9s+ QJo J9s+ T9s"),
		callOdds: 0.42,
		shortCallOdds: 0.47,
	},
	callingStation: {
		open: positions("JJ+ AQs+ AKo", "", "TT AQo", "", "TT+ AQs+ AQo+", "88+ ATs+ AJo+ KQs"),
		limp: range("22+ A2s+ A2o+ K2s+ K7o+ Q5s+ Q8o+ J6s+ J8o+ T7s+ T8o+ 96s+ 98o 85s+ 87o 74s+ 64s+ 54s"),
		overlimp: range("K5o+ Q3s+ Q7o+ J4s+ J7o+ T6s+ 95s+ 97o+ 84s+ 86o+ 73s+ 63s+ 53s 43s"),
		complete: range("K2s+ K5o+ Q3s+ Q7o+ J5s+ J8o+ T6s+ T8o+ 95s+ 97o+ 84s+ 87o 74s+ 63s+ 53s"),
		isolate: range("JJ+ AQs+ AKo"),
		threeBet: range("KK+ AKs"),
		lateThreeBet: range("QQ+ AKs AKo"),
		lightThreeBet: range(""),
		lightFrequency: 0,
		flat: range("22+ A2s+ A6o+ K5s+ K9o+ Q7s+ QTo+ J7s+ J9o+ T7s+ T9o 96s+ 86s+ 75s+ 65s 54s"),
		lateFlat: range("22+ A2s+ A3o+ K3s+ K8o+ Q5s+ Q8o+ J6s+ J8o+ T6s+ T8o+ 96s+ 98o 85s+ 87o 74s+ 64s+ 54s"),
		bigBlindFlat: range("22+ A2s+ A2o+ K3s+ K7o+ Q5s+ Q8o+ J6s+ J8o+ T6s+ T8o+ 95s+ 97o+ 84s+ 87o 74s+ 64s+ 54s"),
		cheapBlindFlat: range("K2s+ K4o+ Q2s+ Q6o+ J3s+ J7o+ T5s+ T7o+ 94s+ 96o+ 83s+ 86o+ 73s+ 63s+ 53s"),
		fourBet: range("AA"),
		callThreeBet: range("77+ ATs+ AJo+ KTs+ KQo QJs JTs"),
		stackOff: range("JJ+ AQs+ AKo"),
		shortOpen: range("JJ+ AQs+ AKo"),
		shortSteal: range("99+ AJs+ AQo+"),
		shortHeadsUp: range("66+ A9s+ ATo+ KJs+ KQo"),
		shortCall: range("44+ A5s+ A8o+ KTs+ KJo+ QTs+ JTs"),
		headsUpCall: range("22+ A2s+ A2o+ K6s+ K9o+ Q8s+ QTo+ J9s+ T9s 98s"),
		callOdds: 0.44,
		shortCallOdds: 0.48,
	},
	nit: {
		open: positions(
			"99+ AQs+ AKo",
			"88 AJs AQo KQs",
			"77 ATs AJo KJs QJs",
			"66 A8s+ ATo KTs+ KQo QTs+ JTs",
			"77+ A9s+ AJo+ KJs+ KQo QJs",
			"44+ A5s+ A8o+ K9s+ KTo+ QTs+ JTs",
		),
		limp: range("55 66 77 88 ATs AJs KQs"),
		overlimp: range("66 77 88 99 TT"),
		complete: range("66+ ATs+ KJs+ QJs JTs"),
		isolate: range("TT+ AJs+ AQo+ KQs"),
		threeBet: range("KK+ AKs"),
		lateThreeBet: range("QQ+ AKs AKo"),
		lightThreeBet: range(""),
		lightFrequency: 0,
		flat: range("TT+ AQs+ AKo"),
		lateFlat: range("88+ AJs+ AQo+ KQs"),
		bigBlindFlat: range("66+ ATs+ AJo+ KJs+ KQo QJs JTs"),
		cheapBlindFlat: range("44+ A8s+ KTs+ QTs+ T9s"),
		fourBet: range("AA"),
		callThreeBet: range("QQ+ AKs AKo"),
		stackOff: range("KK+ AKs"),
		shortOpen: range("99+ AQs+ AKo"),
		shortSteal: range("77+ ATs+ AJo+ KQs"),
		shortHandedSteal: range("22+ A2s+ A8o+ KQs"),
		shortHeadsUp: range("22+ A2s+ A5o+ KTs+ KQo QJs"),
		shortCall: range("99+ AJs+ AQo+"),
		headsUpCall: range("77+ ATs+ AJo+ KQs"),
		callOdds: 0.39,
		shortCallOdds: 0.45,
	},
};

function getHandClass(cards) {
	const [first, second] = cards;
	const [high, low] = ranks.indexOf(first[0]) >= ranks.indexOf(second[0]) ? [first, second] : [second, first];
	return high[0] + low[0] + (high[0] === low[0] ? "" : high[1] === low[1] ? "s" : "o");
}

function isLate(position) {
	return position === "cutoff" || position === "button" || position === "smallBlind" || position === "headsUp";
}

function actsLastAgainst(players, player, opponent) {
	return player.dealer || (!opponent.dealer && players.indexOf(player) > players.indexOf(opponent));
}

export function chooseMatchupPreflopAction(name, player, state) {
	const profile = profiles[name];
	const { players, bigBlind, currentBet, handContext } = state;
	const { preflopRaiseCount, preflopAggressorSeatIndex, preflopOpenerSeatIndex } = handContext;
	const { needToCall, canCheck, minRaise, maxRaiseAmount } = getPlayerActionState(state, player);
	const raiseCap = getEffectiveRaiseCap(state, player);
	const effectiveTotal = player.roundBet + Math.min(player.chips, raiseCap);
	const shortStack = effectiveTotal <= 13 * bigBlind;
	const canRaise = player.chips > needToCall && raiseCap > needToCall &&
		(!player.spotState.actedThisStreet || needToCall >= state.lastRaise);
	const position = player.spotState.position;
	const headsUp = players.length === 2 && position === "smallBlind";
	const openPosition = headsUp ? "headsUp" : players.length === 5 && position === "early" ? "middle" : position;
	const hand = getHandClass(player.holeCards);
	const callCost = Math.min(player.chips, needToCall);
	const odds = callCost / (state.pot + callCost);

	const raiseTo = (total) => {
		const amount = Math.min(maxRaiseAmount, Math.max(minRaise, total - player.roundBet));
		return { action: amount === player.chips ? "allin" : "raise", amount };
	};
	const raiseToBb = (size) => raiseTo(Math.round(size * bigBlind / 10) * 10);

	if (preflopRaiseCount === 0) {
		const limpers = players.filter((seat) =>
			seat !== player && !seat.folded && seat.spotState.enteredPreflop
		).length;
		if (canCheck && limpers === 0) {
			return { action: "check" };
		}
		const open = profile.open[openPosition];
		const shortSteal = name === "nit" && players.length <= 4 && limpers === 0 &&
				(position === "button" || position === "smallBlind")
			? profile.shortHandedSteal
			: profile.shortSteal;
		const shortRange = headsUp ? profile.shortHeadsUp : isLate(position) ? shortSteal : profile.shortOpen;
		const raiseHand = limpers > 0
			? profile.isolate.has(hand) && (position === "bigBlind" || open.has(hand))
			: position !== "bigBlind" && open.has(hand);
		if (canRaise && (shortStack ? shortRange.has(hand) && (limpers === 0 || raiseHand) : raiseHand)) {
			if (shortStack) {
				return raiseTo(effectiveTotal);
			}
			const size = position === "smallBlind" && !headsUp ? 3 : 2.5;
			return raiseToBb(
				limpers > 0 ? 3 + limpers + (player.bigBlind || player.smallBlind && !headsUp ? 0.5 : 0) : size,
			);
		}
		if (canCheck) {
			return { action: "check" };
		}
		const limp = ((!shortStack || name === "callingStation") && profile.limp.has(hand)) ||
			(limpers > 0 && !shortStack && profile.overlimp.has(hand)) ||
			(position === "smallBlind" && (headsUp || limpers > 0) && profile.complete.has(hand));
		return { action: limp && (needToCall < player.chips || profile.shortCall.has(hand)) ? "call" : "fold" };
	}

	if (canCheck) {
		return { action: "check" };
	}
	const aggressor = players.find((seat) => seat.seatIndex === preflopAggressorSeatIndex);
	const opener = players.find((seat) => seat.seatIndex === preflopOpenerSeatIndex);
	const lateOpen = isLate(opener.spotState.position);
	const inPosition = actsLastAgainst(players, player, aggressor);
	const effectiveAgainstAggressor = Math.min(player.roundBet + player.chips, aggressor.roundBet + aggressor.chips);
	const versusShort = effectiveAgainstAggressor <= 13 * bigBlind;
	const stackOff = effectiveAgainstAggressor <= 40 * bigBlind ? profile.stackOff : profile.fourBet;

	if (aggressor.allIn || needToCall >= player.chips) {
		const shortRange = players.length === 2 ? profile.headsUpCall : lateOpen ? profile.shortCall : profile.stackOff;
		const cheapHeadsUp = players.length === 2 && position === "bigBlind" && odds <= 0.34 &&
			(profile.bigBlindFlat.has(hand) || profile.cheapBlindFlat.has(hand));
		const shortCall = versusShort && odds <= profile.shortCallOdds && (shortRange.has(hand) || cheapHeadsUp);
		return { action: stackOff.has(hand) || shortCall ? "call" : "fold" };
	}

	if (preflopRaiseCount >= 2) {
		const raiseRange = preflopRaiseCount === 2 ? profile.fourBet : profile.stackOff;
		if (canRaise && raiseRange.has(hand)) {
			return shortStack || currentBet * 2.2 >= effectiveTotal / 2
				? raiseTo(effectiveTotal)
				: raiseToBb(currentBet / bigBlind * (inPosition ? 2.2 : 2.5));
		}
		const entered = player.roundBet > bigBlind && player.spotState.enteredPreflop;
		const call = stackOff.has(hand) ||
			(entered && preflopRaiseCount === 2 && profile.callThreeBet.has(hand) && odds <= profile.callOdds);
		return { action: call ? "call" : "fold" };
	}

	const standardOpen = currentBet <= 4 * bigBlind;
	const valueRaise = (lateOpen && standardOpen ? profile.lateThreeBet : profile.threeBet).has(hand);
	const callers =
		players.filter((seat) => seat !== aggressor && seat !== player && !seat.folded && seat.roundBet === currentBet)
			.length;
	const lightRaise = canRaise && lateOpen && currentBet <= 3 * bigBlind && effectiveTotal >= 25 * bigBlind &&
		callers <= 1 && profile.lightThreeBet.has(hand) &&
		!players.some((seat) => !seat.folded && seat.allIn) && Math.random() < profile.lightFrequency;
	if (canRaise && (valueRaise || lightRaise)) {
		const size = currentBet / bigBlind * (inPosition ? 3 : 3.5) + callers;
		return shortStack || size * bigBlind >= effectiveTotal / 2 ? raiseTo(effectiveTotal) : raiseToBb(size);
	}

	const flat = lateOpen && standardOpen && position !== "smallBlind" ? profile.lateFlat : profile.flat;
	const blindFlat = position === "bigBlind" && standardOpen &&
		(lateOpen && profile.bigBlindFlat.has(hand) ||
			odds <= 0.24 && (lateOpen ? profile.cheapBlindFlat : profile.lateFlat).has(hand));
	const pricedIn = odds <= profile.callOdds &&
		(versusShort ? profile.shortCall.has(hand) : flat.has(hand) || blindFlat);
	return { action: profile.threeBet.has(hand) || pricedIn ? "call" : "fold" };
}
