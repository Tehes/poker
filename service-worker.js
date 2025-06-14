const CACHE_NAME = "--poker-cache-v1"; // Name of the dynamic cache

// Install event
self.addEventListener("install", () => {
	// Skip waiting to activate the service worker immediately
	self.skipWaiting();
});

// Fetch event
self.addEventListener("fetch", (event) => {
	// Only handle GET requests
	if (event.request.method === "GET") {
		// Respond with cache-first strategy and stale-while-revalidate
		event.respondWith(
			caches.match(event.request).then((cachedResponse) => {
				if (cachedResponse) {
					// Return cached response immediately and update in the background
					event.waitUntil(
						fetch(event.request).then((networkResponse) => {
							// Open the cache and update the requested resource
							caches.open(CACHE_NAME).then((cache) => {
								cache.put(event.request, networkResponse.clone());
							});
						}),
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
					}).catch(() => {
						// Optionally handle offline scenario for dynamic requests
					});
				}
			}),
		);
	} else {
		// For non-GET requests, just fetch from the network
		event.respondWith(fetch(event.request));
	}
});

// Activate event to clear old caches
self.addEventListener("activate", (event) => {
	const cacheWhitelist = [CACHE_NAME]; // Only keep the current cache
	event.waitUntil(
		caches.keys().then((cacheNames) => {
			return Promise.all(
				cacheNames.map((cacheName) => {
					if (!cacheWhitelist.includes(cacheName)) {
						// Delete old caches
						return caches.delete(cacheName);
					}
				}),
			);
		}),
	);
	self.clients.claim(); // Ensure service worker takes control of the page immediately
});
