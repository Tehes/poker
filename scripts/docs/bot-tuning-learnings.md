# Bot Tuning Learnings

Purpose: This document records accepted and rejected bot-tuning routes so future iterations do not repeat already falsified hypotheses without new evidence.

## 2026-11-25: River Defense After Checked-Through Flop and Turn

### No Qualified Candidate

- The heads-up out-of-position check range contained little strong value. In the 1,000-tournament Core baseline, only one of 24 folded weak private pairs or underpairs was ahead against the actual river bet at 30% to 55% pot. One tied.
- At half pot, relief of up to `0.04` on the call barrier gained `0.03–0.04` BB per 100 opponent hands in two LAG replays with 25% of eligible extra bluff bets enabled. Relief of `0.06` reached the `+0.05` target but exceeded the `0.025` BB/100 loss tolerance against regular LAG bets in both samples. The replays held value bet selection and sizing fixed.
- At the existing 30% check frequency, replacing value bets with checks for Two Pair+ was worth an estimated `+0.015` and `+0.007` BB per 100 opponent hands in the two LAG samples. The audit stopped at the candidate gate.
- Reopen if new evidence identifies a repeatable subset of profitable calls against plausible betting ranges, or a value-check mix that earns materially more than leading. Baselines and replays are in `tmp/river-defense-playbook-20261125/`.

## 2026-11-24: More Small Blind Opens at a Two-Player Table

### Accepted After Reviewing the Guardrail Hit

- Lowered the unopened Small Blind raise threshold by `1.35` at a two-player table in the green stack zone. The additional raises mainly replaced limps. The baseline was `4a84b2b` and the matchup tests used opponent pool v3.
- Validation passed in the reference, Nit and Calling Station fields. The changes were `+0.069`, `+0.069` and `+0.073` BB per target opportunity. The direct Nit replay returned `+0.082` BB per opportunity over 11,831 spots. The LAG holdout passed with `+0.110` BB per opportunity on fresh seeds.
- The final 1,000-tournament Core batch recorded one postflop all-in reraise below the required edge of `1.0`. The candidate shoved a straight over public trips with an edge of `0.9949` in run 653, hand 40, at a four-player table. The baseline flagged run 97, hand 6, at a six-player table. The replay reproduced the same shove with both strategy snapshots on each recorded state. Both opponents held full houses. From the decision, the candidate hand lost 3,350 chips by shoving and would have lost 1,170 by calling. The baseline hand lost 2,070 chips by shoving and would have lost 690 by calling.
- The hand review found the shove defensible given the information available to the bot. This existing case was accepted as an exception for this candidate. The guardrail continues to report the hit.
- Rollout passed across 3,000 paired tournaments. The fixed TAG opponent averaged `+0.00274` BB per hand against the five candidate bots and `+0.00353` against the five baseline bots. The measured opponent advantage against the baseline was `+0.00079` BB per hand, with a 95% interval from `−0.00037` to `+0.00194`. The Small Blind adjustment was restored locally. Reports and the exact replay are in `tmp/sb-matchup-4a84b2b/`.

## 2026-11-21: River Calls After the Same Bettor Opened Flop and Turn

### No Qualified Candidate

- The audit tested a `+0.04` call-barrier adjustment for weak private pairs facing the first river bet heads-up at 20% to 33⅓% pot odds, when the bettor also opened the betting on both earlier streets.
- In the fresh 1,000-tournament six-bot baseline, all 48 flipped calls lost. Folding saved 21,580 chips versus 16,070 from folding the same number by hand strength and price alone. Cheap calls, top pair or better, and comparable calls against other lines stayed stable in replay.
- The equal-fold chip advantage was `+5,510` in the fresh baseline, `−1,110` in a separate 1,000-tournament run, and `+1,780` in a separate 300-tournament run. All three used the same bot decision logic. The older 1,000-tournament run predates the split in all-in statistics. The fresh baseline's 95% interval spanned `−3,600` to `+14,780` chips, and the rule flipped 48 of 79,520 hands. The audit ended before a runtime change or candidate batch.
- Reopen this route when new evidence shows a repeatable, material gain over equal-fold tightening based on hand strength and price. Audit details are in `tmp/river-call-audit-20261121/audit-results.json`.

## 2026-11-21: Turn Calls With Only a Public Pair

### Accepted After Reviewing the Flagged Hand

- Added `+0.06` to the existing weak-private call penalty for a board-only pair with a kicker facing the first turn bet heads-up at 25% to 33⅓% pot odds. All-in spots and strong draws were excluded.
- In the original 440-call cohort, 305 decisions flipped for sure and 65 more could flip on the tie-break. Expected net savings were 132,675 chips after giving up 35 calls with positive recorded outcomes in expectation. Both 300-tournament replicas supported the result. The replay left cheap calls, top pair or better, and strong draws stable.
- The 100-, 500-, and 1,000-tournament batches improved realized chips per eligible spot. Across the full heads-up-at-decision scope, the 1,000-tournament call rate fell from 46.74% to 11.74% and value rose from −2.96 to −0.86 BB per spot. The final batch recorded one all-in low-edge reraise against the required count of zero.
- The accepted MDF trade-off in the 1,000-tournament batch was 11.06 to 14.25 percentage points of overfold on heads-up turns. Outside the target spots, the gap moved from 10.31 to 9.19 percentage points. The chip gain was measured in six-bot self-play.
- That flag came from a river flush over a public straight in the first hand of run 250. The structural upgrade scored `0.9952` against the `1.0` cutoff. Baseline and candidate both shoved 1,570 chips from the same state in replay, and a worse straight called. The candidate was accepted after the hand review. The batch still records the single flag. Audit and batch details are in `tmp/turn-board-pair-audit-20261121/`.

## 2026-08-22: Paired-Board Private-Pair Calls

### Accepted: Formal Two Pair Is Not Always Strong Private Value

- **Pattern:** On paired boards, the formal `Two Pair` label merged strategically different hands. A lower private board pair or a pocket pair below the board singletons was defended almost like a top private board pair or a pocket pair above the singletons.
- **Route:** Keep the shared postflop risk line, but evaluate weak paired-board private-pair calls from their public-board strength plus limited private contribution. Leave raise/value logic and stronger neighboring hand families unchanged.
- **Result:** Accepted. The candidate removes weak bluffcatching calls instead of reducing the whole defense range or adding an MDF exception.
- **Evidence:** In the 1000-run acceptance batch, lower private-pair calls fell from `80.5%` to `69.7%` and pocket-under calls from `83.1%` to `70.2%`. Top private-pair calls stayed stable at `82.2%` to `81.7%`, while pocket-over calls stayed stable at `80.2%` to `81.5%`.
- **Equity:** The targeted 300-run equity check reduced paired-board private-pair calls from `954` to `852`; low-equity calls fell from about `642` to `548`, and their share from `67.3%` to `64.3%`.
- **Keep:** Separate nominal hand rank from the private contribution that actually makes the hand playable. Protect top private pairs, pocket pairs above the board singletons, genuine unpaired-board two pair, trips+, and real draws.
- **Do not repeat blindly:** Do not tighten all paired-board calls, weaken all two-pair hands, or chase MDF by adding trash calls. Use board shape, private contribution, price, and pressure together.
- **Watchpoint:** Weak paired-board calls still contain a high low-equity share. Treat that as a future diagnosis trigger only if a fresh report shows a stable remaining cluster; do not stack another broad penalty onto this accepted route.

### Validation Snapshot: Paired-Board Private-Pair Calls

- **Comparison baseline:** `tmp/v150-multiraise-realization-acceptance-20260815-1000`
- **Accepted core batch:** `tmp/poker-engine-batch-20260822-135113`
- **Accepted equity batch:** `tmp/poker-engine-batch-20260822-135453`
- **Hard guardrails:** premium preflop folds `0`, bluff raises with made hand `0`, all-in low-edge reraises `0`.
- **Global defense:** Facing-bet MDF overfold changed only marginally from `13.33%` to `13.54%`; the global postflop action mix stayed stable.

## 2026-08-22: Multi-Raised Call Realization

### Accepted: Narrower Entry Without Sacrificing Playability

- **Pattern:** Bots carried too many fragile hands through additional preflop raises, then reached postflop with ranges that were wider but difficult to realize.
- **Route:** Reuse the central preflop realization model for multi-raised calls so suitedness, connectivity, pair type, domination risk, position, and pressure decide which speculative hands continue.
- **Result:** Accepted. The candidate trims weak multi-raised entries instead of forcing broader defense for MDF.
- **Evidence:** In the 1000-run acceptance batch, flop facing-bet spots after a final `callVsMultiRaise` route fell from `1278` to `1134`, while their fold rate improved from `55.1%` to `53.4%`. The surviving range is smaller but slightly more capable of continuing.
- **Keep:** Treat range width and playability as separate concerns. Preserve suited, connected, paired, and otherwise realizable hands; do not preserve weak entries only to increase raw defense frequency.
- **Do not repeat blindly:** Do not repair multi-raised ranges with combo lists or MDF call overrides. Tune the shared realization inputs and validate the resulting range composition.
- **Watchpoint:** The targeted equity pass exposed a separate postflop classification issue around apparent two-pair value on paired boards. It is not part of this accepted preflop candidate and should not be folded into it without a separate decision.

## 2026-06-15: Structural Made-Hand Call Relief

### Rejected: Narrow Relief Was Too Small To Ship

- **Pattern:** Bots folded some real private two-pair and trips improvements just below the postflop risk line when facing raises.
- **Route tested:** A narrow call-barrier relief for structural private made-hand lifts, with river relief limited to very cheap calls.
- **Result:** Rejected after validation. The candidate stayed safe, but the behavior gain was too small for another local risk-line exception.
- **Evidence:** The final 1000-engine batch kept hard guardrails clean and moved the target fold rate from the comparison baseline `9.43%` to `8.68%`; the direct 500-run candidate moved it to `8.36%`.
- **Scale:** The candidate rescued roughly `60-90` narrow spots per 1000 games, about `0.07%` of all hands in the acceptance run.
- **MDF impact:** Global facing-bet overfold stayed effectively unchanged (`13.32%` comparison gap, `12.97%` direct 500-run candidate gap, `13.21%` final 1000-run candidate gap). Treat this as a made-hand coherence symptom, not an MDF fix.
- **Architecture reason:** The relief was defensible in isolation, but it added another special call-barrier adjustment for a very small slice of all hands. The risk line already has several local adjustments, so more narrow reliefs increase model drift and make future behavior harder to explain.
- **Do not repeat blindly:** Do not add more narrow `...CallRelief()` helpers for adjacent symptoms. The effect is small, and repeated reliefs will make the risk-line model harder to reason about.
- **Next better route:** If similar postflop symptoms appear again, integrate them into a central postflop range-quality / risk-line model instead of adding another local exception.

## 2026-06-15: General Preflop Realization Model

### Accepted: Hand Shape Instead of a Mini-Range Rule

- **Pattern:** The first fix improved weak short-handed offsuit limps, but `isDecentShortHandedOffsuitJunk()` was too close to a mini starting-hand list.
- **Route:** Replace the special case with `getPreflopRealizationPenalty()`, which accounts for hand family, suitedness, connectivity, domination risk, position, active players, and route.
- **Evidence:** The accepted 1000-engine batch keeps preflop mix, showdown/uncontested, SB-HU, BTN-3, and hard guardrails stable. It slightly reduces BTN-3 limps, while low connected offsuit hands become limpable from SB-HU more often than under the previous special-case helper.
- **Keep:** Future preflop realization tuning should go into this model, not into new hand-list-like special helpers.
- **Do not repeat blindly:** Do not rescue or cut individual combos when connectivity, suitedness, domination, and route can explain the decision more generally.
- **Data-shape guardrail:** If `getPreflopRealizationPenalty()` is called with `preflopScores` instead of the full profile, `dominationRisk`, `suited`, `pair`, and `connector` must exist on the score object; otherwise pressure becomes `NaN` and eligibility is distorted.

### Validation Snapshot: Preflop Realization Model

- **Accepted comparison batch:** `tmp/poker-engine-batch-20260615-114336`
- **Accepted model batch:** `tmp/poker-engine-batch-20260615-124334`
- **Hard guardrails:** premium preflop folds `0`, bluff raises with made hand `0`, all-in low-edge reraises `0`.
- **Global mix:** preflop fold/call/raise `64.4%/15.7%/17.8%` comparison vs `64.0%/16.0%/17.8%` model; showdown/uncontested `20.2%/79.8%` comparison vs `20.6%/79.4%` model.
- **Short-handed open action:** SB-HU open uncontested `63.3%` comparison vs `62.6%` model; BTN-3 folded-through `43.0%` comparison vs `42.9%` model.
- **Passive limp profile:** SB-HU limps `52.42` -> `57.89` per 1000 hands; BTN-3 limps `29.23` -> `28.94` per 1000 hands. The SB-HU increase is accepted because global action, defend dynamics, and trash guardrails stayed stable.
- **Connector watchpoint resolved:** In protected short-handed unopened limp spots, `98o` moved from `1.84` to `4.13` per 1000 hands, `87o` from `0.00` to `2.15`, and `76o` from `0.00` to `1.99`.
- **Trash guardrail:** Clearly weak disconnected offsuit hands such as `T4o`, `94o`, `83o`, and `72o` stayed at `100.0%` folds in the same protected short-handed unopened sample.

## 2026-06-14: Formula-Based Unopened Preflop Range Policy

### Accepted: Fix Unopened Preflop Leaks With a Range Policy, Not Hand Rescues

- **Pattern:** AJo cutoff/4 exposed a broader unopened-preflop range-shape problem, not just a bad single-hand threshold.
- **Route:** Use formula-based context signals for range openness, limp permission, realization demand, domination demand, and implied-odds credit.
- **Evidence:** The final 1000-engine batch kept global action stable while improving targeted hand-family behavior.
- **Keep:** Tune unopened-preflop decisions through seat, active-player count, stack pressure, hand family, score margin, and playability pressure.
- **Do not repeat blindly:** Do not add concrete starting-hand lists or special-case rescues for a single combo when a family/context formula can explain the spot.

### Accepted: A Stable Global Mix Matters More Than One Perfect Target Rate

- **Pattern:** The accepted candidate slightly undershot the old AJo cutoff/4 target lower bound, but preserved the wider system.
- **Route:** Accept a near-boundary target if broader guardrails and adjacent clusters are cleaner than the alternative.
- **Evidence:** AJo cutoff/4 moved from `38.8%` fold to `14.8%`; AJo early/6 moved from `71.6%` to `52.6%`; UO fold rate stayed stable at `68.0%` baseline vs `68.3%` final.
- **Keep:** Prefer small target drift when the overall preflop and postflop mix remains coherent.
- **Do not repeat blindly:** Do not chase a narrow target band if doing so reintroduces global looseness or early-position over-entry.

### Accepted: Early-Position Pair and Broadway Discipline Must Survive Late-Position Fixes

- **Pattern:** A fix that rescues late-position playable hands can accidentally over-open early-position medium hands and small pairs.
- **Route:** Compare the same hand families across cutoff/4, early/5, and early/6 before accepting.
- **Evidence:** Final small pairs cutoff/4 improved from `49.0%` fold to `6.9%`, while small pairs early/6 stayed selective at `58.7%`. KQo early/6 improved from `73.1%` to `49.4%` instead of collapsing to `0.0%`.
- **Keep:** Let implied-odds credit help small pairs in suitable multiway/late spots, but keep realization and domination pressure active in early seats.
- **Do not repeat blindly:** Do not remove early-position friction just because the same family is underplayed in late position.

### Rejected: The Broad AJo Symptom Patch

- **Hypothesis:** Lowering open thresholds and allowing broad limp fallbacks is enough to fix AJo and related folds.
- **Result:** Rejected as too loose.
- **Why:** It improved AJo but over-corrected adjacent clusters: KQo early/6 reached `0.0%` folds and small pairs early/6 reached `3.5%` folds.
- **Allowed again only if:** A future patch proves the broader range mix stays stable across early-position broadways, small pairs, UO rates, and postflop guardrails.

### Validation Snapshot: Unopened Preflop Range Policy

- **Baseline batch:** `/private/tmp/poker-baseline-compare.KMqkKi/tmp/poker-engine-batch-20260614-195549`
- **Rejected symptom batch:** `tmp/poker-engine-batch-20260614-194645`
- **Accepted final batch:** `tmp/poker-engine-batch-20260614-204143`
- **Hard guardrails:** premium preflop folds `0`, protective folds `0`, favorite strong-hand folds `0`, all-in low-edge reraises `0`.
- **Global mix:** showdown rate `20.6%` baseline vs `20.7%` final; decisions per hand `5.1` unchanged; champion spread improved from `47` to `26`.
- **Watchpoint:** `postflop.reraises.lowEdgeCount` moved from `26` to `32`; examples were value-heavy two-pair reraises, so this is not a rejection signal unless it clusters with weaker hand quality later.

## 2026-05-13: More Active Tournament Play

### Accepted: Short-Handed Action Is a Primary Engine

- **Pattern:** SB-HU and BTN-3 should be tuned as action engines, not as ordinary full-ring spots.
- **Route:** Open and defend activity can be increased when runtime signals show short-handed position, playable hand shape, and manageable stack risk.
- **Evidence:** The accepted direction moved bots away from waiting for premiums while keeping premium-fold and made-hand bluff-raise guardrails clean.
- **Keep:** Future iterations may keep tuning short-handed action if they preserve discipline in early, OOP, multiway, and high-commitment spots.
- **Do not repeat blindly:** Do not globally loosen all preflop thresholds to fix a short-handed leak.

### Accepted: Marginal Blind Defense Needs Seat-Aware Discipline

- **Pattern:** High combined BTN-3 blind defense is not automatically a leak because two blinds can defend.
- **Route:** Look separately at SB defend, BB defend, both-blinds-defend, and second-blind entries.
- **Evidence:** The useful pressure point was not "BTN-3 defense is high" in isolation, but whether weak second-blind or SB entries created poor arrival and bust pressure.
- **Keep:** Trim dominated or low-realization blind defenses by seat, price, and role instead of cutting all blind defense.
- **Do not repeat blindly:** Do not treat combined blind-defense percentage as a standalone fail.

### Accepted: Equity Belongs in Diagnostics, Not Runtime Decisions

- **Pattern:** Equity vs estimated ranges is useful for diagnosis and acceptance, especially for call quality, high-equity folds, low-equity calls, and arrival quality.
- **Route:** Use equity batches to identify clusters, then translate findings into runtime proxies already available to `js/bot.js`.
- **Evidence:** Equity signals made decision quality easier to inspect without turning the bot into a clean solver-like agent.
- **Keep:** Compare equity to pot odds in analysis, but tune with hand class, position, route, price, stack pressure, and realization proxies.
- **Do not repeat blindly:** Do not add `equityPct` or `equityRank` as direct bot action inputs.

### Accepted: Early Busts Require Context

- **Pattern:** Short tournaments and early busts are not failures by themselves in winner-take-all play.
- **Route:** Judge busts by hand class, zone, position, action sequence, price/equity signal, and avoidable stack risk.
- **Evidence:** Some all-ins below trips were explainable by short-stack pressure, price, or credible made-hand/draw context.
- **Keep:** Flag clustered weak-quality busts, not every early elimination.
- **Do not repeat blindly:** Do not make early-bust count or `allInBelowTrips` a hard fail without context.

### Accepted: Analysis Must Distinguish False Fails From Real Leaks

- **Pattern:** A metric that catches risk can still be too blunt for acceptance.
- **Route:** Refine analysis so explainable cases are classified instead of forcing the bot to avoid them.
- **Evidence:** The better fix was to sharpen diagnostics around all-in and bust context, not to add broad runtime fear.
- **Keep:** Improve analysis when the metric is less precise than the poker situation.
- **Do not repeat blindly:** Do not add runtime guards just to satisfy an over-broad fail metric.

### Rejected: Fixing MDF by Adding Broad Weak Calls

- **Hypothesis:** More calls can repair overfold or MDF deficits.
- **Result:** Rejected as a general route.
- **Why:** Defense must come from plausible range-relevant hands, not trash calls made to fill frequency.
- **Allowed again only if:** Backtrace shows enough defendable hands arrive in the spot and fold despite good price, position, and hand quality.

### Rejected: Treating Shorter Tournaments as Inherently Worse

- **Hypothesis:** A candidate is worse if tournaments get shorter.
- **Result:** Rejected as a standalone criterion.
- **Why:** Winner-take-all play should allow pressure, busts, and shorter runs when action is strategically plausible.
- **Allowed again only if:** Shorter length comes with clustered weak hand quality, poor price, bad position, unnecessary stack risk, or guardrail regression.

### Rejected: Aggregate-Only Opponent or Table Metrics as Tuning Proof

- **Hypothesis:** A table-level aggregate is enough to justify a broad threshold change.
- **Result:** Rejected as too coarse.
- **Why:** Aggregates can hide seat, route, hand-family, and second-blind problems.
- **Allowed again only if:** The aggregate is backed by route/position/hand-class breakdowns and representative examples.

### Rejected: Directly Optimizing One Public Metric

- **Hypothesis:** Improve the obvious red metric first and accept if it moves.
- **Result:** Rejected as a tuning method.
- **Why:** Single metrics can improve by moving damage into another street, route, or hand family.
- **Allowed again only if:** Related metrics, guardrails, and equity/backtrace diagnostics support the same cause.
