# Bot Tuning Learnings

Purpose: This document records accepted and rejected bot-tuning routes so future iterations do not repeat already falsified hypotheses without new evidence.

## 2026-06-14: Formula-Based Unopened Preflop Range Policy

### Accepted: Fix unopened preflop leaks with a range policy, not hand rescues

- **Pattern:** AJo cutoff/4 exposed a broader unopened-preflop range-shape problem, not just a bad single-hand threshold.
- **Route:** Use formula-based context signals for range openness, limp permission, realization demand, domination demand, and implied-odds credit.
- **Evidence:** The final 1000-engine batch kept global action stable while improving targeted hand-family behavior.
- **Keep:** Tune unopened-preflop decisions through seat, active-player count, stack pressure, hand family, score margin, and playability pressure.
- **Do not repeat blindly:** Do not add concrete start-hand lists or special-case rescues for a single combo when a family/context formula can explain the spot.

### Accepted: A stable global mix matters more than one perfect target rate

- **Pattern:** The accepted candidate slightly undershot the old AJo cutoff/4 target lower bound, but preserved the wider system.
- **Route:** Accept a near-boundary target if broader guardrails and adjacent clusters are cleaner than the alternative.
- **Evidence:** AJo cutoff/4 moved from `38.8%` fold to `14.8%`; AJo early/6 moved from `71.6%` to `52.6%`; UO fold rate stayed stable at `68.0%` baseline vs `68.3%` final.
- **Keep:** Prefer small target drift when the overall preflop and postflop mix remains coherent.
- **Do not repeat blindly:** Do not chase a narrow target band if doing so reintroduces global looseness or early-position over-entry.

### Accepted: Early-position pair and broadway discipline must survive late-position fixes

- **Pattern:** A fix that rescues late-position playable hands can accidentally over-open early-position medium hands and small pairs.
- **Route:** Compare the same hand families across cutoff/4, early/5, and early/6 before accepting.
- **Evidence:** Final small pairs cutoff/4 improved from `49.0%` fold to `6.9%`, while small pairs early/6 stayed selective at `58.7%`. KQo early/6 improved from `73.1%` to `49.4%` instead of collapsing to `0.0%`.
- **Keep:** Let implied-odds credit help small pairs in suitable multiway/late spots, but keep realization and domination pressure active in early seats.
- **Do not repeat blindly:** Do not remove early-position friction just because the same family is underplayed in late position.

### Rejected: The broad AJo symptom patch

- **Hypothesis:** Lowering open thresholds and allowing broad limp fallbacks is enough to fix AJo and related folds.
- **Result:** Rejected as too loose.
- **Why:** It improved AJo but over-corrected adjacent clusters: KQo early/6 reached `0.0%` folds and small pairs early/6 reached `3.5%` folds.
- **Allowed again only if:** A future patch proves the broader range mix stays stable across early-position broadways, small pairs, UO rates, and postflop guardrails.

### Validation Snapshot

- **Baseline batch:** `/private/tmp/poker-baseline-compare.KMqkKi/tmp/poker-engine-batch-20260614-195549`
- **Rejected symptom batch:** `tmp/poker-engine-batch-20260614-194645`
- **Accepted final batch:** `tmp/poker-engine-batch-20260614-204143`
- **Hard guardrails:** premium preflop folds `0`, protective folds `0`, favorite strong-hand folds `0`, all-in low-edge reraises `0`.
- **Global mix:** showdown rate `20.6%` baseline vs `20.7%` final; decisions per hand `5.1` unchanged; champion spread improved from `47` to `26`.
- **Watchpoint:** `postflop.reraises.lowEdgeCount` moved from `26` to `32`; examples were value-heavy two-pair reraises, so this is not a rejection signal unless it clusters with weaker hand quality later.

## 2026-05-13: More Active Tournament Play

### Accepted: Short-handed action is a primary engine

- **Pattern:** SB-HU and BTN-3 should be tuned as action engines, not as ordinary full-ring spots.
- **Route:** Open and defend activity can be increased when runtime signals show short-handed position, playable hand shape, and manageable stack risk.
- **Evidence:** The accepted direction moved bots away from waiting for premiums while keeping premium-fold and made-hand bluff-raise guardrails clean.
- **Keep:** Future iterations may keep tuning short-handed action if they preserve discipline in early, OOP, multiway, and high-commitment spots.
- **Do not repeat blindly:** Do not globally loosen all preflop thresholds to fix a short-handed leak.

### Accepted: Marginal blind defense needs seat-aware discipline

- **Pattern:** High combined BTN-3 blind defense is not automatically a leak because two blinds can defend.
- **Route:** Look separately at SB defend, BB defend, both-blinds-defend, and second-blind entries.
- **Evidence:** The useful pressure point was not "BTN-3 defense is high" in isolation, but whether weak second-blind or SB entries created poor arrival and bust pressure.
- **Keep:** Trim dominated or low-realization blind defenses by seat, price, and role instead of cutting all blind defense.
- **Do not repeat blindly:** Do not treat combined blind-defense percentage as a standalone fail.

### Accepted: Equity belongs in diagnostics, not runtime decisions

- **Pattern:** Equity vs estimated ranges is useful for diagnosis and acceptance, especially for call quality, high-equity folds, low-equity calls, and arrival quality.
- **Route:** Use equity batches to identify clusters, then translate findings into runtime proxies already available to `js/bot.js`.
- **Evidence:** Equity signals made decision quality easier to inspect without turning the bot into a clean solver-like agent.
- **Keep:** Compare equity to pot odds in analysis, but tune with hand class, position, route, price, stack pressure, and realization proxies.
- **Do not repeat blindly:** Do not add `equityPct` or `equityRank` as direct bot action inputs.

### Accepted: Early busts require context

- **Pattern:** Short tournaments and early busts are not failures by themselves in winner-take-all play.
- **Route:** Judge busts by hand class, zone, position, action sequence, price/equity signal, and avoidable stack risk.
- **Evidence:** Some all-ins below trips were explainable by short-stack pressure, price, or credible made-hand/draw context.
- **Keep:** Flag clustered weak-quality busts, not every early elimination.
- **Do not repeat blindly:** Do not make early-bust count or `allInBelowTrips` a hard fail without context.

### Accepted: Analysis must distinguish false fails from real leaks

- **Pattern:** A metric that catches risk can still be too blunt for acceptance.
- **Route:** Refine analysis so explainable cases are classified instead of forcing the bot to avoid them.
- **Evidence:** The better fix was to sharpen diagnostics around all-in and bust context, not to add broad runtime fear.
- **Keep:** Improve analysis when the metric is less precise than the poker situation.
- **Do not repeat blindly:** Do not add runtime guards just to satisfy an over-broad fail metric.

### Rejected: Fixing MDF by adding broad weak calls

- **Hypothesis:** More calls can repair overfold or MDF deficits.
- **Result:** Rejected as a general route.
- **Why:** Defense must come from plausible range-relevant hands, not trash calls made to fill frequency.
- **Allowed again only if:** Backtrace shows enough defendable hands arrive in the spot and fold despite good price, position, and hand quality.

### Rejected: Treating shorter tournaments as inherently worse

- **Hypothesis:** A candidate is worse if tournaments get shorter.
- **Result:** Rejected as a standalone criterion.
- **Why:** Winner-take-all play should allow pressure, busts, and shorter runs when action is strategically plausible.
- **Allowed again only if:** Shorter length comes with clustered weak hand quality, poor price, bad position, unnecessary stack risk, or guardrail regression.

### Rejected: Aggregate-only opponent or table metrics as tuning proof

- **Hypothesis:** A table-level aggregate is enough to justify a broad threshold change.
- **Result:** Rejected as too coarse.
- **Why:** Aggregates can hide seat, route, hand-family, and second-blind problems.
- **Allowed again only if:** The aggregate is backed by route/position/hand-class breakdowns and representative examples.

### Rejected: Directly optimizing one public metric

- **Hypothesis:** Improve the obvious red metric first and accept if it moves.
- **Result:** Rejected as a tuning method.
- **Why:** Single metrics can improve by moving damage into another street, route, or hand family.
- **Allowed again only if:** Related metrics, guardrails, and equity/backtrace diagnostics support the same cause.
