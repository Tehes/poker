import { getPlayerStatsRates } from "./gameEngine.js";

export const PLAYER_PROFILE_STORAGE_KEY = "poker:player-profile:v1";
const PLAYER_PROFILE_SCHEMA_VERSION = 1;
const RECENT_TOURNAMENT_LIMIT = 10;
const PLAYER_STATS_KEYS = [
	"hands",
	"handsWon",
	"flopsSeen",
	"handsWonAfterFlop",
	"vpip",
	"pfr",
	"threeBets",
	"threeBetOpportunities",
	"foldsToThreeBet",
	"foldToThreeBetOpportunities",
	"raisesFirstIn",
	"raiseFirstInOpportunities",
	"stealAttempts",
	"stealOpportunities",
	"foldsBigBlindToSteal",
	"bigBlindStealOpportunities",
	"flopCbets",
	"flopCbetOpportunities",
	"foldsToFlopCbet",
	"foldToFlopCbetOpportunities",
	"calls",
	"aggressiveActs",
	"reveals",
	"showdowns",
	"showdownsWon",
	"folds",
	"foldsPreflop",
	"foldsPostflop",
	"allins",
	"allinCalls",
	"aggressiveAllins",
];

export function createStatsSnapshot(stats = {}) {
	const snapshot = {};
	for (const key of PLAYER_STATS_KEYS) {
		snapshot[key] = Number.isFinite(stats[key]) ? stats[key] : 0;
	}
	return snapshot;
}

function createEmptyProfileTotals() {
	return {
		tournaments: 0,
		wins: 0,
		placementSum: 0,
		relativePlacementSum: 0,
		stats: createStatsSnapshot(),
	};
}

export function createEmptyPlayerProfile() {
	return {
		schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
		totals: createEmptyProfileTotals(),
		recentTournaments: [],
	};
}

function addTournamentToTotals(totals, result) {
	const stats = {};
	for (const key of PLAYER_STATS_KEYS) {
		stats[key] = totals.stats[key] + result.stats[key];
	}
	return {
		tournaments: totals.tournaments + 1,
		wins: totals.wins + (result.placement === 1 ? 1 : 0),
		placementSum: totals.placementSum + result.placement,
		relativePlacementSum: totals.relativePlacementSum + (result.placement - 1) / (result.participantCount - 1),
		stats,
	};
}

export function addTournamentToProfile(profile, result) {
	if (profile.recentTournaments.some((tournament) => tournament.id === result.id)) {
		return profile;
	}
	const tournament = {
		id: result.id,
		finishedAt: result.finishedAt,
		participantCount: result.participantCount,
		placement: result.placement,
		stats: createStatsSnapshot(result.stats),
	};
	return {
		...profile,
		totals: addTournamentToTotals(profile.totals, tournament),
		recentTournaments: [tournament, ...profile.recentTournaments].slice(0, RECENT_TOURNAMENT_LIMIT),
	};
}

function summarizeProfileTotals(totals) {
	return {
		tournaments: totals.tournaments,
		wins: totals.wins,
		winPct: totals.tournaments > 0 ? totals.wins / totals.tournaments * 100 : null,
		averagePlacement: totals.tournaments > 0 ? totals.placementSum / totals.tournaments : null,
		averageRelativePlacementPct: totals.tournaments > 0
			? totals.relativePlacementSum / totals.tournaments * 100
			: null,
		stats: { ...totals.stats },
		rates: getPlayerStatsRates(totals.stats),
	};
}

export function getPlayerProfileComparison(profile) {
	const recent = profile.recentTournaments;
	return {
		latest: recent.length > 0
			? { ...recent[0], ...summarizeProfileTotals(addTournamentToTotals(createEmptyProfileTotals(), recent[0])) }
			: null,
		last10: recent.length === RECENT_TOURNAMENT_LIMIT
			? summarizeProfileTotals(recent.reduce(addTournamentToTotals, createEmptyProfileTotals()))
			: null,
		overall: summarizeProfileTotals(profile.totals),
	};
}

export function getPlayerReadHistory(profile, currentTournamentId) {
	return profile.recentTournaments
		.filter((tournament) => tournament.id !== currentTournamentId)
		.reduce(addTournamentToTotals, createEmptyProfileTotals()).stats;
}

function isValidStoredStats(stats) {
	return stats !== null && typeof stats === "object" && !Array.isArray(stats) &&
		PLAYER_STATS_KEYS.every((key) => stats[key] === undefined || (Number.isInteger(stats[key]) && stats[key] >= 0));
}

function isValidStoredTournament(tournament) {
	return tournament && typeof tournament.id === "string" && tournament.id.length > 0 &&
		Number.isFinite(tournament.finishedAt) && tournament.finishedAt > 0 &&
		Number.isInteger(tournament.participantCount) && tournament.participantCount >= 2 &&
		Number.isInteger(tournament.placement) && tournament.placement >= 1 &&
		tournament.placement <= tournament.participantCount && isValidStoredStats(tournament.stats);
}

export function readPlayerProfile(storage) {
	try {
		const raw = storage.getItem(PLAYER_PROFILE_STORAGE_KEY);
		if (raw === null) {
			return createEmptyPlayerProfile();
		}
		const profile = JSON.parse(raw);
		if (
			profile?.schemaVersion !== PLAYER_PROFILE_SCHEMA_VERSION || !profile.totals ||
			!["tournaments", "wins", "placementSum"].every((key) =>
				Number.isInteger(profile.totals[key]) && profile.totals[key] >= 0
			) || !Number.isFinite(profile.totals.relativePlacementSum) || profile.totals.relativePlacementSum < 0 ||
			!isValidStoredStats(profile.totals.stats) || !Array.isArray(profile.recentTournaments) ||
			profile.recentTournaments.length > RECENT_TOURNAMENT_LIMIT ||
			!profile.recentTournaments.every(isValidStoredTournament)
		) {
			throw new Error("Invalid player profile");
		}
		return {
			...profile,
			totals: { ...profile.totals, stats: createStatsSnapshot(profile.totals.stats) },
			recentTournaments: profile.recentTournaments.map((tournament) => ({
				...tournament,
				stats: createStatsSnapshot(tournament.stats),
			})),
		};
	} catch (error) {
		console.warn("player profile read failed", error);
		return null;
	}
}

export function savePlayerProfileResult(storage, result) {
	const profile = readPlayerProfile(storage);
	if (!profile) {
		return false;
	}
	const nextProfile = addTournamentToProfile(profile, result);
	if (nextProfile === profile) {
		return true;
	}
	try {
		storage.setItem(PLAYER_PROFILE_STORAGE_KEY, JSON.stringify(nextProfile));
		return true;
	} catch (error) {
		console.warn("player profile write failed", error);
		return false;
	}
}
