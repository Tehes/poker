import { getPlayerTournamentPlacement } from "./gameEngine.js";

export function createAnalyticsState(players) {
	const humans = players.filter((player) => !player.isBot).length;
	return {
		mode: humans === 0 ? "bots" : humans === 1 ? "solo" : "multiplayer",
		humans,
		bots: players.length - humans,
		resumeCount: 0,
		activeMs: 0,
		activeSince: null,
		resultSent: false,
	};
}

export function setAnalyticsVisible(state, visible, now) {
	if (state.activeSince !== null) {
		state.activeMs += Math.max(0, now - state.activeSince);
		state.activeSince = null;
	}
	if (visible && !state.resultSent) {
		state.activeSince = now;
	}
}

export function getAnalyticsSnapshot(state, now) {
	return {
		...state,
		activeMs: state.activeMs + (state.activeSince === null ? 0 : Math.max(0, now - state.activeSince)),
		activeSince: null,
	};
}

export function analyticsPayload(state, action, handCount, extra = {}) {
	return {
		trackingVersion: 4,
		action,
		humans: state.humans,
		bots: state.bots,
		handCount,
		resumeCount: state.resumeCount,
		activeSeconds: Math.floor(state.activeMs / 1000),
		...extra,
	};
}
export function getSoloOutcome(players) {
	const human = players.find((player) => !player.isBot);
	const placement = getPlayerTournamentPlacement(players, human);
	return placement === null ? null : placement === 1 ? "won" : "lost";
}

export function getHumanAnalytics(stats) {
	return {
		humanHands: stats.hands,
		humanVpipHands: stats.vpip,
		humanPfrHands: stats.pfr,
		humanFlopsSeen: stats.flopsSeen,
		humanShowdowns: stats.showdowns,
		humanShowdownsWon: stats.showdownsWon,
		humanThreeBets: stats.threeBets,
		humanThreeBetOpportunities: stats.threeBetOpportunities,
		humanFoldsToThreeBet: stats.foldsToThreeBet,
		humanFoldToThreeBetOpportunities: stats.foldToThreeBetOpportunities,
		humanRaisesFirstIn: stats.raisesFirstIn,
		humanRaiseFirstInOpportunities: stats.raiseFirstInOpportunities,
		humanStealAttempts: stats.stealAttempts,
		humanStealOpportunities: stats.stealOpportunities,
		humanFoldsBigBlindToSteal: stats.foldsBigBlindToSteal,
		humanBigBlindStealOpportunities: stats.bigBlindStealOpportunities,
		humanFlopCbets: stats.flopCbets,
		humanFlopCbetOpportunities: stats.flopCbetOpportunities,
		humanFoldsToFlopCbet: stats.foldsToFlopCbet,
		humanFoldToFlopCbetOpportunities: stats.foldToFlopCbetOpportunities,
		humanPostflopCalls: stats.calls,
		humanPostflopAggressiveActs: stats.aggressiveActs,
		humanHandsWonAfterFlop: stats.handsWonAfterFlop,
		humanAllinCalls: stats.allinCalls,
		humanAggressiveAllins: stats.aggressiveAllins,
	};
}

export function getDiscardOutcome(snapshot) {
	if (!snapshot.gameState.handInProgress || snapshot.flowState.type === "chip-transfer") {
		return getSoloOutcome(snapshot.gameState.players) || "discarded";
	}
	return "discarded";
}

export function finishAnalytics(state, now) {
	if (state.resultSent) {
		return false;
	}
	setAnalyticsVisible(state, false, now);
	state.resultSent = true;
	return true;
}
