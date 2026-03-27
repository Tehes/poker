/* --------------------------------------------------------------------------------------------------
Sync View Model Helpers
---------------------------------------------------------------------------------------------------*/

// Shared sync schema and payload access helpers.
// Put code here for payload versioning, projection lookup, and shape helpers shared by table, seat, and backend code.
// Do not fetch, render, poll, or compute poker flow here.
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
