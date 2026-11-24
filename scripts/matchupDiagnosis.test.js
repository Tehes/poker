import { chooseBotAction } from "../js/bot.js";
import { collectMatchupDiagnosis, diagnosisColumns } from "./matchupDiagnosis.js";

function assertEquals(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Expected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
	}
}

const lineup = { test: "current", opponent: "current" };
const config = {
	seed: 42,
	runs: 2,
	startingChips: 200,
	strategies: { current: chooseBotAction },
	lineups: { reference: lineup, mixed: lineup },
	classifySpot: () => "all",
};

Deno.test("the diagnosis joins actual test-seat decisions and compares the same cohorts", async () => {
	const rows = [];
	const report = await collectMatchupDiagnosis(config, { minSpots: 1, writeRows: (batch) => rows.push(...batch) });
	assertEquals(report.includedPairs, 2);
	assertEquals(report.totals.reference, report.totals.mixed);
	assertEquals(rows.length, report.totals.reference.logged + report.totals.mixed.logged);
	const toObject = (row) => Object.fromEntries(diagnosisColumns.map((column, index) => [column, row[index]]));
	const referenceRows = rows.filter(([field]) => field === "reference").map(toObject);
	const mixedRows = rows.filter(([field]) => field === "mixed").map(toObject);
	assertEquals(
		referenceRows.map(({ field: _field, ...row }) => row),
		mixedRows.map(({ field: _field, ...row }) => row),
	);
	assertEquals(referenceRows.every(({ run, seat }) => seat === run - 1), true);
	assertEquals(referenceRows.every(({ included, action }) => included && typeof action === "string"), true);
	assertEquals(
		referenceRows.filter(({ action }) => action === "fold").every(({ netChipsFromDecision }) =>
			netChipsFromDecision === 0
		),
		true,
	);
	assertEquals(report.cohorts.spot.reduce((sum, row) => sum + row.reference.count, 0), referenceRows.length);
});

Deno.test("the diagnosis preserves excluded rows and keeps both fields out of the summary", async () => {
	const rows = [];
	const report = await collectMatchupDiagnosis({ ...config, runs: 1, maxHands: 1 }, {
		minSpots: 1,
		writeRows: (batch) => rows.push(...batch),
	});
	assertEquals(report.includedPairs, 0);
	assertEquals(report.excludedPairs[0].issues.map(({ field }) => field), ["reference", "mixed"]);
	assertEquals(report.cohorts.spot, []);
	assertEquals(rows.length > 0 && rows.every((row) => row[diagnosisColumns.indexOf("included")] === false), true);
});
