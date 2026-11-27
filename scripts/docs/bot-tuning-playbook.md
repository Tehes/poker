# Bot Tuning Playbook

## Purpose

This document guides larger bot tuning iterations. The strategic guardrails apply to the standard bot
in `js/bot.js` and the opponent profiles in `scripts/matchupPool.js`. The playbook helps choose the
appropriate diagnosis, the smallest useful lever and reliable validation.

Before every bot tuning iteration, also read `scripts/docs/bot-tuning-learnings.md`. It records accepted
and rejected routes that must not be repeated without new evidence.

The [Bot Tuning Backlog](./bot-tuning-backlog.md) collects provisionally prioritized open hypotheses
for future investigation. It is not a binding task list.

## Principle

Do not tune the metric. Tune the cause.

The bot remains heuristic. Equity, MDF and batch metrics are diagnosis and calibration layers, not
runtime decision models.

### Strictly Prohibited

- Use `equityPct` or `equityRank` as a decision criterion in `js/bot.js`.
- Change logs, analysis or metric definitions just to make a candidate look better.
- Fix MDF or overfolding with obvious trash calls.
- Introduce global tightness or looseness without root-cause evidence.
- Solve multiple independent leaks in one pass.

## Scope

### Normal Tuning Targets

- Standard bot in `js/bot.js`
- Opponent profiles in `scripts/matchupPreflop.js` and `scripts/matchupPostflop.js`
  ([profile tuning](#reviewing-and-developing-profiles))

### Allowed When Part of the Iteration

- Temporary analyses and reports in `tmp/`
- Batch output in `tmp/`
- `js/version.js` and service worker version when an accepted candidate is to go live
- Analysis extensions only with explicit approval and only minimally

### Not Without Explicit Approval

- Engine logic
- Test logic
- Logging formats
- Existing metric definitions
- UI or copy changes

## Iteration at a Glance

For the standard bot, follow this process:

1. Read `scripts/docs/bot-tuning-learnings.md`.
2. Establish self-play and mixed baselines for the same bot version.
3. Independently search both baselines for noteworthy patterns and compare them across opponent fields.
4. Locate the cause: arrival, spot decision, line, sizing, range, stack pressure or artifact.
5. Examine plausible alternatives in replay. Use equity, MDF or backtrace diagnosis as needed.
6. Formulate a specific hypothesis.
7. Change one focused lever in `js/bot.js`.
8. Run staged validation.
9. Accept, reject or update the diagnosis.

## Goal Loop Contract

A goal addresses exactly one leak and one root cause. It must not demand an improvement at any cost or
start an adjacent tuning question.

- Diagnosis and counterfactuals do not count as candidate passes.
- At most two candidate passes are allowed, each with one hypothesis and one focused lever.
- A third pass is allowed only if new evidence materially changes the hypothesis and the candidate is
  requalified before the next code change.
- Without new evidence the goal ends after two rejected candidates.
- A failed 1000-run acceptance batch ends the goal; no further pass follows.
- Do not repeat the same batch without a material change to code or hypothesis.
- After each pass, briefly record only the hypothesis, change, evidence and next gate.

Terminal states are `accepted` or `no-qualified-candidate`. A genuine external blocker may block the
goal; difficult or inconclusive tuning results are not a blocker.

## Baseline Policy

Use the last accepted 1000-run baseline as long as it still fits the bot version and question.

Generate a fresh 1000-run core baseline when:

- A new major tuning campaign begins.
- The last accepted state is unclear.
- Several bot changes have occurred since the last baseline.
- The comparison cannot be answered fairly without a fresh baseline.

### Core Baseline

```bash
deno task engine:batch:1000
```

Always record:

- Path
- Run count
- Hand count
- Decision coverage
- Showdown / uncontested
- Preflop fold / call / raise
- Postflop fold / call / raise
- SB-HU and BTN-3 open/defend dynamics
- Guardrails
- Early-bust and tournament flow

## Pattern Discovery Before Choosing a Lever

Start diagnosis with the current bot version in self-play and the mixed batch. Independently look for
noteworthy patterns in both reports. The mixed field can reveal additional weaknesses against other
strategies even before candidate selection.

```bash
deno task engine:diagnose -- --runs=1000 --out=tmp/matchup-discovery
```

The runner generates both diagnostic fields in one run. The combined diagnostic report compares
`reference` and `mixed` for the same test seat and seeds. It contains shared spots and breakdowns by hand
class, position, line, bet size and opponent profile. For finer cuts, use the compressed decision log with
the same definition in both fields. The core baseline adds a view of the entire table and guardrails.
[Diagnostic report and log format](./matchup-experiments.md#combined-pattern-discovery)

For each pattern, record how often the spot occurs, which hands arrive there, how often the notable action
is selected and observed chip value per spot. Report the number of comparable spots per field. Few
observations leave transferability open.

A pattern in both fields suggests a broader weakness. A robust pattern in one field can also be a target
leak. If an opponent effect is suspected, specifically swap the relevant profile for a control profile.
Then examine plausible alternatives at the same starting spot in replay. Only then select a lever for
the suspected cause.

## Diagnosis Menu

Choose the diagnosis according to the leak. Not every leak needs every tool.

### Core Structure

```bash
deno task engine:batch
```

### Core Stability

```bash
deno task engine:batch:500
```

### Core Acceptance Run

```bash
deno task engine:batch:1000
```

### Postflop Equity Diagnosis

```bash
deno task engine:batch -- --runs=300 --equity --equity-limit=1000
```

### Preflop / Arrival / Blind Defense Equity Diagnosis

```bash
deno task engine:batch -- --runs=300 --equity-preflop --equity-limit=3000
```

### Larger Equity Check

For important or ambiguous candidates:

```bash
deno task engine:batch -- --runs=1000 --equity-preflop --equity-limit=3000
```

### Speedmode

- If local browser automation is available, use staged Speedmode after bot logic changes.
- If Speedmode is blocked, state the blocker clearly and use engine batches.

## Root-Cause Questions

Before changing code, briefly answer:

### 1. What Is Visibly Wrong?

- Which metric?
- How large is the sample?
- Which street, route, position or hand class?

### 2. Where Does It Likely Originate?

- **Arrival Quality:** Does the range already arrive at the spot in poor shape?
- **Spot Decision:** Is the specific decision wrong?
- **Line / Sequence:** Does an earlier line lead to bad later spots?
- **Sizing / Pot Geometry:** Do bets or calls produce poor SPR or pot odds?
- **Range Composition:** Is the range too trash-heavy, capped or light on value?
- **Table Dynamics:** HU/MW, position, blind context, stack pressure, opponent read?
- **Artifact / Noise:** Is the metric explainable or too small?

### 3. What Would Be the Smallest Runtime Proxy?

- Route / spotKey
- Hand family / hand class
- Position / blind context
- HU/MW
- Pot-odds bucket
- `flatScore` / `defendScore` / playability / domination
- `preflopRaiseCount` / `raiseLevel`
- PairClass / DrawFlag / LiftType / Texture

## Using Equity Correctly

Equity is especially useful for:

- Call quality
- High-equity folds
- Low-equity calls
- Low-equity raises
- Preflop arrival
- Blind defense
- MDF / overfold contradictions
- Trash-heavy later ranges

Break down by:

- phase / action
- signal
- `candidate.reason`
- `equityPct`
- `potOddsPct`
- `marginPct`
- `equityRank`
- `activePlayers`
- route / spotKey
- handClass
- position / blind context
- HU/MW
- later arrival class

Important:

- Individual examples are clues, not truth.
- `equity_enriched/candidates` measures coverage only for preselected candidates. For a targeted
  diagnosis, also check whether every decision on the examined path has an `equityDiagnostic`. Add
  missing coverage at the mechanism or route, not through individual known hand families.
- Negative equity margin is not an automatic fold.
- Positive equity margin is not an automatic call.
- Position, realization, stack pressure, hand class and exploitability remain decisive.

## MDF / Overfold / Range Defense

For MDF or overfold leaks first distinguish:

### 1. Good Range, Wrong Decision

- Enough defendable hands are present.
- They fold too often despite price, position or hand quality.
- Lever: specific postflop defendability or call barrier.

### 2. Poor Range, Poor Arrival

- Many poor passive preflop routes or trash-heavy arrival.
- Loosening later would only create trash calls.
- Lever: upstream entry, call, limp or defense.

### 3. Good Hands, Poor Line

- Plausible hands arrive but are poorly handled through checks, calls, abandoned barrels or sizing.
- Lever: line continuation or pot geometry.

Preflop tightening is not a valid MDF fix if the backtrace shows overfolding spread broadly across hand
families and arising mainly from air, weak draws, overcards or blocker classification.

## Early Busts and Short Tournaments

Short winner-take-all tournaments are not automatically bad.

Early busts are leak candidates only when several signals occur together:

- Weak or dominated hand class
- Poor equity/pot-odds margin
- Bad position or second blind
- Wrong zone or unnecessary stack pressure
- Repeated pattern in an adequate sample

Strong hands, push-fold pressure and genuine coolers are not failures.

## Short-Handed Action

SB-HU and BTN-3 are action engines. They should create pressure.

Evaluate them as a system:

- Open frequency
- Blind defense
- Both blinds defend
- Flop seen
- Uncontested
- Showdown structure
- Early-bust effect

High combined BTN-3 blind defense is not automatically bad because two blinds can defend. SB defense
and second-blind entries need more discipline than BB closes at a good price.

## Candidate Gate

A candidate qualifies when:

- The sample size is sufficient.
- The cause is strategically plausible.
- The lever in `js/bot.js` can be represented by runtime signals.
- Equity/MDF/backtrace supports or does not contradict the hypothesis.
- Priced/playable hands in the same cluster remain protected.
- Core action engines do not dry up.
- No hard guardrail is endangered.

### Range Preservation Gate

For every tightening, show before evaluation which plausible hands will be played less often as a side
effect. The comparison must include at least:

- Target cluster and weak hands deliberately removed
- Protected neighboring hand families
- Strong control group
- Good and bad prices
- HU/MW and IP/OOP where relevant to the route

For every tightening, check which calls and raises disappear in the target spot and later lines. The goal
is to improve bot metrics while keeping the range defensible against plausible human bluffs.

- If tightening can weaken defense in a line recognizable to opponents, validate against an aggressive
  control profile that applies pressure in that line often enough.
- If plausible bluffcatchers or strong hands leave a check range, also test increased bluff frequency
  with the same value range and bet size.
- Set the tolerable reduction in the control field's chip value before the run
  ([setting up a comparison](#setting-up-a-comparison)).

Use MDF to find possible gaps. Evaluate continuations by price, betting sequence and chip value against
the tested value and bluff ranges. If too few defendable hands arrive, examine arrival and check-range
composition.

Core health and an improved target metric are not enough for acceptance. The candidate does not qualify
if protected priced/playable hands dry up substantially without equity, backtrace and range composition
supporting the loss.

For every loosening, apply the opposite check: first show which additional trash enters the range before
evaluating the desired increase in activity.

A candidate does not qualify if:

- It optimizes only one conspicuous number.
- The effect is probably noise.
- It needs direct equity in runtime logic.
- It requires broad new hard guards.
- It improves a target metric by moving the problem elsewhere.
- It disproportionately removes good calls or value aggression.

## Stop Criteria

Do not start another tuning pass when:

- Only one metric stands out and no example analysis confirms the same leak.
- The leak cannot be clustered along at least two independent dimensions, e.g. hand class + street,
  seat + route or price + board structure.
- The fix adds more conditions than strategic clarity.
- A local special lever affects only a very small share of hands, unless it fixes a hard guardrail error.
- The same leak has already produced two rejected candidates. First improve diagnosis, backtrace, equity
  or MDF analysis instead of adjusting thresholds further.
- Core health is stable and the notable examples are explainable in poker terms. Accept the state and
  stop perfecting it.

If a leak seems solvable only through several local exceptions, do not add another patch. Mark it as a
model gap and plan a more central lever.

These stop criteria prevent small symptom patches, not clean larger model levers. If diagnosis shows a
structural model gap, explicitly formulate the larger lever and validate it more broadly instead of
avoiding it out of caution.

## Hypothesis Before Code

Before each code change, briefly record:

- Target leak
- Suspected cause
- Affected route / hand class / position / street
- Runtime proxy
- Planned lever
- Expected effect
- Main side effects
- Falsification criteria

For range, call or defense tuning, also record in the candidate contract:

- Which hands or clusters should deliberately be played more or less often
- Which neighboring hand families must remain protected
- Which price, position and structure spots must remain protected
- Which shift falsifies the candidate regardless of the target metric

One pass = one cause, one focused lever.

## Good Levers

- Move an existing threshold slightly
- Adjust a ratio or cap based on context
- Change a small score weight
- Add a continuous term to an existing evaluation
- Distinguish hand classes more clearly
- Calibrate an existing barrier by route, position, street or structure

## Bad Levers

- Global OOP penalties
- Global suited penalties
- Global blind defense penalties
- Global permission to call with air
- Broad new hard guards
- Direct equity checks
- Multiple call, raise and sizing changes at once

## Validation Ladder

After a bot code change:

```bash
deno check js/bot.js
```

For range, call or defense tuning, before large batches also run a counterfactual audit on the comparison
baseline: which logged decisions would flip under the new lever, and from which hand families, price,
position and structure spots do those flips come?

Before the batch, also calculate the minimum, typical and maximum effect of the lever on the affected
score or barrier. Validate a large potential shift as a range cut, not as small fine-tuning.

Then validate in stages:

For each candidate, advance through the ladder only when the preceding gate passes. A candidate receives
each stage at most once. Only the final qualified candidate receives the 1000-run acceptance batch.

### 1. Structure Check

```bash
deno task engine:batch
```

### 2. Validation Stability

If the structure check is plausible:

```bash
deno task engine:batch:500
```

### 3. Validation Acceptance

If the 500-run batch is stable:

```bash
deno task engine:batch:1000
```

### 4. Equity When Needed

Equity is not an automatic step. An equity trigger exists if at least one of these applies:

- Call or range quality remains ambiguous after core, MDF and backtrace analysis.
- Priced/playable hands or other protected control groups decline substantially.
- High-equity folds or low-equity calls are a plausible part of the diagnosis.
- Existing metrics tell contradictory stories about the same target cluster.

First use a small suitable diagnostic batch from the diagnosis menu. Run a final 1000-run equity batch
only if the candidate still qualifies afterward but the question remains materially open for the live
candidate:

```bash
deno task engine:batch -- --runs=1000 --equity-preflop --equity-limit=3000
```

There is at most one final 1000-run equity batch per goal. Without a documented equity trigger, skip it.

## Validating Strategic Decisions

The core batch measures action mix, tournament flow and guardrails in standard-bot self-play. It is
required for changes to standard-bot behavior, including changes to shared logic. For opponent-profile
behavior, use the [profile comparison](#reviewing-and-developing-profiles). Replay compares decisions
in the target cluster. A matchup experiment tests whether a strategy's advantage holds against relevant
opponent profiles. Both methods apply to preflop ranges, calls, bluffs, value bets, sizing, line
continuations and push/fold.

- Use replay when action choice, bet size or range changes in the target cluster.
- Use a matchup experiment when different opponent responses can determine the benefit or side effects.
- Test a clearly bounded rule case or hard guardrail with a reproducible scenario and an appropriate
  batch for the changed strategy. If the fix also affects normal strategic spots, examine that effect
  with the appropriate comparisons.

Choose the metric according to the goal. For value sizing, chip value through the end of the hand in the
target spot may be decisive. For winner-take-all push/fold, win rate counts for tournament acceptance.
If the change affects which hands reach a spot, also examine its frequency and chip value per hand.

### Setting Up a Comparison

Select the target spot from [pattern discovery](#pattern-discovery-before-choosing-a-lever). The following
steps use that finding for replay and candidate comparison.

1. Before the candidate, establish the baseline, target spot, target profile and control profile. Record
   the gain at which the effect is relevant and the loss tolerated in the control profile. Plan the
   minimum number of tournament pairs and target spots per variant. Also freeze the opponent pool,
   comparison metric, and profiles and seeds reserved for acceptance.
2. Compare the same starting situations in replay. For attack, checking is the reference for an added bet.
   For defense, bet size and the opponent's value and bluff ranges remain fixed. For a sizing change,
   comparison starts before the bet. Replay measures chip value through the end of the hand.
3. In each opponent field, assign the existing strategy and the candidate in the experiment. The runner
   constructs both tables, pairs tournaments and reports the difference with a 95% interval. Reads develop
   during play. If needed, separately compare the effects of fresh and accumulated reads.
4. Check the finding on new seeds and an opponent profile not used in tuning. For joint acceptance,
   compare baseline, attack, defense and the combination in the same field. Also play the new attack
   against the new defense. For rollout, compare five old and five new bots each against the same profile
   seat.

The runner rotates roles and seeds cards and bot decisions separately. After different actions, the same
tournament runs may develop differently. Replay comparisons hold the starting spot directly fixed.

Acceptance proceeds in stages. Diagnosis locates the effect. Validation checks it against target and
control profiles. Holdout checks the frozen change. Rollout checks the table in its planned composition.
Acceptance evidence includes applicable guardrails and, for the standard bot, the core batch. Technical
interruptions and pot discrepancies block the affected experiment. The report identifies affected pairs.
[Configuration, metrics and status](./matchup-experiments.md)

### Opponent Pool

The opponent pool contains TAG, LAG, Calling Station and Nit. Profiles differ in the hands they play and
how aggressively they act on each street.
[PokerStars on the four playing styles](https://www.pokerstars.com/poker/learn/lesson/other-poker-playing-styles/) ·
[Jonathan Little on their characteristics](https://pokercoaching.com/blog/different-poker-players/)

For targeted diagnosis, vary one parameter, such as bluff frequency with the same value range and bet size.
For acceptance use the fixed pool with unchanged strategies. The reference to the regular bot in the
opponent field must also use the same fixed version for baseline and candidate.

#### Profile Playing Styles

Preflop, position, effective stack, bet size and prior actions determine ranges for open raises, limps,
calls and reraises. TAG and LAG open more hands in late position. LAG makes light 3-bets against late
opens more often. Calling Station enters many hands by limp or call. Nit plays a narrow range and defends
blinds selectively. [Preflop ranges in code](../matchupPreflop.js) ·
[Harrington on tournament play and styles](https://forumserver.twoplustwo.com/33/books-publications/harringtons-new-tourney-book-1410913/index2.html) ·
[Jonathan Little on position and stack depth](https://pokercoaching.com/blog/short-stack-vs-raise-how-to-adjust-your-preflop-strategy-in-mtts/) ·
[PokerStars on isolation raises](https://www.pokerstars.com/poker/learn/strategies/taking-advantage-of-poker-players-that-limp-preflop/)

Postflop, profiles evaluate the hand relative to the board, such as a private pair on a paired board.
Combo draws count shared outs once. Calls account for bet size, number of opponents and repeated pressure.
TAG bets selectively for value and as a semi-bluff. LAG barrels draws more often and bluffs selected river
runouts. Calling Station also calls with weaker pairs and draws. Nit gives up weak hands earlier and raises
strong hands selectively. [Postflop rules in code](../matchupPostflop.js) ·
[PokerStars on continuation bets](https://www.pokerstars.com/poker/learn/lesson/c-betting/) ·
[Jonathan Little on straight draws](https://pokercoaching.com/blog/open-ended-straight-draw-in-poker/) ·
[Ed Miller on situational aggression](https://www.cardplayer.com/poker-news-23577-poker-strategy-with-ed-miller-misplaced-aggression)

#### Reviewing and Developing Profiles

The shared tuning rule and intended styles are in the [profile strategies](../matchupPool.js). Preserving
the playing style takes precedence over better tournament results.

1. **Set the target spot and criteria.** Describe the suspected error, expected improvement and affected
   style characteristics. Before testing, set the required sample and tolerated deviation for each
   relevant style comparison.
2. **Check the decision in replay.** Compare the existing action and alternative from the same starting
   situations. Also count how often the spot occurs in tournaments.
3. **Change one lever in the profile and test it paired.** Compare the old and new profile versions with
   `engine:experiment` on the same rotating test seat. Both arms use the same frozen opponent strategies
   and seeds. Check the target spot and tournament side effects. For winner-take-all push/fold, tournament
   win rate is part of acceptance.
4. **Check style in comparable spots.** Use the same hands, positions, effective stacks and betting
   sequences. Compare with a fixed, accepted style reference for the profile and relevant other profiles.
   Use fixed test scenarios or replays with identical seeds. Keep the style reference fixed across
   multiple tuning passes to detect gradual convergence.
5. **Confirm the finding before acceptance.** Test the frozen change with fresh seeds in another relevant
   opponent field and at the table in its planned composition. Acceptance requires the agreed improvement
   and passed style checks.

| Profile | Typical style check |
| --- | --- |
| TAG | Check whether the opening range widens from early to late position. Check value bets, selective semi-bluffs and lower aggression than LAG in comparable postflop spots. |
| LAG | Against TAG, check wider opens, more frequent light 3-bets against late opens, and more frequent semi-bluff continuations with suitable draws. |
| Calling Station | At the same price and hand class, check for more calls with middle pairs and draws than TAG. Separately check that raises are predominantly clear value hands. |
| Nit | At a full table, check tighter early opens than TAG and selective defense against pressure. Check short-stack steals and calls in spots where Nit is deliberately allowed to play wider. |

For each field, document opportunity counts and action frequency. Examine preflop position, stack depth
and preceding action. Examine postflop street, initiative, hand class and bet size. Use VPIP, PFR and
action rates by street as an overview. Comparing with human frequencies requires hand histories from
comparable spots.

Check rare lines with fixed test scenarios. Use replays to compare different decisions at the same
starting spot. If needed, use a deliberately weakened bot variant to test whether the profile reproducibly
converts the built-in error in the target spot into chip gain.
[Matchup tests](../matchupBatch.test.js) · [Replay](../matchupReplay.js)

Develop a profile further if it plays a relevant line too rarely or too simply despite sufficient
opportunities, or if the control run barely exposes a known weakness. Add an opponent type if the pool
lacks a playing style relevant to the test question.

Document the target behavior, measurement and pool configuration used.

### Runner and Evaluation

```bash
deno task engine:matchup scripts/matchupPool.js tmp/matchup-pool.json
deno task engine:matchup scripts/matchupBaseline.js tmp/matchup-river-diagnosis.json
deno task engine:experiment scripts/matchupAudit.js tmp/matchup-audit.json
deno task engine:replay scripts/matchupReplayAudit.js tmp/matchup-replay-audit.json
```

The pool configuration includes self-play as reference, a mixed table with five different opponents and
a variant with more aggressive opponents. The second configuration contains targeted river profiles for
diagnosis. For a candidate, create a separate configuration under `tmp/` with fixed strategy versions.
`strategies` maps names to functions with signature `(player, state, line) => action`. Batch and replay
derive `line` from executed actions. `flop` and `turn` contain the seat number of the last aggressor on
the respective completed street, or `null` without an aggressor. `lineups` assigns named seat roles to
these strategies. All lineups use the same role names. Profiles decide using publicly visible information
and their own cards. An optional `classifySpot(state, player, role, line)` function names the target spot
before the action or returns `null`.

For each run and role, the report contains hands played, tournament wins, net BB, VPIP and PFR. For VPIP
and PFR, divide the respective hand counts by hands played. For marked spots, it contains the count and
net BB from the decision for each action actually taken. Divide the sum by the spot count. Chips already
invested count toward the pot. If spot frequency changes, also check net BB per hand played. For attack,
also report the value of added bluffs versus checking from replay. MDF helps diagnose frequencies. For
acceptance, the agreed chip-value comparison and applicable guardrails count.

## Hard Guardrails

These values must not break:

- premium preflop folds = 0
- bluff raises with made hand = 0
- postflop all-in low-edge reraises = 0

These areas must not clearly regress:

- low-edge reraises
- early large pots and early-bust clusters
- showdown / uncontested structure
- preflop and postflop action mix
- SB-HU action engine
- BTN-3 action engine
- BB defense at a good price
- value betting and value raising
- priced/playable calls in the target cluster

## Acceptance

Accept a candidate only when:

- The target cause was plausibly improved.
- The target metric improved against the comparison baseline.
- Core health stays stable for standard-bot changes.
- Guardrails remain clean.
- Equity/MDF/backtrace does not contradict the result.
- Agreed replay and matchup criteria for the strategic intervention are met.
- For opponent profiles, agreed style checks pass.
- Improvement does not come from trash calls, spew or shifting the problem.
- The bot plays more plausibly as a whole.

The core batch checks standard-bot stability in self-play. Strategic acceptance additionally requires
the evidence agreed for the candidate. If an equity trigger is documented, `accepted` may only be
assigned after the required equity check.

Reject or revise when:

- The improvement is only local and not strategically plausible.
- Related metrics clearly worsen.
- Good/priced/playable hands disappear disproportionately.
- Damage moves to another street, line or hand class.
- The lever only makes a metric look cleaner.

## Final Report

Report briefly:

- Comparison baseline and path
- Diagnosis and target leak
- Hypothesis
- Changed lever
- Important metrics before/after
- Target cluster and protected controls before/after
- Counterfactual flips by hand family, price, position and structure where relevant
- Equity result if used
- Guardrail status
- Candidate decision: `accepted` or `rejected` if a candidate was tested
- Goal completion: `accepted` or `no-qualified-candidate`

If `accepted`:

- Keep only accepted changes.
- Remove failed experiments.
- Retain relevant tmp batches for traceability.
- When going live, update the version entry and service worker version.

If `rejected`:

- Remove candidate code.
- Briefly explain the failure.
- Name the next diagnosis question.
- For a rejected qualified iteration, add a short learning report in `scripts/docs/bot-tuning-learnings.md`.

## Learning Reports

A learning report is an anti-repetition log for Codex, not a long report. Write one after every rejected
qualified iteration: a plausible hypothesis tested with staged validation and subsequently rejected.

Keep it short:

- Date and candidate
- Hypothesis
- Lever tested
- Main validation
- Why rejected
- When the route may be tried again

Do not record:

- Pure noise observations
- Abandoned unqualified ideas
- Obvious syntax or implementation errors without strategic learning
