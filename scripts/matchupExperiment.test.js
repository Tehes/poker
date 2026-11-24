import { runMatchupExperiment } from "./matchupExperiment.js";

function assertEquals(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Expected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
	}
}

const comparison = {
	id: "paired",
	field: "headsUp",
	baseline: "old",
	candidate: "new",
	criteria: [{ metric: "bbPerHand", minDelta: 0, minPairs: 3 }],
};
const config = {
	name: "experiment-test",
	stage: "validation",
	seed: 42,
	runs: 4,
	strategies: { shove: () => ({ action: "allin" }), fold: () => ({ action: "fold" }) },
	strategyVersions: { shove: "fixture-v1", fold: "fixture-v1" },
	fields: { headsUp: { test: "shove", opponent: "shove" } },
	variants: { old: {}, new: {}, attack: { test: "fold" }, defense: {} },
	comparisons: [comparison],
};

Deno.test("experiment pairs the same seeds and finds an exact zero for an A/A run", () => {
	const report = runMatchupExperiment(config);
	const [paired] = report.comparisons;
	assertEquals(report.status, "pass");
	assertEquals(paired.pairs, { accepted: 4, excluded: [] });
	assertEquals(paired.metrics.bbPerHand.delta, 0);
	assertEquals(paired.metrics.bbPerHand.interval95, [0, 0]);
	assertEquals(paired.metrics.winRate.interval95, [0, 0]);
});

Deno.test("experiment excludes both sides of any incomplete tournament pair", () => {
	const report = runMatchupExperiment({ ...config, startingChips: 200, maxHands: 1 });
	const [paired] = report.comparisons;
	assertEquals(report.status, "blocked");
	assertEquals(paired.pairs.accepted, 0);
	assertEquals(paired.pairs.excluded.length, 4);
	assertEquals(paired.pairs.excluded[0].problems.map(({ arm, type }) => [arm, type]), [
		["baseline", "max-hands"],
		["candidate", "max-hands"],
	]);
	assertEquals(paired.metrics.winRate.delta, null);
});

Deno.test("a missing target spot is insufficient evidence for an experiment criterion", () => {
	const report = runMatchupExperiment({
		...config,
		comparisons: [{
			...comparison,
			spot: "no-such-spot",
			criteria: [{ metric: "bbPerSpot", minDelta: 0, minPairs: 3, minObservations: 10 }],
		}],
	});
	assertEquals(report.status, "insufficient");
	assertEquals(report.comparisons[0].metrics.bbPerSpot.delta, null);
});

Deno.test("interaction compares the combination with both individual changes", () => {
	const report = runMatchupExperiment({
		...config,
		variants: { ...config.variants, new: { test: "fold" } },
		comparisons: [{ ...comparison, attack: "attack", defense: "defense" }],
	});
	const [paired] = report.comparisons;
	assertEquals(paired.kind, "interaction");
	assertEquals(paired.metrics.bbPerHand.delta, 0);
	assertEquals(paired.metrics.bbPerHand.interval95, [0, 0]);
});
