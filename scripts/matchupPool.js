import { chooseBotAction } from "../js/bot.js";
import { getCurrentPhase } from "../js/gameEngine.js";
import { chooseMatchupPostflopAction } from "./matchupPostflop.js";
import { chooseMatchupPreflopAction } from "./matchupPreflop.js";

// Accept a tuning change only if it fits the profile's intended play style.
// Preserving that style takes precedence over improving tournament results.
//
// Nit: Enter pots selectively and get paid with strong hands.
// Keep early-position opening ranges tighter than the TAG's at full tables.
// Take clear steals and priced calls when short-handed blinds make waiting costly.
//
// TAG: Build pots with strong ranges and positional advantage.
// Use selective semi-bluffs and widen late-position opens.
//
// LAG: Win chips by putting wider ranges under pressure.
// Choose light reraises and barrels where position, draws, or runouts support them.
//
// Calling Station: Win chips by calling wider when the price is favorable.
// Catch more bluffs with medium-strength hands and bet strong hands for value.
export const opponentStrategies = Object.fromEntries(
	["tag", "lag", "callingStation", "nit"].map((name) => [
		name,
		(player, state, line) =>
			state.currentPhaseIndex === 0
				? chooseMatchupPreflopAction(name, player, state)
				: chooseMatchupPostflopAction(name, player, state, line),
	]),
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
		...Object.fromEntries(Object.keys(opponentStrategies).map((name) => [name, "opponent-pool-v3"])),
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
