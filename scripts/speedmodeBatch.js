const DEFAULT_RUN_COUNT = 1;
const DEFAULT_SERVER_PORT = 8123;
const DEFAULT_DEVTOOLS_PORT = 9222;
const DEFAULT_PAGE_PATH = "index.html?speedmode=1&botdebug=detail";
const DEFAULT_OUTPUT_BASE = "/tmp";
const DEFAULT_OUTPUT_PREFIX = "poker-speedmode-batch";
const LOAD_TIMEOUT_MS = 15000;
const RUN_TIMEOUT_MS = 180000;
const PAGE_READY_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 500;
const HAND_LABEL_PATTERN =
	"Straight Flush|Four of a Kind|Full House|Three of a Kind|Two Pair|High Card|Straight|Flush|Pair|-";
const PUBLIC_HAND_REGEX = new RegExp(`\\bPH:(${HAND_LABEL_PATTERN})\\b`);
const PUBLIC_MADE_HANDS = new Set([
	"Pair",
	"Two Pair",
	"Three of a Kind",
	"Straight",
	"Flush",
	"Full House",
	"Four of a Kind",
	"Straight Flush",
]);
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
const PAGE_READY_EXPRESSION =
	`(() => !!window.poker && !!document.getElementById("start-button"))()`;
const RUN_STATE_EXPRESSION = `(() => {
	const players = window.poker?.players ?? [];
	const livePlayers = players.filter((player) => player.chips > 0);
	return {
		finished: !!window.__speedmodeBatchStarted && players.length > 0 && livePlayers.length <= 1,
		activePlayers: livePlayers.length,
		champion: livePlayers.length === 1 ? livePlayers[0].name : null,
		logCount: window.__capturedLogs?.length ?? 0,
		maxHands: players.reduce((value, player) => Math.max(value, player.stats?.hands ?? 0), 0),
	};
})()`;
const RUN_PAYLOAD_EXPRESSION = `(() => {
	const players = window.poker?.players ?? [];
	const livePlayers = players.filter((player) => player.chips > 0);
	return {
		finished: !!window.__speedmodeBatchStarted && players.length > 0 && livePlayers.length <= 1,
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

function incrementCount(target, key, amount = 1) {
	target[key] = (target[key] || 0) + amount;
}

function incrementNestedCount(target, outerKey, innerKey, amount = 1) {
	if (!target[outerKey]) {
		target[outerKey] = {};
	}
	target[outerKey][innerKey] = (target[outerKey][innerKey] || 0) + amount;
}

function deepMergeCounts(target, source) {
	for (const [key, value] of Object.entries(source)) {
		if (value && typeof value === "object" && !Array.isArray(value)) {
			if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) {
				target[key] = {};
			}
			deepMergeCounts(target[key], value);
		} else {
			target[key] = (target[key] || 0) + value;
		}
	}
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
	if (!outputDir) {
		return `${DEFAULT_OUTPUT_BASE}/${DEFAULT_OUTPUT_PREFIX}-${formatTimestamp()}`;
	}

	const normalizedOutputDir = outputDir.replace(/\/+$/, "");
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
		return request.method === "HEAD"
			? new Response(null, { headers })
			: new Response(file, { headers });
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

function createEmptyMetrics() {
	return {
		postflopSpots: 0,
		kickerRaiseCount: 0,
		publicMadeKickerRaiseCount: 0,
		liftCounts: {},
		publicHandCounts: {},
		actionByLift: {},
		publicHandActions: {},
		pairKickerActions: {},
		kickerRaiseExamples: [],
		structuralExamples: [],
	};
}

function analyzeRunLogs(logs) {
	const metrics = createEmptyMetrics();

	for (const line of logs) {
		const actionMatch = line.match(/→ (check|call|fold|raise)\b/);
		const liftMatch = line.match(/\bLT:(none|kicker|structural|category)\b/);
		const publicMatch = line.match(PUBLIC_HAND_REGEX);
		if (!actionMatch || !liftMatch || !publicMatch) {
			continue;
		}

		const action = actionMatch[1];
		const liftType = liftMatch[1];
		const publicHand = publicMatch[1];
		if (publicHand === "-") {
			continue;
		}

		metrics.postflopSpots += 1;
		incrementCount(metrics.liftCounts, liftType);
		incrementCount(metrics.publicHandCounts, publicHand);
		incrementNestedCount(metrics.actionByLift, liftType, action);
		incrementNestedCount(metrics.publicHandActions, publicHand, action);

		if (liftType === "kicker" && publicHand === "Pair") {
			incrementCount(metrics.pairKickerActions, action);
		}
		if (action === "raise" && liftType === "kicker") {
			metrics.kickerRaiseCount += 1;
			if (metrics.kickerRaiseExamples.length < 10) {
				metrics.kickerRaiseExamples.push(line);
			}
		}
		if (
			action === "raise" &&
			(liftType === "none" || liftType === "kicker") &&
			PUBLIC_MADE_HANDS.has(publicHand)
		) {
			metrics.publicMadeKickerRaiseCount += 1;
		}
		if (liftType === "structural" && metrics.structuralExamples.length < 10) {
			metrics.structuralExamples.push(line);
		}
	}

	return metrics;
}

function mergeRunMetrics(target, source) {
	target.postflopSpots += source.postflopSpots;
	target.kickerRaiseCount += source.kickerRaiseCount;
	target.publicMadeKickerRaiseCount += source.publicMadeKickerRaiseCount;
	deepMergeCounts(target.liftCounts, source.liftCounts);
	deepMergeCounts(target.publicHandCounts, source.publicHandCounts);
	deepMergeCounts(target.actionByLift, source.actionByLift);
	deepMergeCounts(target.publicHandActions, source.publicHandActions);
	deepMergeCounts(target.pairKickerActions, source.pairKickerActions);
	target.kickerRaiseExamples.push(...source.kickerRaiseExamples);
	target.structuralExamples.push(...source.structuralExamples);
}

async function runSingleTournament(page, config, runIndex, aggregateMetrics, champions) {
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

	const payload = await page.evaluate(RUN_PAYLOAD_EXPRESSION);
	const runMetrics = analyzeRunLogs(payload.logs);
	mergeRunMetrics(aggregateMetrics, runMetrics);
	incrementCount(champions, state.champion || "unknown");

	const logPath = `${config.outputDir}/run-${runLabel}.log`;
	const summaryPath = `${config.outputDir}/run-${runLabel}.json`;
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
		metrics: runMetrics,
	};
}

async function main() {
	const args = parseArgs(Deno.args);
	const projectRootUrl = new URL("../", import.meta.url);
	const projectRootPath = Deno.realPathSync(projectRootUrl);
	const outputDir = resolveOutputDir(args.outputDir);
	const chromeCommand = await resolveChromeCommand(args.chromePath);
	const aggregateMetrics = createEmptyMetrics();
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
			},
			champions,
			runs: runSummaries.map((runSummary) => ({
				run: runSummary.run,
				champion: runSummary.champion,
				logCount: runSummary.logCount,
				logPath: runSummary.logPath,
				summaryPath: runSummary.summaryPath,
			})),
			metrics: aggregateMetrics,
		};
		await Deno.writeTextFile(`${outputDir}/summary.json`, JSON.stringify(summary, null, 2));

		console.log(`runs=${args.runCount}`);
		console.log(`postflop_spots=${aggregateMetrics.postflopSpots}`);
		console.log(`kicker_raises=${aggregateMetrics.kickerRaiseCount}`);
		console.log(`public_made_kicker_raises=${aggregateMetrics.publicMadeKickerRaiseCount}`);
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
