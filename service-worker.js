const CACHE_NAME = "--poker-cache-v20"; // Name of the dynamic cache

// Build list of all card SVGs according to their actual filenames, e.g. "AS.svg", "TD.svg".
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

// Install event – precache core assets so that everything required for a round of poker
// is already available before the player goes offline.
self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)),
	);
	self.skipWaiting(); // activate immediately
});

// Fetch event
self.addEventListener("fetch", (event) => {
	// Ignore everything that's not a simple GET (POST, WebSocket, etc.)
	if (event.request.method !== "GET") {
		return; // do not intercept non‑GET requests
	}

	const url = new URL(event.request.url);

	// Requests for hole-cards.html are network-only to avoid unnecessary caching
	if (url.pathname.endsWith("hole-cards.html")) {
		return; // let the browser handle it normally
	}

	// Respond with cache-first strategy and stale-while-revalidate
	event.respondWith(
		caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
			if (cachedResponse) {
				// Return cached response immediately and update in the background
				event.waitUntil(
					fetch(event.request)
						.then((networkResponse) =>
							caches.open(CACHE_NAME).then((cache) => {
								cache.put(event.request, networkResponse.clone());
							})
						)
						// If we're offline or the update fails, swallow the error so we don't get
						// an unhandled promise rejection in the console.
						.catch(() => {}),
				);
				return cachedResponse; // Return stale (cached) response
			} else {
				// If not in cache, fetch from network and cache dynamically
				return fetch(event.request).then((networkResponse) => {
					return caches.open(CACHE_NAME).then((cache) => {
						// Cache the new network response dynamically
						cache.put(event.request, networkResponse.clone());
						return networkResponse; // Return the fresh network response
					});
				})
					.catch(() => {
						// Offline fallback: try cache again; if nothing found and it's a navigation request,
						// return the cached index.html so the SPA can render.
						return caches.match(event.request, { ignoreSearch: true }).then(
							(resp) => {
								if (resp) return resp;
								if (event.request.mode === "navigate") {
									return caches.match("./");
								}
								// As a last resort, give an empty 503 response to silence uncaught promise rejections
								return new Response("", { status: 503, statusText: "Offline" });
							},
						);
					});
			}
		}),
	);
});

// Activate event to clear old caches
self.addEventListener("activate", (event) => {
	const cacheWhitelist = [CACHE_NAME]; // Only keep the current cache
	event.waitUntil(
		(async () => {
			const cacheNames = await caches.keys();
			await Promise.all(
				cacheNames.map((cacheName) => {
					if (!cacheWhitelist.includes(cacheName)) {
						// Delete old caches
						return caches.delete(cacheName);
					}
				}),
			);
		})(),
	);
	self.clients.claim(); // Ensure service worker takes control of the page immediately
});
