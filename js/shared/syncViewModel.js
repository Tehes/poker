/* --------------------------------------------------------------------------------------------------
Sync View Model Helpers
---------------------------------------------------------------------------------------------------*/
// Shared sync schema and payload access helpers.
// Put code here for payload versioning, projection lookup, and shape helpers shared by table, seat, and backend code.
// Do not fetch, render, poll, or compute poker flow here.

import {
	areHoleCardsFaceUp,
	getCurrentPhase,
	getPlayerHandStrengthLabel,
	isAllInRunout,
} from "../gameEngine.js";

export const SYNC_VIEW_SCHEMA_VERSION = 7;

export function getTableView(payload) {
	return payload?.table ?? null;
}

export function getSeatView(payload) {
	return payload?.seat ?? null;
}

export function findSeatView(view, seatIndex) {
	if (!view || !Array.isArray(view.seatViews)) {
		return null;
	}
	return view.seatViews.find((seat) => seat.seatIndex === seatIndex) ?? null;
}

// The backend stores the full synchronized view and answers with one seat-specific projection.
export function createSeatSyncPayload(record, seatIndex) {
	const seat = findSeatView(record?.view, seatIndex);
	if (!seat || !record?.view?.table) {
		return null;
	}

	return {
		table: record.view.table,
		seat,
		version: record.version,
		updatedAt: record.updatedAt,
		schemaVersion: record.schemaVersion ?? SYNC_VIEW_SCHEMA_VERSION,
	};
}

export function getLivePlayerActionState(actionState, now = Date.now()) {
	if (!actionState?.name || !Number.isFinite(actionState.labelUntil)) {
		return null;
	}
	if (actionState.labelUntil <= now) {
		return null;
	}
	return {
		name: actionState.name,
		labelUntil: actionState.labelUntil,
	};
}

function getLivePlayerWinnerReactionState(player, now = Date.now()) {
	if (!player?.winnerReactionEmoji || !Number.isFinite(player.winnerReactionUntil)) {
		return null;
	}
	if (player.winnerReactionUntil <= now) {
		return null;
	}
	return {
		emoji: player.winnerReactionEmoji,
		visibleUntil: player.winnerReactionUntil,
	};
}

function shouldShowTableHandStrength(player, communityCards, gameState) {
	return gameState.currentPhaseIndex > 0 &&
		communityCards.length >= 3 &&
		areHoleCardsFaceUp(player);
}

function shouldShowTableWinProbability(player, gameState) {
	return (gameState.spectatorMode || isAllInRunout(gameState.players, gameState.currentBet)) &&
		gameState.currentPhaseIndex > 0 &&
		areHoleCardsFaceUp(player) &&
		typeof player.winProbability === "number";
}

function shouldShowSeatHandStrength(player, communityCards, gameState) {
	return gameState.currentPhaseIndex > 0 &&
		communityCards.length >= 3 &&
		!player.folded &&
		player.holeCards.every(Boolean);
}

function shouldShowSeatWinProbability(player, gameState) {
	return (gameState.spectatorMode || isAllInRunout(gameState.players, gameState.currentBet)) &&
		gameState.currentPhaseIndex > 0 &&
		!player.folded &&
		player.holeCards.every(Boolean) &&
		typeof player.winProbability === "number";
}

function buildPublicChipTransferState(gameState) {
	const chipTransfer = gameState?.chipTransfer;
	if (
		!chipTransfer ||
		!Number.isFinite(chipTransfer.startedAt) ||
		!Array.isArray(chipTransfer.transfers)
	) {
		return null;
	}

	const transfers = chipTransfer.transfers.filter((transfer) =>
		Number.isFinite(transfer?.seatIndex) &&
		Number.isFinite(transfer?.amount) &&
		Number.isFinite(transfer?.durationMs) &&
		Number.isFinite(transfer?.stepCount)
	);
	if (transfers.length === 0) {
		return null;
	}

	return {
		id: chipTransfer.id,
		startedAt: chipTransfer.startedAt,
		transfers: transfers.map((transfer) => ({
			seatIndex: transfer.seatIndex,
			amount: transfer.amount,
			durationMs: transfer.durationMs,
			stepCount: transfer.stepCount,
		})),
	};
}

export function buildPublicPlayerView(player, communityCards, gameState, now = Date.now()) {
	return {
		seatIndex: player.seatIndex,
		seatSlot: player.seatSlot,
		name: player.name,
		chips: player.chips,
		roundBet: player.roundBet,
		folded: player.folded,
		allIn: player.allIn,
		dealer: player.dealer,
		smallBlind: player.smallBlind,
		bigBlind: player.bigBlind,
		publicHoleCards: player.holeCards.map((cardCode, index) =>
			player.visibleHoleCards[index] ? cardCode : null
		),
		handStrengthLabel: shouldShowTableHandStrength(player, communityCards, gameState)
			? getPlayerHandStrengthLabel(player, communityCards)
			: "",
		winProbability: player.winProbability,
		showWinProbability: shouldShowTableWinProbability(player, gameState),
		winner: player.isWinner === true,
		actionState: getLivePlayerActionState(player.actionState, now),
		winnerReaction: getLivePlayerWinnerReactionState(player, now),
	};
}

export function buildSeatView(player, communityCards, gameState) {
	return {
		seatIndex: player.seatIndex,
		seatSlot: player.seatSlot,
		name: player.name,
		chips: player.chips,
		roundBet: player.roundBet,
		folded: player.folded,
		allIn: player.allIn,
		holeCards: player.holeCards.slice(),
		handStrengthLabel: shouldShowSeatHandStrength(player, communityCards, gameState)
			? getPlayerHandStrengthLabel(player, communityCards)
			: "",
		winProbability: player.winProbability,
		showWinProbability: shouldShowSeatWinProbability(player, gameState),
	};
}

export function buildSyncView(gameState, notifications = [], now = Date.now()) {
	const communityCards = Array.isArray(gameState?.communityCards)
		? gameState.communityCards.slice()
		: [];
	const players = Array.isArray(gameState?.players) ? gameState.players : [];

	return {
		table: {
			phase: getCurrentPhase(gameState.currentPhaseIndex),
			pot: gameState.pot,
			activeSeatIndex: gameState.activeSeatIndex,
			communityCards,
			notifications: Array.isArray(notifications) ? notifications.slice() : [],
			playersPublic: players.map((player) =>
				buildPublicPlayerView(player, communityCards, gameState, now)
			),
			chipTransfer: buildPublicChipTransferState(gameState),
			pendingAction: gameState.pendingAction ? { ...gameState.pendingAction } : null,
		},
		seatViews: players.map((player) => buildSeatView(player, communityCards, gameState)),
	};
}
