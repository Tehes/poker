export const APP_VERSION = "1.0.2";

export const VERSION_LOG = [
	{
		version: "1.0.2",
		date: "2026-03-30",
		title: "Public-board postflop fix",
		notes: [
			"Split postflop bot strength into private aggression and passive public-board defense.",
			"Stopped kicker-only public made hands from value-raising on paired and other board-driven runouts.",
			"Kept narrow semibluff exceptions for strong heads-up combo draws while preserving real private upgrades.",
		],
		estimated: false,
	},
	{
		version: "1.0.1",
		date: "2026-03-30",
		title: "Spot-aware bot reads",
		notes: [
			"Replaced table-average opponent reads with spot-based aggregation for players behind, live opponents, and aggressors.",
			"Added minimal hand and street state so multiway, limped, raised, and multi-raised spots influence bot decisions directly.",
			"Kept the existing tournament-pressure and sizing framework while reducing non-value aggression in crowded or strength-shown spots.",
		],
		estimated: false,
	},
	{
		version: "1.0.0",
		date: "2026-03-29",
		title: "Stable first public version",
		notes: [
			"Modularized core runtime boundaries around gameEngine, shared action UI, and shared table rendering.",
			"Synced winner labels and chip-transfer rendering across views.",
			"Fixed refund-only side-pot stats edge cases.",
		],
		estimated: false,
	},
	{
		version: "0.9.0",
		date: "2026-03-25",
		title: "Full remote multiplayer table",
		notes: [
			"Added a dedicated remote table view.",
			"Added remote actions and switching between companion and full-table views.",
			"Synced action labels and winner reactions across remote views.",
		],
		estimated: true,
	},
	{
		version: "0.6.0",
		date: "2026-03-16",
		title: "Session overlays and playback polish",
		notes: [
			"Added stats, log, and instructions overlays.",
			"Added winner reactions.",
			"Added fast forward for bot-only hands.",
		],
		estimated: true,
	},
	{
		version: "0.5.0",
		date: "2026-01-31",
		title: "Tournament-style bot upgrades",
		notes: [
			"Expanded bot decision logic with tournament pressure and stronger postflop handling.",
			"Improved spectator-mode presentation.",
			"Continued service-worker update hygiene during active iteration.",
		],
		estimated: true,
	},
	{
		version: "0.4.0",
		date: "2025-12-22",
		title: "Synced companion view",
		notes: [
			"Added backend-backed state synchronization.",
			"Added versioned state polling and synced notifications in the hole-card view.",
			"Established the optional sync architecture described in the README.",
		],
		estimated: true,
	},
	{
		version: "0.3.0",
		date: "2025-06-15",
		title: "Offline-ready table",
		notes: [
			"Introduced service-worker caching and offline fallback behavior.",
			"Added cache versioning and update handling.",
			"Reached the first README-consistent offline-capable state.",
		],
		estimated: true,
	},
	{
		version: "0.2.0",
		date: "2025-06-09",
		title: "Bots and adaptive table flow",
		notes: [
			"Added bot auto-seating and basic bot strategy.",
			"Improved bot actions with pot-odds and position-aware tuning.",
			"Added early player stats tracking used by bot behavior.",
		],
		estimated: true,
	},
	{
		version: "0.1.0",
		date: "2025-06-05",
		title: "Playable local poker table",
		notes: [
			"Added dynamic betting rounds, slider-based actions, pot tracking, and notifications.",
			"Added showdown evaluation and side-pot handling.",
			"Reached the first clearly playable local table state reflected by the current README direction.",
		],
		estimated: true,
	},
];
