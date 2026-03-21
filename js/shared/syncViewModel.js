/* --------------------------------------------------------------------------------------------------
Sync View Model Helpers
---------------------------------------------------------------------------------------------------*/

// This module only describes the sync contract and payload access helpers.
// It must stay independent from fetch, DOM, timers, and game-flow code so the same schema
// can be consumed by the table, the single view, and the backend projection layer.
export const SYNC_VIEW_SCHEMA_VERSION = 2;

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
