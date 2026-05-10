/*
Version log writing guide:
- Write from the player's or game's point of view, not from the code's point of view.
- Describe functional behavior and gameplay impact instead of internal helpers, tags, thresholds, or refactors.
- Keep titles short, plain-language, and feature-oriented.
- Keep notes concise and focused on what changed in play, pacing, risk, or clarity.
- Do not mention log, speedmode, or internal diagnostics changes in public version entries.
- Keep internal batch or output-location changes out of the public version log.
- Group related tuning work into one coherent entry instead of listing every small internal step.
*/

export const APP_VERSION = "1.2.0";

export const VERSION_LOG = [
	{
		version: "1.2.0",
		date: "2026-05-10",
		title: "Automatic next round",
		notes: [
			"After a completed hand, the New Round button now shows a short countdown before the next hand starts automatically.",
			"A compact cancel control can stop the automatic start while keeping the normal New Round button available.",
			"Game-over summaries stay manual and do not start another hand.",
		],
		estimated: false,
	},
	{
		version: "1.1.0",
		date: "2026-05-02",
		title: "Stronger game engine foundation",
		notes: [
			"Core poker flow now runs through clearer shared engine paths for actions, betting rounds, streets, hand starts, hand endings, and showdown results.",
			"Bot tournaments can be validated across much larger simulated samples, making bot tuning less noisy and reducing the risk of rule regressions.",
			"All-ins, side pots, heads-up blinds, action order, bustouts, and full-hand runouts now have broader direct coverage.",
			"The visible table experience stays the same while the rules foundation becomes faster to validate and safer to evolve.",
		],
		estimated: false,
	},
	{
		version: "1.0.30",
		date: "2026-04-29",
		title: "Stronger checked postflop ranges",
		notes: [
			"Bots can now keep more real value in their checking range after the flop, so a checked street is less automatically weak.",
			"Some strong value hands now check with the intention of raising if an opponent bets into them.",
			"Broader value checks can still continue through normal call-or-raise decisions, improving defense without making bots broadly more aggressive.",
		],
		estimated: false,
	},
	{
		version: "1.0.29",
		date: "2026-04-26",
		title: "Sharper first-in preflop choices",
		notes: [
			"Bots now choose first-in raises and limps with more attention to position, hand shape, and short-handed table flow.",
			"Weak dominated open-limps are less common, while pairs, suited hands, connectors, and stronger broadways keep their playable role.",
			"Small-blind heads-up and button three-handed spots stay active without turning every first-in hand into raise-or-fold poker.",
		],
		estimated: false,
	},
	{
		version: "1.0.28",
		date: "2026-04-26",
		title: "More context-aware preflop calls",
		notes: [
			"Bots now judge passive preflop calls more by position, price, and blind-defense context.",
			"Weak dominated hands are easier to release, while suited hands, pairs, and connected hands keep their playable role.",
			"Short-handed play keeps its action, but passive calls should now produce cleaner flop ranges.",
		],
		estimated: false,
	},
	{
		version: "1.0.27",
		date: "2026-04-26",
		title: "Cleaner passive preflop calls",
		notes: [
			"Bots now avoid more weak offsuit hands in passive preflop call and limp spots.",
			"Playable suited hands, pairs, and stronger broadways remain active, while dominated junk reaches the flop less often.",
			"Flop defense is now supported by cleaner preflop inputs instead of rescuing too many weak missed hands later.",
		],
		estimated: false,
	},
	{
		version: "1.0.26",
		date: "2026-04-26",
		title: "Cleaner late-street bluffcatching",
		notes: [
			"Bots now release more weak Turn and River bluffcatchers when their hand strength mostly comes from the board.",
			"Thin public-pair and kicker-only continues are less likely to carry defense against pressure.",
			"Private made hands, clear pair value, and real drawing equity before the River keep their existing defensive role.",
		],
		estimated: false,
	},
	{
		version: "1.0.25",
		date: "2026-04-26",
		title: "More credible postflop defense",
		notes: [
			"Bots now defend postflop with more emphasis on credible hand quality instead of filling call frequency with weak bluffcatchers.",
			"Cheap bets are still defended more readily, but weak board-only, kicker-only, and bad-price draw hands are easier to release.",
			"Flop calls stay selective, with extra defense coming from plausible equity rather than broad weak-pair continues.",
		],
		estimated: false,
	},
	{
		version: "1.0.24",
		date: "2026-04-24",
		title: "Cleaner side-pot all-ins",
		notes: [
			"Bots no longer turn all-in side-pot calls into raises when no opponent can call extra chips.",
			"Late-hand all-ins now stay closer to the real available action, reducing misleading reraise pressure.",
			"Strong value can still raise normally when at least one live opponent can call the extra amount.",
		],
		estimated: false,
	},
	{
		version: "1.0.23",
		date: "2026-04-23",
		title: "More selective pair play after the flop",
		notes: [
			"Bots now separate strong pair value more clearly from weaker or board-driven pair spots after the flop.",
			"Checked-to pair bets and reraises became more selective, especially in multiway pots and other thin early-tournament situations.",
			"Weaker pair hands are less likely to bloat pots, while clear value hands still keep their normal pressure.",
			"Short-stack postflop decisions stay aggressive with real value but are less eager to stack off with marginal pair strength.",
			"Internal speedmode reporting was updated so these weaker pair spots stay visible in diagnostics.",
		],
		estimated: false,
	},
	{
		version: "1.0.22",
		date: "2026-04-19",
		title: "Fixed tournament sizing and early deep-stack frequency",
		notes: [
			"Replaced preflop sizing with fixed tournament-style opens, 3-bets, squeezes, and 4-bets.",
			"Made preflop IP/OOP sizing follow the current hand's action order relative to the last aggressor.",
			"Capped postflop sizing to clear 30, 40, 55, and 75 percent pot buckets.",
			"Reduced early deep-stack reraises so level 0-1 pots escalate less often before stacks naturally get shallow.",
			"Kept normal opens, standard checked-to aggression, and Harrington short-stack behavior intact.",
		],
		estimated: false,
	},
	{
		version: "1.0.21",
		date: "2026-04-14",
		title: "Slowplay and bustout-call tightening",
		notes: [
			"Restricted postflop slowplay to clearer trap spots so strong value hands no longer check back rivers, multiway spots, or other thin-delay situations.",
			"Added an edge-scaled postflop elimination-relief path for heads-up tournament-life calls with strong private made hands on unpaired boards.",
			"Kept paired-board all-in folds structurally tighter so dangerous trips and full-house runouts still respect the tougher stackoff context.",
		],
		estimated: false,
	},
	{
		version: "1.0.20",
		date: "2026-04-13",
		title: "MDF defense and alpha bluffing",
		notes: [
			"Added MDF-based postflop defense so bots no longer overfold thin bluff-catch spots.",
			"Extended that MDF defense to marginal and thin turn situations so more weak-but-playable hands stay in the game.",
			"Made pure bluffs follow a clearer alpha-based frequency model so bluffing and defending now work from the same basic risk-reward idea.",
		],
		estimated: false,
	},
	{
		version: "1.0.19",
		date: "2026-04-09",
		title: "Marginal-edge postflop tuning",
		notes: [
			"Added a shared treatment for marginal postflop hands so thin spots behave more consistently.",
			"Made small made hands and weak draws more pot-control oriented under pressure.",
			"Kept thin heads-up river bluff-catching available while trimming fragile hope-calls.",
		],
		estimated: false,
	},
	{
		version: "1.0.18",
		date: "2026-04-07",
		title: "Minimum-aware reraise calls",
		notes: [
			"Stopped some over-forced reraises from being inflated into larger raises than intended.",
			"Kept real short-stack all-ins available while softening awkward non-all-in escalation.",
		],
		estimated: false,
	},
	{
		version: "1.0.17",
		date: "2026-04-06",
		title: "Edge-first postflop sizing and reraise damping",
		notes: [
			"Reworked postflop bet sizing so edge matters more than noisy spot modifiers.",
			"Reduced forced overbetting and calmer multi-raise escalation.",
			"Made aggressive postflop lines feel more controlled and less swingy.",
		],
		estimated: false,
	},
	{
		version: "1.0.16",
		date: "2026-04-05",
		title: "Postflop cost curve and speedmode diagnostics",
		notes: [
			"Made private hand improvements matter more in postflop decisions.",
			"Improved postflop risk handling and checked-to filtering.",
			"Added better internal reporting for blocked follow-up spots.",
		],
		estimated: false,
	},
	{
		version: "1.0.15",
		date: "2026-04-03",
		title: "Spot-first non-value tuning",
		notes: [
			"Made non-value postflop decisions react more to the actual spot structure.",
			"Tightened loose stabs so passive spots need cleaner permission before turning aggressive.",
		],
		estimated: false,
	},
	{
		version: "1.0.14",
		date: "2026-04-03",
		title: "Situational non-value read tuning",
		notes: [
			"Made postflop reads more situational instead of table-average based.",
			"Tightened free bluffing while keeping normal c-bets and barrels available.",
		],
		estimated: false,
	},
	{
		version: "1.0.13",
		date: "2026-04-03",
		title: "Postflop premium rescue guardrail",
		notes: [
			"Added a safety net so very strong postflop hands no longer fold away too often.",
			"Kept the rest of the postflop logic intact around that narrow guardrail.",
		],
		estimated: false,
	},
	{
		version: "1.0.12",
		date: "2026-04-03",
		title: "River low-edge call guardrail",
		notes: [
			"Stopped busted draw pressure from leaking into finished river boards.",
			"Added a river safety check to cut very weak bluff-catch calls.",
		],
		estimated: false,
	},
	{
		version: "1.0.11",
		date: "2026-04-02",
		title: "Score-based private edge signals",
		notes: [
			"Reworked private postflop edge signals to be more score-based and direct.",
			"Added a new `meaningful` lift tier between kicker and structural spots.",
			"Updated logs and summaries so these spot types stay visible.",
		],
		estimated: false,
	},
	{
		version: "1.0.10",
		date: "2026-04-02",
		title: "Private-edge postflop guardrails",
		notes: [
			"Stopped dedicated bluff lines from leaking into private made hands.",
			"Added a small private-edge check for postflop value and protection raises.",
			"Expanded logs and docs so private-edge spots are easier to read.",
		],
		estimated: false,
	},
	{
		version: "1.0.9",
		date: "2026-04-02",
		title: "Premium preflop no-fold guardrail",
		notes: [
			"Added a simple guardrail so premium preflop hands no longer fold away.",
			"Kept the rest of the tournament bot logic unchanged around that safety check.",
			"Aligned the premium threshold across runtime and debug output.",
		],
		estimated: false,
	},
	{
		version: "1.0.8",
		date: "2026-04-02",
		title: "Legacy bot baseline restored",
		notes: [
			"Restored the older heuristic tournament bot as the active default.",
			"Moved the bot back toward more playable tournament-style behavior.",
			"Updated the docs so they match the live runtime again.",
		],
		estimated: false,
	},
	{
		version: "1.0.7",
		date: "2026-04-01",
		title: "Short-handed opens and passive-street probes",
		notes: [
			"Improved short-handed opening ranges, especially in late short-table spots.",
			"Made bots react better after passive heads-up streets.",
			"Added a few more heads-up probe opportunities to reduce full check-through lines.",
		],
		estimated: false,
	},
	{
		version: "1.0.6",
		date: "2026-03-31",
		title: "Spot-based bot baseline stabilization",
		notes: [
			"Finished the move to more explicit preflop spot policies.",
			"Cleaned up short-stack and multi-raised behavior.",
			"Split postflop made-hand defense into clearer strength tiers.",
			"Added a small stab tune for checked-to weak spots.",
		],
		estimated: false,
	},
	{
		version: "1.0.5",
		date: "2026-03-31",
		title: "TAG bot tuning consolidation",
		notes: [
			"Moved the bot toward a clearer TAG-style baseline.",
			"Reworked unopened preflop ranges by seat and table size.",
			"Retuned heads-up and short-handed play to stay active without getting sloppy.",
			"Kept public-board safety while allowing more real c-bets and semibluffs.",
		],
		estimated: false,
	},
	{
		version: "1.0.4",
		date: "2026-03-31",
		title: "Hand-based blind progression",
		notes: [
			"Changed blind progression from orbit-based jumps to a hand-based cadence.",
			"Cleaned up the blind ladder to feel more like a normal tournament structure.",
			"Kept the rest of the table flow unchanged.",
		],
		estimated: false,
	},
	{
		version: "1.0.3",
		date: "2026-03-30",
		title: "Tournament unopened raise-or-fold",
		notes: [
			"Switched unopened green-zone preflop play to raise-or-fold.",
			"Standardized normal tournament open sizes around 2.5bb.",
			"Left push-or-fold and other preflop branches alone.",
		],
		estimated: false,
	},
	{
		version: "1.0.2",
		date: "2026-03-30",
		title: "Public-board postflop fix",
		notes: [
			"Split postflop strength into private aggression and public-board defense.",
			"Stopped weak board-made hands from value-raising too often.",
			"Kept narrow semibluff exceptions for stronger draw spots.",
		],
		estimated: false,
	},
	{
		version: "1.0.1",
		date: "2026-03-30",
		title: "Spot-aware bot reads",
		notes: [
			"Replaced table-average reads with more spot-aware bot reads.",
			"Made limped, raised, multi-raised, and multiway spots matter more directly.",
			"Reduced loose non-value aggression in crowded or strength-shown spots.",
		],
		estimated: false,
	},
	{
		version: "1.0.0",
		date: "2026-03-29",
		title: "Stable first public version",
		notes: [
			"Established the first stable public version of the table.",
			"Unified winner and chip-transfer rendering across views.",
			"Fixed a few remaining side-pot edge cases.",
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
			"Expanded the bots toward more tournament-style play.",
			"Improved postflop handling and spectator presentation.",
			"Kept app updates rolling out more reliably during active iteration.",
		],
		estimated: true,
	},
	{
		version: "0.4.0",
		date: "2025-12-22",
		title: "Synced companion view",
		notes: [
			"Added backend-backed state sync for the companion view.",
			"Added synced polling and notifications in the hole-card view.",
			"Established the optional sync architecture described in the README.",
		],
		estimated: true,
	},
	{
		version: "0.3.0",
		date: "2025-06-15",
		title: "Offline-ready table",
		notes: [
			"Added service-worker caching and offline fallback behavior.",
			"Improved update handling for cached builds.",
			"Reached the first offline-ready table state.",
		],
		estimated: true,
	},
	{
		version: "0.2.0",
		date: "2025-06-09",
		title: "Bots and adaptive table flow",
		notes: [
			"Added bot auto-seating and the first basic bot strategy.",
			"Improved bot actions with better pot-odds and position awareness.",
			"Added early player stats tracking for bot behavior.",
		],
		estimated: true,
	},
	{
		version: "0.1.0",
		date: "2025-06-05",
		title: "Playable local poker table",
		notes: [
			"Added the core local table flow with betting, pot tracking, and notifications.",
			"Added showdown evaluation and side-pot handling.",
			"Reached the first clearly playable local version.",
		],
		estimated: true,
	},
];
