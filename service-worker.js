/* --------------------------------------------------------------------------------------------------
 * Generic Service Worker template
 * - Per project cache namespace based on PROJECT_SLUG
 * - Cleans up only this project's SW caches
 -------------------------------------------------------------------------------------------------- */

/**
 * slug must follow the exact same logic used on the client:
 * - GitHub Pages (user.github.io/project/...) -> slug = the first path segment (the project folder name)
 * - All other hosts (localhost, custom domains, etc.): slug = hostname
 */
function getProjectSlugFromSW() {
	const scopeUrl = new URL(self.registration.scope);
	const hostname = scopeUrl.hostname;
	const pathParts = scopeUrl.pathname.split("/").filter(Boolean);

	const isGitHubPages = hostname.endsWith("github.io");

	if (isGitHubPages && pathParts.length > 0) {
		return pathParts[0].toLowerCase();
	}

	return hostname.replace(/[^\w-]/g, "_").toLowerCase();
}

const PROJECT_SLUG = getProjectSlugFromSW();
const VERSION = new URL(self.location).searchParams.get("v") || "default";
const CACHE_PREFIX = `${PROJECT_SLUG}-cache-`;
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;

// Define allowed origins for caching
const ALLOWED_ORIGINS = new Set([
	self.location.origin,
	"https://fonts.googleapis.com",
	"https://fonts.gstatic.com",
	// add more if needed
]);

const SUITS = ["C", "D", "H", "S"];
const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];

const CORE_ASSETS = [
	"./", // resolves to index.html
	"./index.html",
	"./js/app.js",
	"./js/kjua.min.js",
	"./css/style.css",
	"./cards/1B.svg",
	"./icons/rotate.svg",
	"./icons/dealer.svg",
	"./icons/small-blind.svg",
	"./icons/big-blind.svg",
	"./icons/close.svg",
	"./icons/180x180.png",
	"./icons/favicon.png",
	"./icons/poker-chip.svg",
	"./manifest.json",
	"./js/bot.js",
	"./js/pokersolver.js",
	...SUITS.flatMap((suit) => RANKS.map((rank) => `./cards/${rank}${suit}.svg`)),
];

self.addEventListener("install", (event) => {
	self.skipWaiting();
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)),
	);
});

self.addEventListener("message", (event) => {
	if (event?.data?.type === "SKIP_WAITING") {
		self.skipWaiting();
	}
});

// Example: cache-first / stale-while-revalidate for GET requests
self.addEventListener("fetch", (event) => {
	if (event.request.method !== "GET") return;

	const requestUrl = new URL(event.request.url);

	if (!ALLOWED_ORIGINS.has(requestUrl.origin)) {
		return;
	}

	event.respondWith(
		caches.open(CACHE_NAME).then(async (cache) => {
			const cached = await cache.match(event.request);

			const fetchPromise = fetch(event.request)
				.then((networkResponse) => {
					if (!networkResponse) {
						return networkResponse;
					}

					const isOk = networkResponse.ok;
					const isOpaque = networkResponse.type === "opaque";

					// Cache normal 200 OK responses and opaque cross origin responses (e.g. Google Fonts)
					if (isOk || isOpaque) {
						cache.put(event.request, networkResponse.clone());
					}

					return networkResponse;
				})
				.catch(() => cached || Promise.reject());

			return cached || fetchPromise;
		}),
	);
});

// Clean up old caches for this project only
self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((names) =>
				Promise.all(
					names
						.filter((name) => {
							// only caches of this project
							if (!name.startsWith(CACHE_PREFIX)) return false;
							// keep current cache
							if (name === CACHE_NAME) return false;
							// never touch data caches like "<slug>-data-cache"
							if (name.includes("-data-cache")) return false;
							return true;
						})
						.map((name) => caches.delete(name)),
				)
			),
	);
	self.clients.claim();
});
