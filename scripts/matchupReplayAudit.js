import pool from "./matchupPool.js";

export default {
	name: "turn-to-river-replay-audit",
	seed: pool.seed,
	runs: 12,
	field: pool.lineups.mixed,
	strategies: pool.strategies,
	strategyVersions: pool.strategyVersions,
	alternatives: { repeat: "current" },
	select(state, player, role) {
		if (role === "test" && state.currentPhaseIndex === 2 && !player.spotState.actedThisStreet) {
			return "turn-first-decision";
		}
		return null;
	},
};
