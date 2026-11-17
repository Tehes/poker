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
		trackingVersion: 2,
		action,
		mode: state.mode,
		humans: state.humans,
		bots: state.bots,
		handCount,
		resumeCount: state.resumeCount,
		activeSeconds: Math.floor(state.activeMs / 1000),
		...extra,
	};
}
import { getPlayerTournamentPlacement } from "./gameEngine.js";

export function getSoloOutcome(players) {
	const human = players.find((player) => !player.isBot);
	const placement = getPlayerTournamentPlacement(players, human);
	return placement === null ? null : placement === 1 ? "won" : "lost";
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
