# Bot Tuning Learnings

Purpose: This document records accepted and rejected bot-tuning routes so future iterations do not repeat already falsified hypotheses without new evidence.

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
