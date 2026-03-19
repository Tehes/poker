const kv = await Deno.openKv();

const primaryOrigin = "https://tehes.github.io";
const phases = ["preflop", "flop", "turn", "river", "showdown"];

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

function toNumber(value, fallback = 0) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizePlayerState(player, index) {
	const stats = player?.stats ?? {};
	const holeCards = Array.isArray(player?.holeCards)
		? player.holeCards.slice(0, 2)
		: Array.isArray(player?.cards)
		? player.cards.slice(0, 2)
		: [];

	return {
		name: typeof player?.name === "string" ? player.name : "",
		chips: toNumber(player?.chips),
		roundBet: toNumber(player?.roundBet),
		totalBet: toNumber(player?.totalBet),
		folded: player?.folded === true,
		allIn: player?.allIn === true,
		isBot: player?.isBot === true,
		dealer: player?.dealer === true,
		smallBlind: player?.smallBlind === true,
		bigBlind: player?.bigBlind === true,
		cards: [holeCards[0] ?? null, holeCards[1] ?? null],
		seatIndex: toNumber(player?.seatIndex, index),
		stats: {
			hands: toNumber(stats.hands),
			handsWon: toNumber(stats.handsWon),
			reveals: toNumber(stats.reveals),
			showdowns: toNumber(stats.showdowns),
			showdownsWon: toNumber(stats.showdownsWon),
		},
	};
}

function normalizeGameState(gameState) {
	const players = Array.isArray(gameState?.players) ? gameState.players : [];
	const communityCards = Array.isArray(gameState?.communityCards)
		? gameState.communityCards.slice(0, 5)
		: [];
	const phaseIndex = toNumber(gameState?.currentPhaseIndex, -1);

	return {
		phase: phases[phaseIndex] ?? null,
		pot: toNumber(gameState?.pot),
		currentBet: toNumber(gameState?.currentBet),
		lastRaise: toNumber(gameState?.lastRaise),
		smallBlind: toNumber(gameState?.smallBlind),
		bigBlind: toNumber(gameState?.bigBlind),
		raisesThisRound: toNumber(gameState?.raisesThisRound),
		dealerOrbitCount: toNumber(gameState?.dealerOrbitCount, -1),
		communityCards,
		players: players.map((player, index) => normalizePlayerState(player, index)),
		timestamp: toNumber(gameState?.timestamp, Date.now()),
	};
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

	const gameState = data?.gameState;
	if (gameState === undefined) {
		return textResponse("Missing gameState", 400);
	}

	const tableId = data.tableId || "default";
	const record = await saveState(tableId, {
		state: normalizeGameState(gameState),
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
