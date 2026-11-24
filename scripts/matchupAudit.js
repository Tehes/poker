import pool from "./matchupPool.js";

export default {
	...pool,
	name: "matchup-infrastructure-audit",
	stage: "diagnosis",
	fields: pool.lineups,
	variants: {
		baseline: {},
		repeat: {},
	},
	comparisons: [
		{
			id: "reference-aa",
			field: "reference",
			baseline: "baseline",
			candidate: "repeat",
			criteria: [{ metric: "bbPerHand", minDelta: 0, minPairs: pool.runs }],
		},
		{
			id: "mixed-aa",
			field: "mixed",
			baseline: "baseline",
			candidate: "repeat",
			spot: "turn-facing-bet",
			criteria: [{ metric: "bbPerHand", minDelta: 0, minPairs: pool.runs }],
		},
	],
};
