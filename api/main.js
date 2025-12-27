const kv = await Deno.openKv();

const primaryOrigin = "https://tehes.github.io";

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
		headers: withCors({ "Content-Type": "application/json" }),
	});
}

function textResponse(body, status) {
	return new Response(body, { status, headers: withCors() });
}

async function getState(tableId) {
	const entry = await kv.get(["table", tableId]);
	return entry.value ?? null;
}

async function saveState(tableId, payload) {
	const current = await getState(tableId);
	const version = (current?.version ?? 0) + 1;
	const record = {
		state: payload.state,
		notifications: payload.notifications ?? current?.notifications ?? [],
		updatedAt: new Date().toISOString(),
		version,
	};
	await kv.set(["table", tableId], record, { expireIn: 86_400_000 });
	return record;
}

async function handlePost(request) {
	let data;
	try {
		data = await request.json();
	} catch {
		return textResponse("Invalid JSON", 400);
	}

	const state = data?.state;
	if (state === undefined) {
		return textResponse("Missing state", 400);
	}

	const tableId = data.tableId || "default";
	const record = await saveState(tableId, {
		state,
		notifications: data.notifications,
	});
	return jsonResponse({
		ok: true,
		version: record.version,
		updatedAt: record.updatedAt,
	});
}

async function handleGet(url) {
	const tableId = url.searchParams.get("tableId") || "default";
	const sinceParam = url.searchParams.get("sinceVersion");
	const sinceVersion = sinceParam ? Number.parseInt(sinceParam, 10) : 0;
	const record = await getState(tableId);
	if (!record) {
		return textResponse("Not found", 404);
	}
	if (!Number.isNaN(sinceVersion) && record.version <= sinceVersion) {
		return new Response(null, { status: 204, headers: withCors() });
	}
	return jsonResponse(record);
}

function handleOptions() {
	return new Response(null, { status: 204, headers: withCors() });
}

function routeRequest(request) {
	const url = new URL(request.url);
	if (url.pathname !== "/state") {
		return textResponse("Not found", 404);
	}

	const origin = request.headers.get("origin");
	if ((request.method === "POST" || request.method === "OPTIONS") && !allowedOrigins.has(origin)) {
		return textResponse("Forbidden", 403);
	}

	if (request.method === "OPTIONS") {
		return handleOptions();
	}

	if (request.method === "GET") {
		return handleGet(url);
	}

	if (request.method === "POST") {
		return handlePost(request);
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
