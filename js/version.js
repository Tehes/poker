export const APP_VERSION = "1.0.8";

export const VERSION_LOG = [
	{
		version: "1.0.7",
		date: "2026-04-01",
		title: "Short-handed opens and passive-street probes",
		notes: [
			"Tracked checked-through flop and turn streets in the hand context so bots can react specifically to passive heads-up runouts.",
			"Widened unopened short-handed ranges specifically for 6-handed early, 5-handed early, 4-handed cutoff, 3-handed button, and heads-up small blind spots.",
			"Raised heads-up weak no-bet stab floors and added narrow first-to-act and delayed-river heads-up probes after passive prior streets.",
			"Kept the existing raised-pot, Harrington short-stack, multiway, and public-board safety logic intact while reducing full check-through lines in speedmode.",
		],
		estimated: false,
	},
	{
		version: "1.0.6",
		date: "2026-03-31",
		title: "Spot-based bot baseline stabilization",
		notes: [
			"Finished the explicit preflop spot-policy transition with chart-like unopened, limped, single-raised, and multi-raised paths, while removing the old Chen-driven fallback from active bot play.",
			"Stabilized short-stack and multi-raised behavior so non-premium hands no longer leak into the conservative multi-raised path through the old shove override.",
			"Split postflop made-hand defense into real tiers so top pair, overpairs, two pair, and trips-plus no longer share the same passive call gate.",
			"Extended speedmode reporting with exact acting-slot no-bet initiative slices and added a narrow last-to-act stab tune for checked-to weak spots outside preflop-aggressor lines.",
		],
		estimated: false,
	},
	{
		version: "1.0.5",
		date: "2026-03-31",
		title: "TAG bot tuning consolidation",
		notes: [
			"Replaced the old postflop aggression rank curve with TAG-style hand and spot tiers for air, showdown hands, top pair+, and strong draws.",
			"Replaced the hard Chen-score open gate with chart-like unopened raise bands by handedness and real preflop seat class, including heads-up and big-blind defend fixes.",
			"Retuned heads-up and short-handed play with balanced 5-handed unopened widening while keeping lower-light and trash ranges controlled.",
			"Kept public-board kicker safety while allowing legitimate c-bets, protection bets, and strong-draw semibluffs to survive the old blanket downgrade.",
		],
		estimated: false,
	},
	{
		version: "1.0.4",
		date: "2026-03-31",
		title: "Hand-based blind progression",
		notes: [
			"Replaced orbit-based blind jumps with a fixed 6-hand level cadence that no longer accelerates short-handed or heads-up.",
			"Switched blind growth to a monotonic formula with a nicer safe blind ladder, replacing awkward levels like 110/220 and 310/620 with more tournament-like values such as 100/200, 150/300, and 200/400.",
			"Kept dealer rotation, blind posting, and chip safety for bots, action controls, and split-pot payouts unchanged.",
		],
		estimated: false,
	},
	{
		version: "1.0.3",
		date: "2026-03-30",
		title: "Tournament unopened raise-or-fold",
		notes: [
			"Removed open-limp calls from green-zone unopened preflop spots and switched them to raise-or-fold.",
			"Standardized unopened tournament open raises to a fixed 2.5bb size rounded to the existing chip grid.",
			"Kept Harrington push-or-fold handling and non-unopened preflop branches unchanged.",
		],
		estimated: false,
	},
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
