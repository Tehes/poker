const kv = await Deno.openKv();

const primaryOrigin = "https://tehes.github.io";
const STATE_TTL = 86_400_000;
const ACTION_TTL = 120_000;
const allowedActionNames = new Set(["fold", "check", "call", "raise", "allin"]);

const corsHeaders = {
	"Access-Control-Allow-Origin": primaryOrigin,
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

const allowedOrigins = new Set([
	primaryOrigin,
]);

function withCors(headers = {}) {
	return { ...corsHeaders, ...headers };
}

function jsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: withCors({
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		}),
	});
}

function textResponse(body, status) {
	return new Response(body, {
		status,
		headers: withCors({ "Cache-Control": "no-store" }),
	});
}

function emptyResponse(status = 204) {
	return new Response(null, {
		status,
		headers: withCors({ "Cache-Control": "no-store" }),
	});
}

function parseInteger(value) {
	if (value === null || value === undefined || value === "") {
		return null;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? null : parsed;
}

function getTableKey(tableId) {
	return ["table", tableId];
}

function getActionKey(tableId) {
	return ["action", tableId];
}

async function getState(tableId) {
	const entry = await kv.get(getTableKey(tableId));
	return entry.value ?? null;
}

async function saveState(tableId, payload) {
	const current = await getState(tableId);
	const version = (current?.version ?? 0) + 1;
	const record = {
		gameState: payload.gameState,
		notifications: payload.notifications ?? current?.notifications ?? [],
		updatedAt: new Date().toISOString(),
		version,
	};
	await kv.set(getTableKey(tableId), record, { expireIn: STATE_TTL });
	return record;
}

async function savePendingAction(tableId, actionRequest) {
	const record = {
		seatIndex: actionRequest.seatIndex,
		turnToken: actionRequest.turnToken,
		action: actionRequest.action,
		amount: actionRequest.amount ?? null,
		createdAt: new Date().toISOString(),
	};
	await kv.set(getActionKey(tableId), record, { expireIn: ACTION_TTL });
	return record;
}

async function consumePendingAction(tableId, turnToken) {
	const key = getActionKey(tableId);
	const entry = await kv.get(key);
	const record = entry.value ?? null;
	if (!record) {
		return null;
	}
	if (record.turnToken !== turnToken) {
		await kv.delete(key);
		return null;
	}
	await kv.delete(key);
	return record;
}

async function handlePostState(request) {
	let data;
	try {
		data = await request.json();
	} catch {
		return textResponse("Invalid JSON", 400);
	}

	const gameState = data?.gameState;
	if (gameState === undefined) {
		return textResponse("Missing gameState", 400);
	}

	const tableId = data.tableId || "default";
	const record = await saveState(tableId, {
		gameState,
		notifications: data.notifications,
	});
	return jsonResponse({
		ok: true,
		version: record.version,
		updatedAt: record.updatedAt,
	});
}

async function handleGetState(url) {
	const tableId = url.searchParams.get("tableId") || "default";
	const sinceParam = url.searchParams.get("sinceVersion");
	const sinceVersion = sinceParam ? Number.parseInt(sinceParam, 10) : 0;
	const record = await getState(tableId);
	if (!record) {
		return textResponse("Not found", 404);
	}
	if (!Number.isNaN(sinceVersion) && record.version <= sinceVersion) {
		return emptyResponse();
	}
	return jsonResponse(record);
}

async function handlePostAction(request) {
	let data;
	try {
		data = await request.json();
	} catch {
		return textResponse("Invalid JSON", 400);
	}

	const tableId = data?.tableId || "default";
	const seatIndex = parseInteger(data?.seatIndex);
	const turnToken = typeof data?.turnToken === "string" ? data.turnToken.trim() : "";
	const action = typeof data?.action === "string" ? data.action.trim().toLowerCase() : "";
	const amount = parseInteger(data?.amount);

	if (seatIndex === null) {
		return textResponse("Missing seatIndex", 400);
	}
	if (!turnToken) {
		return textResponse("Missing turnToken", 400);
	}
	if (!allowedActionNames.has(action)) {
		return textResponse("Invalid action", 400);
	}
	if (action === "raise" && amount === null) {
		return textResponse("Missing amount", 400);
	}

	await savePendingAction(tableId, {
		seatIndex,
		turnToken,
		action,
		amount,
	});
	return jsonResponse({ ok: true });
}

async function handleGetAction(url) {
	const tableId = url.searchParams.get("tableId") || "default";
	const turnToken = url.searchParams.get("turnToken")?.trim() || "";
	if (!turnToken) {
		return textResponse("Missing turnToken", 400);
	}

	const record = await consumePendingAction(tableId, turnToken);
	if (!record) {
		return emptyResponse();
	}
	return jsonResponse(record);
}

function handleOptions() {
	return emptyResponse();
}

function routeRequest(request) {
	const url = new URL(request.url);
	if (url.pathname !== "/state" && url.pathname !== "/action") {
		return textResponse("Not found", 404);
	}

	const origin = request.headers.get("origin");
	if (
		(request.method === "POST" || request.method === "OPTIONS") && !allowedOrigins.has(origin)
	) {
		return textResponse("Forbidden", 403);
	}

	if (request.method === "OPTIONS") {
		return handleOptions();
	}

	if (url.pathname === "/state") {
		if (request.method === "GET") {
			return handleGetState(url);
		}
		if (request.method === "POST") {
			return handlePostState(request);
		}
		return textResponse("Method not allowed", 405);
	}

	if (request.method === "GET") {
		return handleGetAction(url);
	}
	if (request.method === "POST") {
		return handlePostAction(request);
	}
	return textResponse("Method not allowed", 405);
}

Deno.serve(async (request) => {
	try {
		return await routeRequest(request);
	} catch (error) {
		console.error("Unexpected error", error);
		return textResponse("Internal error", 500);
	}
});
