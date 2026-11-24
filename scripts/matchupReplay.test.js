import { getPlayerActionState } from "../js/shared/actionModel.js";
import { runMatchupReplay } from "./matchupReplay.js";

function assertEquals(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Expected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
	}
}

const checkCall = (player, state) => ({
	action: getPlayerActionState(state, player).canCheck ? "check" : "call",
});
const config = {
	name: "replay-test",
	seed: 42,
	runs: 2,
	maxHands: 3,
	field: { test: "checkCall", opponent: "checkCall" },
	strategies: {
		checkCall,
		betTurn(player, state) {
			return state.currentPhaseIndex === 2 && getPlayerActionState(state, player).canCheck
				? { action: "raise", amount: state.bigBlind }
				: checkCall(player, state);
		},
	},
	strategyVersions: { checkCall: "fixture-v1", betTurn: "fixture-v1" },
	alternatives: { repeat: "checkCall", bet: "betTurn" },
	select(state, _player, role) {
		return role === "test" && state.currentPhaseIndex === 2 ? "turn" : null;
	},
};

Deno.test("a replay reproduces the same actions and payout with an unchanged strategy", () => {
	const report = runMatchupReplay(config);
	assertEquals(report.issues, []);
	assertEquals(report.records.length, 6);
	for (const record of report.records) {
		assertEquals(record.alternatives.repeat, record.baseline);
	}
	assertEquals(report.summary.turn.repeat.interval95, [0, 0]);
	assertEquals(runMatchupReplay(config), report);
});

Deno.test("replay scores a different turn action only after the rest of the hand is played", () => {
	const report = runMatchupReplay(config);
	assertEquals(report.issues, []);
	for (const record of report.records) {
		assertEquals(record.baseline.action, "check");
		assertEquals(record.alternatives.bet.action, "raise");
		assertEquals(record.alternatives.bet.amount, 20);
	}
	const changes = report.records.map((record) => record.alternatives.bet.netBb - record.baseline.netBb);
	assertEquals(changes.some((value) => value === 1), true);
	assertEquals(changes.some((value) => value === -1), true);
});
