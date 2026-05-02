import { normalizeBotActionRequest } from "./bot.js";

function assertEquals(actual, expected, message = "") {
	const actualJson = JSON.stringify(actual);
	const expectedJson = JSON.stringify(expected);
	if (actualJson !== expectedJson) {
		throw new Error(
			`${message}\nExpected: ${expectedJson}\nActual:   ${actualJson}`,
		);
	}
}

Deno.test("normalizeBotActionRequest returns null for missing decisions", () => {
	assertEquals(normalizeBotActionRequest(null), null);
	assertEquals(normalizeBotActionRequest(undefined), null);
});

Deno.test("normalizeBotActionRequest keeps non-amount actions", () => {
	for (const action of ["fold", "check", "call", "allin"]) {
		assertEquals(
			normalizeBotActionRequest({ action, amount: 500 }),
			{ action },
		);
	}
});

Deno.test("normalizeBotActionRequest parses raise amount", () => {
	assertEquals(
		normalizeBotActionRequest({ action: "raise", amount: "125" }),
		{ action: "raise", amount: 125 },
	);
});

Deno.test("normalizeBotActionRequest rejects invalid raise amount", () => {
	assertEquals(normalizeBotActionRequest({ action: "raise", amount: "abc" }), null);
});

Deno.test("normalizeBotActionRequest rejects unknown actions", () => {
	assertEquals(normalizeBotActionRequest({ action: "bet", amount: 100 }), null);
});
