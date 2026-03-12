/* --------------------------------------------------------------------------------------------------
 * Service Worker registration and cleanup
 -------------------------------------------------------------------------------------------------- */

/* --------------------------------------------------------------------------------------------------
 * Project detection
 * - GitHub Pages: user.github.io/projektname/... -> slug = "projectname", scope = /projectname/
 * - Everything else (localhost, custom domain): whole origin is one project
 -------------------------------------------------------------------------------------------------- */
function getProjectInfo() {
	const url = new URL(globalThis.location.href);
	const pathParts = url.pathname.split("/").filter(Boolean);
	const hostname = url.hostname;
	const isGitHubPages = hostname.endsWith("github.io");

	let projectScope;
	let projectSlug;

	if (isGitHubPages && pathParts.length > 0) {
		const first = pathParts[0].toLowerCase();
		projectScope = `${url.origin}/${first}/`;
		projectSlug = first;
	} else {
		projectScope = `${url.origin}/`;
		projectSlug = hostname.replace(/[^\w-]/g, "_").toLowerCase();
	}

	const isGitHubUserRoot = isGitHubPages && pathParts.length === 0;

	return { projectScope, projectSlug, isGitHubUserRoot };
}

async function shouldSkipServiceWorker(swUrl) {
	try {
		const response = await fetch(swUrl, {
			method: "HEAD",
			cache: "no-store",
		});

		if (response.redirected) {
			console.log(
				`Service Worker skipped: ${swUrl} redirects to ${response.url}. Use the canonical host for PWA features.`,
			);
			return true;
		}

		if (!response.ok) {
			console.log(
				`Service Worker skipped: ${swUrl} returned status ${response.status}.`,
			);
			return true;
		}
	} catch (error) {
		console.log("Service Worker preflight check failed, trying to register anyway:", error);
	}

	return false;
}

async function registerServiceWorker(projectSlug, serviceWorkerVersion) {
	try {
		const swUrl = `./service-worker.js?v=${serviceWorkerVersion}`;

		if (await shouldSkipServiceWorker(swUrl)) {
			return;
		}

		const registration = await navigator.serviceWorker.register(
			swUrl,
			{ scope: "./", updateViaCache: "none" },
		);

		registration.update();

		console.log(
			`Service Worker registered for project "${projectSlug}" with scope:`,
			registration.scope,
		);
	} catch (error) {
		console.log("Service Worker registration failed:", error);
	}
}

async function unregisterServiceWorkers(projectScope, projectSlug, swCachePrefix) {
	const registrations = await navigator.serviceWorker.getRegistrations();
	let changedSomething = false;

	if (registrations.length) {
		// Only unregister SWs whose scope belongs to this project.
		const projectRegistrations = registrations.filter(
			(registration) =>
				registration.scope === projectScope || registration.scope.startsWith(projectScope),
		);

		if (projectRegistrations.length) {
			await Promise.all(
				projectRegistrations.map((registration) => registration.unregister()),
			);
			changedSomething = true;
		}
	}

	if ("caches" in globalThis) {
		const keys = await caches.keys();

		// Remove only Service Worker caches for this project:
		// - SW caches start with "<slug>-cache-"
		// - Data / app caches can use "<slug>-data-cache" and are not touched here
		const swCaches = keys.filter(
			(key) => key.startsWith(swCachePrefix) && !key.includes("-data-cache"),
		);

		if (swCaches.length) {
			await Promise.all(swCaches.map((key) => caches.delete(key)));
			changedSomething = true;
		}
	}

	if (changedSomething) {
		console.log(
			`Service workers and SW caches for project "${projectSlug}" cleared. Reloading page...`,
		);
		globalThis.location.reload();
	} else {
		console.log(
			`No service worker or SW caches found for project "${projectSlug}". Not reloading again.`,
		);
	}
}

export function initServiceWorker({
	useServiceWorker,
	serviceWorkerVersion,
	autoReloadOnUpdate,
}) {
	if (!("serviceWorker" in navigator)) {
		return;
	}

	const {
		projectScope,
		projectSlug,
		isGitHubUserRoot,
	} = getProjectInfo();
	const swCachePrefix = `${projectSlug}-cache-`;
	const hadControllerAtStart = !!navigator.serviceWorker.controller;
	let hasHandledControllerChange = false;

	navigator.serviceWorker.addEventListener("controllerchange", () => {
		if (!hadControllerAtStart) {
			return;
		}
		if (hasHandledControllerChange) {
			return;
		}

		hasHandledControllerChange = true;

		if (autoReloadOnUpdate) {
			globalThis.location.reload();
		} else {
			console.log("Service Worker updated; auto reload disabled.");
		}
	});

	globalThis.addEventListener("DOMContentLoaded", async () => {
		// Hard safety: never use a service worker on GitHub user root pages.
		if (isGitHubUserRoot) {
			console.log(
				"Service Worker disabled on GitHub user root page to avoid affecting project sites.",
			);
			return;
		}

		if (useServiceWorker) {
			await registerServiceWorker(projectSlug, serviceWorkerVersion);
		} else {
			await unregisterServiceWorkers(projectScope, projectSlug, swCachePrefix);
		}
	});
}
