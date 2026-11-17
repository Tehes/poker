import {
	addTournamentToProfile,
	createEmptyPlayerProfile,
	createStatsSnapshot,
	getPlayerProfileComparison,
	getPlayerReadHistory,
	PLAYER_PROFILE_STORAGE_KEY,
	readPlayerProfile,
	savePlayerProfileResult,
} from "./playerProfile.js";

function assertEquals(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Expected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
	}
}

function createResult(index, { placement = 2, participantCount = 6, stats = {} } = {}) {
	return {
		id: `tournament-${index}`,
		finishedAt: 1000 + index,
		participantCount,
		placement,
		stats: createStatsSnapshot({ hands: index, ...stats }),
	};
}

function createStorage() {
	const values = new Map();
	return {
		writes: 0,
		getItem(key) {
			return values.get(key) ?? null;
		},
		setItem(key, value) {
			values.set(key, value);
			this.writes++;
		},
	};
}

function captureWarnings(callback) {
	const originalWarn = console.warn;
	const warnings = [];
	console.warn = (...args) => warnings.push(args);
	try {
		callback(warnings);
	} finally {
		console.warn = originalWarn;
	}
}

Deno.test("empty profiles have no Latest or L10 and reading does not create a stored profile", () => {
	const storage = createStorage();
	const profile = readPlayerProfile(storage);
	assertEquals(profile, createEmptyPlayerProfile());
	assertEquals(storage.writes, 0);
	const comparison = getPlayerProfileComparison(profile);
	assertEquals([comparison.latest, comparison.last10], [null, null]);
	assertEquals([comparison.overall.tournaments, comparison.overall.winPct], [0, null]);
	assertEquals(comparison.overall.averageRelativePlacementPct, null);
});

Deno.test("profile snapshots keep only known counters and preserve saved-game defaults", () => {
	const stats = createStatsSnapshot({ hands: 25, vpip: 8, pfr: NaN, calls: Infinity, unknown: 12 });
	assertEquals([stats.hands, stats.vpip, stats.pfr, stats.calls, stats.threeBets], [25, 8, 0, 0, 0]);
	assertEquals(Object.hasOwn(stats, "unknown"), false);
	const result = { ...createResult(1), holeCards: ["AS", "AH"], log: ["Private test data"] };
	const profile = addTournamentToProfile(createEmptyPlayerProfile(), result);
	assertEquals(Object.keys(profile.recentTournaments[0]), [
		"id",
		"finishedAt",
		"participantCount",
		"placement",
		"stats",
	]);
});

Deno.test("only the last ten compact results remain while career totals keep older tournaments", () => {
	let profile = createEmptyPlayerProfile();
	for (let index = 1; index <= 15; index++) {
		profile = addTournamentToProfile(profile, createResult(index, { placement: index % 3 === 0 ? 1 : 2 }));
		const comparison = getPlayerProfileComparison(profile);
		assertEquals(comparison.last10 !== null, index >= 10);
	}
	assertEquals(
		profile.recentTournaments.map((result) => result.id),
		Array.from({ length: 10 }, (_, i) => `tournament-${15 - i}`),
	);
	const comparison = getPlayerProfileComparison(profile);
	assertEquals([comparison.latest.id, comparison.latest.stats.hands], ["tournament-15", 15]);
	assertEquals([comparison.last10.tournaments, comparison.last10.stats.hands], [10, 105]);
	assertEquals([comparison.overall.tournaments, comparison.overall.stats.hands, comparison.overall.winPct], [
		15,
		120,
		5 / 15 * 100,
	]);
});

Deno.test("Latest, L10, and Overall calculate rates from their raw observations", () => {
	let profile = addTournamentToProfile(
		createEmptyPlayerProfile(),
		createResult(1, {
			stats: { flopCbets: 100, flopCbetOpportunities: 100, calls: 100, aggressiveActs: 100 },
		}),
	);
	for (let index = 2; index <= 11; index++) {
		profile = addTournamentToProfile(
			profile,
			createResult(index, {
				stats: {
					flopCbets: index === 11 ? 1 : 0,
					flopCbetOpportunities: index === 11 ? 2 : 10,
					calls: index === 11 ? 2 : 10,
					aggressiveActs: index === 11 ? 1 : 0,
				},
			}),
		);
	}
	const comparison = getPlayerProfileComparison(profile);
	assertEquals(comparison.latest.rates.flopCbetPct, 50);
	assertEquals(comparison.last10.rates.flopCbetPct, 1 / 92 * 100);
	assertEquals(comparison.overall.rates.flopCbetPct, 101 / 192 * 100);
	assertEquals(comparison.last10.rates.aggressionFactor, 1 / 92);
	assertEquals(comparison.overall.rates.aggressionFactor, 101 / 192);
});

Deno.test("profile placement averages take the original field size into account", () => {
	let profile = addTournamentToProfile(createEmptyPlayerProfile(), createResult(1, { participantCount: 2 }));
	profile = addTournamentToProfile(profile, createResult(2, { participantCount: 6 }));
	const comparison = getPlayerProfileComparison(profile);
	assertEquals(comparison.latest.averageRelativePlacementPct, 20);
	assertEquals(comparison.overall.averageRelativePlacementPct, 60);
	profile = addTournamentToProfile(profile, createResult(3, { placement: 1, participantCount: 3 }));
	assertEquals(getPlayerProfileComparison(profile).overall.winPct, 1 / 3 * 100);
});

Deno.test("profile updates and comparisons do not mutate results or earlier profiles", () => {
	const profile = createEmptyPlayerProfile();
	const result = createResult(1);
	const before = JSON.stringify(profile);
	const next = addTournamentToProfile(profile, result);
	assertEquals(JSON.stringify(profile), before);
	result.stats.hands = 999;
	assertEquals(next.recentTournaments[0].stats.hands, 1);
	const comparison = getPlayerProfileComparison(next);
	comparison.latest.stats.hands = 500;
	comparison.overall.stats.hands = 500;
	assertEquals(next.totals.stats.hands, 1);
	assertEquals(next.recentTournaments[0].stats.hands, 1);
	assertEquals(addTournamentToProfile(next, createResult(1)) === next, true);
});

Deno.test("a repeated completion after reloading the profile is written and counted only once", () => {
	const storage = createStorage();
	const result = createResult(1, { placement: 1 });
	assertEquals(savePlayerProfileResult(storage, result), true);
	assertEquals(savePlayerProfileResult(storage, result), true);
	assertEquals(storage.writes, 1);
	const restored = readPlayerProfile(storage);
	assertEquals([restored.totals.tournaments, restored.totals.wins, restored.totals.stats.hands], [1, 1, 1]);
	assertEquals(restored.recentTournaments.length, 1);
});

Deno.test("all profile counters survive a storage round trip and accumulate without losses", () => {
	const storage = createStorage();
	const stats = createStatsSnapshot();
	Object.keys(stats).forEach((key, index) => stats[key] = index + 1);
	assertEquals(savePlayerProfileResult(storage, createResult(1, { stats })), true);
	assertEquals(savePlayerProfileResult(storage, createResult(2, { stats })), true);
	const profile = readPlayerProfile(storage);
	assertEquals(profile.recentTournaments[0].stats, stats);
	for (const key of Object.keys(stats)) {
		assertEquals(profile.totals.stats[key], stats[key] * 2);
	}
});

Deno.test("unknown schemas, malformed JSON, and invalid counters are preserved without overwriting", () => {
	for (
		const raw of [
			"{broken-json",
			JSON.stringify({ ...createEmptyPlayerProfile(), schemaVersion: 2 }),
			JSON.stringify({ ...createEmptyPlayerProfile(), totals: {} }),
			JSON.stringify({
				...createEmptyPlayerProfile(),
				totals: { ...createEmptyPlayerProfile().totals, stats: { hands: -1 } },
			}),
		]
	) {
		const storage = createStorage();
		storage.setItem(PLAYER_PROFILE_STORAGE_KEY, raw);
		captureWarnings((warnings) => {
			assertEquals(savePlayerProfileResult(storage, createResult(1)), false);
			assertEquals(warnings.length, 1);
		});
		assertEquals(storage.getItem(PLAYER_PROFILE_STORAGE_KEY), raw);
		assertEquals(storage.writes, 1);
	}
});

Deno.test("missing counters in stored results get defaults without rewriting earlier data", () => {
	const storage = createStorage();
	const profile = addTournamentToProfile(
		createEmptyPlayerProfile(),
		createResult(1, {
			stats: { flopCbets: 2, flopCbetOpportunities: 4 },
		}),
	);
	delete profile.totals.stats.flopCbets;
	delete profile.recentTournaments[0].stats.flopCbets;
	const raw = JSON.stringify(profile);
	storage.setItem(PLAYER_PROFILE_STORAGE_KEY, raw);
	const restored = readPlayerProfile(storage);
	assertEquals(restored.totals.stats.flopCbets, 0);
	assertEquals(restored.recentTournaments[0].stats.flopCbets, 0);
	assertEquals(restored.totals.stats.flopCbetOpportunities, 4);
	assertEquals(storage.getItem(PLAYER_PROFILE_STORAGE_KEY), raw);
	assertEquals(storage.writes, 1);
});

Deno.test("unavailable storage and failed writes do not count a result and can be retried", () => {
	captureWarnings((warnings) => {
		assertEquals(
			savePlayerProfileResult({
				getItem() {
					throw new Error("Storage blocked");
				},
			}, createResult(1)),
			false,
		);
		assertEquals(warnings.length, 1);
	});
	const storage = createStorage();
	const originalSetItem = storage.setItem;
	storage.setItem = () => {
		throw new Error("Quota exceeded");
	};
	captureWarnings((warnings) => {
		assertEquals(savePlayerProfileResult(storage, createResult(1)), false);
		assertEquals(warnings.length, 1);
	});
	assertEquals(readPlayerProfile(storage).totals.tournaments, 0);
	storage.setItem = originalSetItem;
	assertEquals(savePlayerProfileResult(storage, createResult(1)), true);
	assertEquals(readPlayerProfile(storage).totals.tournaments, 1);
});

Deno.test("read history uses up to ten results without waiting for the L10 display threshold", () => {
	let profile = createEmptyPlayerProfile();
	assertEquals(getPlayerReadHistory(profile).hands, 0);
	profile = addTournamentToProfile(profile, createResult(1));
	profile = addTournamentToProfile(profile, createResult(2));
	assertEquals(getPlayerReadHistory(profile).hands, 3);
	assertEquals(getPlayerProfileComparison(profile).last10, null);
	const frozen = getPlayerReadHistory(profile);
	for (let index = 3; index <= 15; index++) {
		profile = addTournamentToProfile(profile, createResult(index));
	}
	assertEquals(getPlayerReadHistory(profile).hands, 105);
	assertEquals(getPlayerReadHistory(profile, "tournament-15").hands, 90);
	assertEquals(frozen.hands, 3);
	assertEquals(profile.totals.stats.hands, 120);
});
