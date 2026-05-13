import {
	analyzeOutcomeLogs,
	analyzeRunDecisions,
	createEmptyMetrics,
	createEmptyOutcomeMetricsAccumulator,
	createMdfAnalysis,
	createPostflopLineReadAnalysis,
	finalizeOutcomeMetrics,
	incrementCount,
	mergeOutcomeMetrics,
	mergeRunMetrics,
	RERAISE_LOW_EDGE_THRESHOLD,
	summarizeFoldRateRow,
} from "./speedmodeAnalysis.js";

const DEFAULT_RUN_COUNT = 1;
const DEFAULT_SERVER_PORT = 8123;
const DEFAULT_DEVTOOLS_PORT = 9222;
const DEFAULT_PAGE_PATH = "index.html?speedmode=1&botdebug=detail";
const DEFAULT_OUTPUT_BASE = "tmp";
const DEFAULT_OUTPUT_PREFIX = "poker-speedmode-batch";
const LOAD_TIMEOUT_MS = 15000;
const RUN_TIMEOUT_MS = 180000;
const PAGE_READY_TIMEOUT_MS = 15000;
const POST_RUN_DRAIN_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 500;
const CONTENT_TYPES = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".txt": "text/plain; charset=utf-8",
};
const START_CAPTURE_EXPRESSION = `(() => {
	window.__capturedLogs = [];
	const originalLog = console.log.bind(console);
	console.log = (...args) => {
		const text = args.map((arg) => {
			if (typeof arg === "string") {
				return arg;
			}
			try {
				return JSON.stringify(arg);
			} catch {
				return String(arg);
			}
		}).join(" ");
		window.__capturedLogs.push(text);
		return originalLog(...args);
	};
	const startButton = document.getElementById("start-button");
	if (!startButton) {
		throw new Error("start-button not found");
	}
	window.__speedmodeBatchStarted = true;
	startButton.click();
	return true;
})()`;
const PAGE_READY_EXPRESSION = `(() => !!window.poker && !!document.getElementById("start-button"))()`;
const RUN_STATE_EXPRESSION = `(() => {
	const poker = window.poker;
	const players = poker?.players ?? [];
	const livePlayers = players.filter((player) => player.chips > 0);
	const finished = !!window.__speedmodeBatchStarted &&
		poker?.gameFinished === true &&
		poker?.handInProgress === false;
	return {
		finished,
		activePlayers: livePlayers.length,
		champion: livePlayers.length === 1 ? livePlayers[0].name : null,
		logCount: window.__capturedLogs?.length ?? 0,
		maxHands: players.reduce((value, player) => Math.max(value, player.stats?.hands ?? 0), 0),
	};
})()`;
const RUN_PAYLOAD_EXPRESSION = `(() => {
	const poker = window.poker;
	const players = poker?.players ?? [];
	const livePlayers = players.filter((player) => player.chips > 0);
	const finished = !!window.__speedmodeBatchStarted &&
		poker?.gameFinished === true &&
		poker?.handInProgress === false;
	return {
		finished,
		players: players.map((player) => ({ name: player.name, chips: player.chips })),
		logs: window.__capturedLogs ?? [],
	};
})()`;

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDeferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

async function waitForSettledRunPayload(page, timeoutMs = POST_RUN_DRAIN_TIMEOUT_MS) {
	const startedAt = Date.now();
	let latestPayload = null;

	while (Date.now() - startedAt < timeoutMs) {
		latestPayload = await page.evaluate(RUN_PAYLOAD_EXPRESSION);
		const outcome = analyzeOutcomeLogs(latestPayload.logs);
		const hasStructuredEvents = outcome.rawMetrics.decisionJoinCoverage.totalDecisions > 0 ||
			outcome.rawMetrics.decisionJoinCoverage.totalHands > 0;
		const missingOutcomeEvents = outcome.rawMetrics.decisionJoinCoverage.missingHandStart > 0 ||
			outcome.rawMetrics.decisionJoinCoverage.missingHandResult > 0 ||
			outcome.rawMetrics.decisionJoinCoverage.missingHandResults > 0;

		if (!hasStructuredEvents || !missingOutcomeEvents) {
			return { payload: latestPayload, outcome };
		}

		await sleep(POLL_INTERVAL_MS);
	}

	const payload = latestPayload ?? await page.evaluate(RUN_PAYLOAD_EXPRESSION);
	return {
		payload,
		outcome: analyzeOutcomeLogs(payload.logs),
	};
}

function formatTimestamp(date = new Date()) {
	const yyyy = String(date.getFullYear());
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	const hh = String(date.getHours()).padStart(2, "0");
	const min = String(date.getMinutes()).padStart(2, "0");
	const ss = String(date.getSeconds()).padStart(2, "0");
	return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function parsePositiveInteger(value, label) {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`Invalid ${label}: ${value}`);
	}
	return parsed;
}

function resolveOutputDir(outputDir) {
	const requestedOutputDir = outputDir || `${DEFAULT_OUTPUT_BASE}/${DEFAULT_OUTPUT_PREFIX}-${formatTimestamp()}`;
	const normalizedOutputDir = requestedOutputDir.replace(/\/+$/, "");
	if (normalizedOutputDir.startsWith("/")) {
		return normalizedOutputDir;
	}

	const normalizedCwd = Deno.cwd().replace(/\/+$/, "");
	const relativePath = normalizedOutputDir.replace(/^\.?\//, "");
	return `${normalizedCwd}/${relativePath}`;
}

function parseArgs(args) {
	const config = {
		runCount: DEFAULT_RUN_COUNT,
		serverPort: DEFAULT_SERVER_PORT,
		devtoolsPort: DEFAULT_DEVTOOLS_PORT,
		pagePath: DEFAULT_PAGE_PATH,
		outputDir: null,
		chromePath: null,
	};

	for (const arg of args) {
		if (arg === "--") {
			continue;
		} else if (arg.startsWith("--runs=")) {
			config.runCount = parsePositiveInteger(arg.slice(7), "runs");
		} else if (arg.startsWith("--server-port=")) {
			config.serverPort = parsePositiveInteger(
				arg.slice(14),
				"server port",
			);
		} else if (arg.startsWith("--devtools-port=")) {
			config.devtoolsPort = parsePositiveInteger(
				arg.slice(16),
				"DevTools port",
			);
		} else if (arg.startsWith("--page=")) {
			config.pagePath = arg.slice(7);
		} else if (arg.startsWith("--out=")) {
			config.outputDir = arg.slice(6);
		} else if (arg.startsWith("--chrome=")) {
			config.chromePath = arg.slice(9);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return config;
}

async function canRunCommand(command) {
	try {
		const child = new Deno.Command(command, {
			args: ["--version"],
			stdout: "null",
			stderr: "null",
		}).spawn();
		const status = await child.status;
		return status.success;
	} catch {
		return false;
	}
}

async function resolveChromeCommand(explicitCommand) {
	const candidates = [
		explicitCommand,
		Deno.env.get("CHROME_BIN") || null,
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
		"google-chrome",
		"chromium",
		"chromium-browser",
	].filter(Boolean);

	for (const candidate of candidates) {
		if (await canRunCommand(candidate)) {
			return candidate;
		}
	}

	throw new Error(
		"Could not find a usable Chrome/Chromium binary. Set CHROME_BIN or pass --chrome=/path/to/browser.",
	);
}

async function ensureDirectory(path) {
	await Deno.mkdir(path, { recursive: true });
}

async function safeRemove(path) {
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			await Deno.remove(path, { recursive: true });
			return;
		} catch (error) {
			if (error instanceof Deno.errors.NotFound) {
				return;
			}
			const canRetry = error instanceof Deno.errors.PermissionDenied ||
				error.message.includes("Directory not empty") ||
				error.message.includes("resource busy");
			if (!canRetry || attempt === 4) {
				throw error;
			}
			await sleep(100 * (attempt + 1));
		}
	}
}

function getExtension(path) {
	const lastDot = path.lastIndexOf(".");
	return lastDot === -1 ? "" : path.slice(lastDot);
}

function createStaticHandler(rootUrl) {
	return async (request) => {
		const url = new URL(request.url);
		let pathname = decodeURIComponent(url.pathname);
		if (pathname === "/") {
			pathname = "/index.html";
		}
		if (pathname.includes("..")) {
			return new Response("Forbidden", { status: 403 });
		}

		const fileUrl = new URL(`.${pathname}`, rootUrl);
		let file;
		try {
			file = await Deno.readFile(fileUrl);
		} catch (error) {
			if (error instanceof Deno.errors.NotFound) {
				return new Response("Not Found", { status: 404 });
			}
			throw error;
		}

		const extension = getExtension(pathname);
		const headers = new Headers();
		headers.set("content-type", CONTENT_TYPES[extension] || "application/octet-stream");
		return request.method === "HEAD" ? new Response(null, { headers }) : new Response(file, { headers });
	};
}

async function waitForUrl(url, timeoutMs) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		try {
			const response = await fetch(url, { method: "HEAD" });
			if (response.ok) {
				return;
			}
		} catch {
			// Server not ready yet.
		}
		await sleep(100);
	}
	throw new Error(`Timed out waiting for ${url}`);
}

async function getPageDebuggerUrl(devtoolsPort, expectedPrefix) {
	const response = await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`);
	if (!response.ok) {
		throw new Error(`DevTools list request failed: ${response.status}`);
	}
	const pages = await response.json();
	const page = pages.find((entry) =>
		entry.type === "page" && typeof entry.url === "string" &&
		entry.url.startsWith(expectedPrefix)
	);
	if (!page?.webSocketDebuggerUrl) {
		throw new Error(`No debuggable page found for ${expectedPrefix}`);
	}
	return page.webSocketDebuggerUrl;
}

async function waitForDebuggerUrl(devtoolsPort, expectedPrefix, timeoutMs) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		try {
			return await getPageDebuggerUrl(devtoolsPort, expectedPrefix);
		} catch {
			// Browser may still be booting.
		}
		await sleep(100);
	}
	throw new Error("Timed out waiting for DevTools page target");
}

async function connectToPage(wsUrl) {
	const socket = new WebSocket(wsUrl);
	const openDeferred = createDeferred();
	const pending = new Map();
	const eventWaiters = new Map();
	let nextId = 1;

	socket.onopen = () => openDeferred.resolve();
	socket.onerror = () => openDeferred.reject(new Error("Failed to open DevTools WebSocket"));
	socket.onmessage = (event) => {
		const payload = JSON.parse(event.data);
		if (payload.id && pending.has(payload.id)) {
			const deferred = pending.get(payload.id);
			pending.delete(payload.id);
			if (payload.error) {
				deferred.reject(new Error(JSON.stringify(payload.error)));
			} else {
				deferred.resolve(payload.result);
			}
			return;
		}
		if (payload.method && eventWaiters.has(payload.method)) {
			const waiters = eventWaiters.get(payload.method);
			eventWaiters.delete(payload.method);
			waiters.forEach((deferred) => deferred.resolve(payload.params ?? {}));
		}
	};

	function send(method, params = {}) {
		const id = nextId++;
		socket.send(JSON.stringify({ id, method, params }));
		const deferred = createDeferred();
		pending.set(id, deferred);
		return deferred.promise;
	}

	function waitForEvent(method, timeoutMs) {
		const deferred = createDeferred();
		const waiters = eventWaiters.get(method) ?? [];
		waiters.push(deferred);
		eventWaiters.set(method, waiters);
		const timeoutId = setTimeout(() => {
			const queued = eventWaiters.get(method) ?? [];
			eventWaiters.set(method, queued.filter((entry) => entry !== deferred));
			deferred.reject(new Error(`Timed out waiting for ${method}`));
		}, timeoutMs);
		deferred.promise.finally(() => clearTimeout(timeoutId));
		return deferred.promise;
	}

	async function evaluate(expression) {
		const result = await send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (result.exceptionDetails) {
			throw new Error(JSON.stringify(result.exceptionDetails));
		}
		return result.result?.value;
	}

	async function navigate(url) {
		const loadPromise = waitForEvent("Page.loadEventFired", LOAD_TIMEOUT_MS);
		await send("Page.navigate", { url });
		await loadPromise;
	}

	await openDeferred.promise;
	await send("Page.enable");
	await send("Runtime.enable");

	return {
		socket,
		evaluate,
		navigate,
	};
}

async function waitForPageReady(page) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < PAGE_READY_TIMEOUT_MS) {
		if (await page.evaluate(PAGE_READY_EXPRESSION)) {
			return;
		}
		await sleep(100);
	}
	throw new Error("Timed out waiting for page bootstrap");
}

async function runSingleTournament(
	page,
	config,
	runIndex,
	aggregateMetrics,
	aggregateOutcomeMetrics,
	champions,
) {
	const runLabel = String(runIndex).padStart(2, "0");
	const baseUrl = `http://127.0.0.1:${config.serverPort}/${config.pagePath}`;

	console.log(`run ${runLabel}: navigate`);
	await page.navigate(baseUrl);
	await waitForPageReady(page);
	await page.evaluate(START_CAPTURE_EXPRESSION);

	const startedAt = Date.now();
	let state = null;
	while (Date.now() - startedAt < RUN_TIMEOUT_MS) {
		state = await page.evaluate(RUN_STATE_EXPRESSION);
		if (state.finished) {
			break;
		}
		await sleep(POLL_INTERVAL_MS);
	}
	if (!state?.finished) {
		throw new Error(`Run ${runLabel} timed out`);
	}

	const { payload, outcome: runOutcome } = await waitForSettledRunPayload(page);
	const runMetrics = analyzeRunDecisions(runOutcome.decisions, runOutcome.hands, runOutcome.playerBusts);
	mergeRunMetrics(aggregateMetrics, runMetrics);
	mergeOutcomeMetrics(aggregateOutcomeMetrics, runOutcome.rawMetrics);
	incrementCount(champions, state.champion || "unknown");

	const logPath = `${config.outputDir}/run-${runLabel}.log`;
	const summaryPath = `${config.outputDir}/run-${runLabel}.json`;
	const detailsPath = `${config.outputDir}/run-${runLabel}.details.json`;
	await Deno.writeTextFile(logPath, payload.logs.join("\n"));
	await Deno.writeTextFile(
		summaryPath,
		JSON.stringify(
			{
				run: runIndex,
				champion: state.champion,
				logCount: payload.logs.length,
				players: payload.players,
				metrics: runMetrics,
				analysis: {
					postflop: {
						mdf: createMdfAnalysis(runMetrics.postflop.mdf),
						lineReads: createPostflopLineReadAnalysis(runMetrics.postflop),
					},
				},
				outcomeMetrics: runOutcome.metrics,
			},
			null,
			2,
		),
	);
	await Deno.writeTextFile(
		detailsPath,
		JSON.stringify(
			{
				run: runIndex,
				champion: state.champion,
				logCount: payload.logs.length,
				hands: runOutcome.hands,
				decisions: runOutcome.decisions,
				playerBusts: runOutcome.playerBusts,
				outcomeMetrics: runOutcome.metrics,
			},
			null,
			2,
		),
	);

	console.log(`run ${runLabel}: done champion=${state.champion} logs=${payload.logs.length}`);
	return {
		run: runIndex,
		champion: state.champion,
		logCount: payload.logs.length,
		logPath,
		summaryPath,
		detailsPath,
		metrics: runMetrics,
		outcomeMetrics: runOutcome.metrics,
	};
}

async function main() {
	const args = parseArgs(Deno.args);
	const projectRootUrl = new URL("../", import.meta.url);
	const projectRootPath = Deno.realPathSync(projectRootUrl);
	const outputDir = resolveOutputDir(args.outputDir);
	const chromeCommand = await resolveChromeCommand(args.chromePath);
	const aggregateMetrics = createEmptyMetrics();
	const aggregateOutcomeMetrics = createEmptyOutcomeMetricsAccumulator();
	const champions = {};
	const runSummaries = [];
	const profileDir = `${outputDir}/chrome-profile`;
	const serverAbort = new AbortController();
	let browserChild = null;

	await ensureDirectory(outputDir);
	await ensureDirectory(profileDir);

	try {
		const server = Deno.serve({
			hostname: "127.0.0.1",
			port: args.serverPort,
			signal: serverAbort.signal,
		}, createStaticHandler(projectRootUrl));

		await waitForUrl(`http://127.0.0.1:${args.serverPort}/index.html`, LOAD_TIMEOUT_MS);

		browserChild = new Deno.Command(chromeCommand, {
			args: [
				"--headless=new",
				`--remote-debugging-port=${args.devtoolsPort}`,
				`--user-data-dir=${profileDir}`,
				"--no-first-run",
				"--no-default-browser-check",
				`http://127.0.0.1:${args.serverPort}/${args.pagePath}`,
			],
			stdout: "null",
			stderr: "null",
		}).spawn();

		const debuggerUrl = await waitForDebuggerUrl(
			args.devtoolsPort,
			`http://127.0.0.1:${args.serverPort}/`,
			LOAD_TIMEOUT_MS,
		);
		const page = await connectToPage(debuggerUrl);

		for (let runIndex = 1; runIndex <= args.runCount; runIndex++) {
			const runSummary = await runSingleTournament(
				page,
				{
					serverPort: args.serverPort,
					pagePath: args.pagePath,
					outputDir,
				},
				runIndex,
				aggregateMetrics,
				aggregateOutcomeMetrics,
				champions,
			);
			runSummaries.push(runSummary);
		}

		page.socket.close();
		serverAbort.abort();
		await server.finished.catch(() => {});
		browserChild.kill("SIGTERM");
		await browserChild.status.catch(() => {});
		browserChild = null;

		const mdfAnalysis = createMdfAnalysis(aggregateMetrics.postflop.mdf);
		const lineReadAnalysis = createPostflopLineReadAnalysis(aggregateMetrics.postflop);
		const summary = {
			generatedAt: new Date().toISOString(),
			config: {
				runCount: args.runCount,
				serverPort: args.serverPort,
				devtoolsPort: args.devtoolsPort,
				pagePath: args.pagePath,
				chromeCommand,
				outputDir,
				projectRootPath,
				analysisThresholds: {
					reraiseLowEdge: RERAISE_LOW_EDGE_THRESHOLD,
				},
			},
			champions,
			runs: runSummaries.map((runSummary) => ({
				run: runSummary.run,
				champion: runSummary.champion,
				logCount: runSummary.logCount,
				logPath: runSummary.logPath,
				summaryPath: runSummary.summaryPath,
				detailsPath: runSummary.detailsPath,
			})),
			metrics: aggregateMetrics,
			analysis: {
				postflop: {
					mdf: mdfAnalysis,
					lineReads: lineReadAnalysis,
				},
			},
			outcomeMetrics: finalizeOutcomeMetrics(aggregateOutcomeMetrics),
		};
		await Deno.writeTextFile(`${outputDir}/summary.json`, JSON.stringify(summary, null, 2));

		console.log(`runs=${args.runCount}`);
		console.log(`decisions=${aggregateMetrics.decisionCount}`);
		console.log(
			`decision_join_coverage=${summary.outcomeMetrics.decisionJoinCoverage.joinedDecisions}/${summary.outcomeMetrics.decisionJoinCoverage.totalDecisions}`,
		);
		console.log(`preflop_spots=${aggregateMetrics.preflop.decisions}`);
		console.log(`postflop_spots=${aggregateMetrics.postflopSpots}`);
		console.log(`postflop_made_hand_folds=${aggregateMetrics.postflop.madeHandFoldCount}`);
		console.log(
			`postflop_public_made_hand_folds=${aggregateMetrics.postflop.publicMadeHandFoldCount}`,
		);
		console.log(
			`postflop_board_made_lift_folds=${aggregateMetrics.postflop.boardMadeLiftFoldCount}`,
		);
		console.log(
			`postflop_private_made_hand_folds=${aggregateMetrics.postflop.privateMadeHandFoldCount}`,
		);
		console.log(
			`postflop_private_made_hand_folds_dead_or_near_dead=${aggregateMetrics.postflop.privateMadeHandFoldDeadOrNearDeadCount}`,
		);
		console.log(
			`postflop_private_made_hand_folds_live=${aggregateMetrics.postflop.privateMadeHandFoldLiveCount}`,
		);
		console.log(
			`postflop_private_top_tier_made_hand_folds=${aggregateMetrics.postflop.privateTopTierMadeHandFoldCount}`,
		);
		console.log(`postflop_reraises=${aggregateMetrics.postflop.reraises.totalCount}`);
		console.log(
			`postflop_reraises_edge_lt_${
				RERAISE_LOW_EDGE_THRESHOLD.toFixed(1)
			}=${aggregateMetrics.postflop.reraises.lowEdgeCount}`,
		);
		console.log(
			`postflop_reraises_active_players_4_plus=${aggregateMetrics.postflop.reraises.activePlayers4PlusCount}`,
		);
		console.log(
			`postflop_reraises_active_players_5_plus=${aggregateMetrics.postflop.reraises.activePlayers5PlusCount}`,
		);
		console.log(
			`postflop_reraises_flop_multiway=${aggregateMetrics.postflop.reraises.flopMultiwayCount}`,
		);
		console.log(
			`postflop_reraises_allin_below_trips=${aggregateMetrics.postflop.reraises.allInBelowTripsCount}`,
		);
		console.log(
			`postflop_reraises_allin_below_trips_explainable=${aggregateMetrics.postflop.reraises.allInBelowTripsExplainableCount}`,
		);
		console.log(
			`postflop_reraises_allin_edge_lt_${
				RERAISE_LOW_EDGE_THRESHOLD.toFixed(1)
			}=${aggregateMetrics.postflop.reraises.allInLowEdgeCount}`,
		);
		console.log(
			`postflop_high_risk_private_made_hand_folds=${aggregateMetrics.postflop.highRiskPrivateMadeHandFoldCount}`,
		);
		console.log(
			`postflop_high_risk_private_made_hand_folds_dead_or_near_dead=${aggregateMetrics.postflop.highRiskPrivateMadeHandFoldDeadOrNearDeadCount}`,
		);
		console.log(
			`postflop_high_risk_private_made_hand_folds_live=${aggregateMetrics.postflop.highRiskPrivateMadeHandFoldLiveCount}`,
		);
		console.log(`preflop_premium_folds=${aggregateMetrics.preflop.premiumFoldCount}`);
		console.log(`preflop_unopened_calls=${aggregateMetrics.preflop.unopenedCallCount}`);
		console.log(
			`preflop_fixed_size_offbucket=${aggregateMetrics.preflop.fixedSizeOffBucketCount}`,
		);
		console.log(
			`sb_hu_open_uncontested=${aggregateMetrics.preflop.transitions.sbHuOpen.uncontested}/${aggregateMetrics.preflop.transitions.sbHuOpen.attempts}`,
		);
		console.log(
			`bb_defend_vs_sb_hu_open=${aggregateMetrics.preflop.transitions.sbHuOpen.bbDefend}/${aggregateMetrics.preflop.transitions.sbHuOpen.attempts}`,
		);
		console.log(
			`flop_seen_after_sb_hu_open=${aggregateMetrics.preflop.transitions.sbHuOpen.flopSeen}/${aggregateMetrics.preflop.transitions.sbHuOpen.attempts}`,
		);
		console.log(
			`btn_3_open_uncontested=${aggregateMetrics.preflop.transitions.btn3Open.blindsFoldedThrough}/${aggregateMetrics.preflop.transitions.btn3Open.attempts}`,
		);
		console.log(
			`blinds_defend_vs_btn_3_open=${aggregateMetrics.preflop.transitions.btn3Open.blindsDefend}/${aggregateMetrics.preflop.transitions.btn3Open.attempts}`,
		);
		console.log(
			`flop_seen_after_btn_3_open=${aggregateMetrics.preflop.transitions.btn3Open.flopSeen}/${aggregateMetrics.preflop.transitions.btn3Open.attempts}`,
		);
		console.log(
			`bb_raise_vs_sb_hu_limp=${aggregateMetrics.preflop.transitions.sbHuLimp.bigBlindRaise}/${aggregateMetrics.preflop.transitions.sbHuLimp.attempts}`,
		);
		console.log(
			`flop_seen_after_sb_hu_limp=${aggregateMetrics.preflop.transitions.sbHuLimp.flopSeen}/${aggregateMetrics.preflop.transitions.sbHuLimp.attempts}`,
		);
		console.log(
			`blind_raise_vs_btn_3_limp=${aggregateMetrics.preflop.transitions.btn3Limp.blindRaise}/${aggregateMetrics.preflop.transitions.btn3Limp.attempts}`,
		);
		console.log(
			`flop_seen_after_btn_3_limp=${aggregateMetrics.preflop.transitions.btn3Limp.flopSeen}/${aggregateMetrics.preflop.transitions.btn3Limp.attempts}`,
		);
		console.log(
			`bluff_raises_with_made_hand=${aggregateMetrics.postflop.bluffRaiseClassCounts["made-hand"] || 0}`,
		);
		console.log(
			`postflop_no_bet_opportunities=${aggregateMetrics.postflop.noBetOpportunityCount}`,
		);
		console.log(
			`postflop_no_bet_raises=${aggregateMetrics.postflop.noBetOpportunityActions.raise || 0}`,
		);
		console.log(
			`postflop_no_bet_by_passive_line_depth=${JSON.stringify(lineReadAnalysis.noBetByPassiveLineDepth)}`,
		);
		console.log(
			`postflop_no_bet_double_checked_through=${JSON.stringify(lineReadAnalysis.noBetByDoubleCheckedThrough)}`,
		);
		console.log(
			`postflop_river_hu_oop_double_checked_through_checks=${
				JSON.stringify(lineReadAnalysis.riverHuOopDoubleCheckedThroughChecks)
			}`,
		);
		console.log(
			`postflop_blocked_no_bet_raises=${aggregateMetrics.postflop.blockedNoBetRaiseCount}`,
		);
		console.log(
			`postflop_blocked_no_bet_later_facing_bet=${aggregateMetrics.postflop.blockedNoBetRaiseLaterFacingBetCount}`,
		);
		console.log(
			`postflop_blocked_no_bet_later_facing_bet_folds=${
				aggregateMetrics.postflop.blockedNoBetRaiseLaterFacingBetActions.fold || 0
			}`,
		);
		console.log(
			`postflop_blocked_no_bet_later_facing_bet_calls=${
				aggregateMetrics.postflop.blockedNoBetRaiseLaterFacingBetActions.call || 0
			}`,
		);
		console.log(
			`postflop_blocked_no_bet_later_facing_bet_raises=${
				aggregateMetrics.postflop.blockedNoBetRaiseLaterFacingBetActions.raise || 0
			}`,
		);
		console.log(
			`postflop_blocked_no_bet_without_later_facing_bet=${aggregateMetrics.postflop.blockedNoBetRaiseWithoutLaterFacingBetCount}`,
		);
		console.log(
			`postflop_auto_value_checks=${aggregateMetrics.postflop.autoValueCheckCount}`,
		);
		console.log(
			`postflop_auto_value_checks_later_facing_bet=${aggregateMetrics.postflop.autoValueCheckLaterFacingBetCount}`,
		);
		console.log(
			`postflop_auto_value_checks_later_facing_bet_folds=${aggregateMetrics.postflop.autoValueCheckLaterFacingBetFolds}`,
		);
		console.log(
			`postflop_elim_relief_candidates=${aggregateMetrics.postflop.eliminationReliefCandidateCount}`,
		);
		console.log(
			`postflop_elim_relief_calls=${aggregateMetrics.postflop.eliminationReliefCallCount}`,
		);
		console.log(
			`postflop_normal_bet_offbucket=${aggregateMetrics.postflop.normalBetOffBucketCount}`,
		);
		console.log(
			`postflop_weak_no_bet_opportunities=${aggregateMetrics.postflop.weakNoBetOpportunityCount}`,
		);
		console.log(
			`postflop_weak_no_bet_raises=${aggregateMetrics.postflop.weakNoBetOpportunityActions.raise || 0}`,
		);
		console.log(
			`marginal_actions=${JSON.stringify(aggregateMetrics.postflop.marginalActions)}`,
		);
		console.log(`marginal_raises=${aggregateMetrics.postflop.marginalRaiseCount}`);
		console.log(
			`marginal_river_calls=${aggregateMetrics.postflop.marginalRiverCallCount}`,
		);
		console.log(
			`marginal_facing_raise_calls=${aggregateMetrics.postflop.marginalFacingRaiseCallCount}`,
		);
		console.log(
			`postflop_call_quality_concerns=${JSON.stringify(aggregateMetrics.postflop.callQualityConcernByTag)}`,
		);
		console.log(
			`postflop_fold_quality=${JSON.stringify(aggregateMetrics.postflop.foldQualityByTag)}`,
		);
		console.log(
			`postflop_fold_watch=${JSON.stringify(aggregateMetrics.postflop.foldWatchByTag)}`,
		);
		console.log(
			`mdf_override_after_river_low_edge_block=${aggregateMetrics.postflop.mdf.overrideCallAfterRiverLowEdgeBlockCount}`,
		);
		console.log(
			`mdf_override_after_marginal_defense_block=${aggregateMetrics.postflop.mdf.overrideCallAfterMarginalDefenseBlockCount}`,
		);
		console.log(
			`mdf_override_after_non_value_block=${aggregateMetrics.postflop.mdf.overrideCallAfterNonValueBlockCount}`,
		);
		console.log(`kicker_raises=${aggregateMetrics.kickerRaiseCount}`);
		console.log(`meaningful_raises=${aggregateMetrics.meaningfulRaiseCount}`);
		console.log(
			`public_made_non_structural_raises=${aggregateMetrics.publicMadeNonStructuralRaiseCount}`,
		);
		console.log(
			`mdf_overall_actual_vs_alpha=${mdfAnalysis.facingBetOverall.actualFoldRate.toFixed(3)}/${
				mdfAnalysis.facingBetOverall.requiredFoldRate.toFixed(3)
			} over=${mdfAnalysis.facingBetOverall.overfold.toFixed(3)}`,
		);
		console.log(
			`mdf_overall_candidates=${mdfAnalysis.candidateOverall.total} defends=${mdfAnalysis.candidateOverall.defends} actual_vs_alpha=${
				mdfAnalysis.candidateOverall.actualFoldRate.toFixed(3)
			}/${mdfAnalysis.candidateOverall.requiredFoldRate.toFixed(3)} over=${
				mdfAnalysis.candidateOverall.overfold.toFixed(3)
			}`,
		);
		for (const street of ["flop", "turn", "river"]) {
			const facingBetRow = aggregateMetrics.postflop.mdf.facingBetByStreet[street];
			const facingBetSummary = summarizeFoldRateRow(facingBetRow);
			console.log(
				`mdf_${street}_actual_vs_alpha=${facingBetSummary.actualFoldRate.toFixed(3)}/${
					facingBetSummary.requiredFoldRate.toFixed(3)
				} over=${facingBetSummary.overfold.toFixed(3)}`,
			);

			const candidateRow = aggregateMetrics.postflop.mdf.candidateByStreet[street];
			const candidateSummary = summarizeFoldRateRow(candidateRow);
			console.log(
				`mdf_${street}_candidates=${candidateRow?.total || 0} defends=${
					candidateRow?.defends || 0
				} actual_vs_alpha=${candidateSummary.actualFoldRate.toFixed(3)}/${
					candidateSummary.requiredFoldRate.toFixed(3)
				} over=${candidateSummary.overfold.toFixed(3)}`,
			);
			console.log(
				`mdf_${street}_facing_by_margin=${
					JSON.stringify(mdfAnalysis.facingBetByStreetAndMargin[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_facing_by_betsize=${
					JSON.stringify(mdfAnalysis.facingBetByStreetAndBetSize[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_facing_by_margin_and_betsize=${
					JSON.stringify(mdfAnalysis.facingBetByStreetAndMarginAndBetSize[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_facing_actions_by_betsize_and_reason=${
					JSON.stringify(mdfAnalysis.facingBetActionsByStreetAndBetSizeAndQualityReason[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_facing_actions_by_margin_betsize_reason=${
					JSON.stringify(
						mdfAnalysis.facingBetActionsByStreetAndMarginAndBetSizeAndQualityReason[street] || {},
					)
				}`,
			);
			console.log(
				`mdf_${street}_candidates_by_margin=${
					JSON.stringify(mdfAnalysis.candidateByStreetAndMargin[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_candidates_by_margin_and_betsize=${
					JSON.stringify(mdfAnalysis.candidateByStreetAndMarginAndBetSize[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_candidates_by_raise_level=${
					JSON.stringify(mdfAnalysis.candidateByStreetAndRaiseLevel[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_candidates_by_structure=${
					JSON.stringify(mdfAnalysis.candidateByStreetAndStructure[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_candidates_by_pressure=${
					JSON.stringify(mdfAnalysis.candidateByStreetAndPressure[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_candidates_by_lift=${
					JSON.stringify(mdfAnalysis.candidateByStreetAndLift[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_candidates_by_raw_hand=${
					JSON.stringify(mdfAnalysis.candidateByStreetAndRawHand[street] || {})
				}`,
			);
			console.log(
				`mdf_${street}_overrides_by_margin=${
					JSON.stringify(mdfAnalysis.overrideCallByStreetAndMargin[street] || {})
				}`,
			);
		}
		console.log(`mdf_override_calls=${aggregateMetrics.postflop.mdf.overrideCallCount}`);
		console.log(`output_dir=${outputDir}`);
	} finally {
		serverAbort.abort();
		if (browserChild) {
			try {
				browserChild.kill("SIGTERM");
			} catch {
				// Browser already exited.
			}
			await browserChild.status.catch(() => {});
		}
		await safeRemove(profileDir);
	}
}

await main();
