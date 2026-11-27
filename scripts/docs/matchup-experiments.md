# Matchup Experiments

The experiment runner compares strategy versions against the same opponents. It handles seat rotation,
seed pairing, evaluation and minimum sample requirements. The [Bot Tuning Playbook](./bot-tuning-playbook.md)
describes when the result contributes to acceptance.

## Combined Pattern Discovery

```powershell
deno task engine:diagnose -- --runs=1000 --out=tmp/matchup-discovery
```

The runner uses the reference field and mixed table from the opponent pool. It rotates the test seat and
pairs fields by seed. Choose a new output directory for each run.

- `summary.json` compares both fields for each spot. Sections group by street and decision situation,
  and by hand class, position, line, bet size or opponent profile. Each field includes spot count, spots
  per 100 hands played, action frequencies and observed net BB from the decision. All-in calls and
  all-in raises have separate action counts. `mixedMinusReferenceBb` is the observed difference per spot.
- `decisions.jsonl.gz` contains decisions from the test seat. The first JSONL line names the columns of
  the arrays that follow. Cards are concatenated two-character codes. `field`, `run`, `seed`, `handId`
  and `decisionId` identify the observation. `netChipsFromDecision` contains chip value from the decision;
  divide it by `bigBlind` for BB. The archive is compressed per tournament pair as it is written.

`line` includes the preflop pot type, the bot's role as preflop aggressor and the number of streets
checked through. `betSize` uses the core report's bet size buckets. The archive also contains the pot,
call amount and executed bet size in chips.

By default, a group appears in the report at 20 decisions in at least one field. `--min-spots` sets this
threshold for the summary. Archive rows remain individually available for analysis. Sections group the
same decisions from different perspectives. If a tournament aborts or settles a pot incorrectly, the
runner marks both partners' rows `included: false` and lists the pair under `excludedPairs`. The summary
counts valid pairs. Observed chip value is a clue for pattern discovery. A replay can then assess the
value of an alternative action from the same spot.

## Variants and Opponent Fields

An experiment file exports configuration as a JavaScript object. The [A/A audit](../matchupAudit.js)
is an executable structural template.

| Field | Contents |
| --- | --- |
| `name`, `stage` | Name and stage `diagnosis`, `validation`, `holdout` or `rollout`. |
| `seed`, `runs` | Fixed seed and number of tournaments per field and variant. |
| `fields` | Opponent fields. Each names the same roles and assigns fixed strategies to them. |
| `strategies`, `strategyVersions` | Strategy functions and their versions. For comparisons use fixed source snapshots or commit IDs in the version field. |
| `variants` | Roles to override per variant. An empty variant inherits the entire field. |
| `comparisons` | Comparison ID, field, baseline variant and candidate. `role` identifies the measured seat; default `test`. |
| `classifySpot`, `spot` | Optional name of a target spot captured before the action. |

In a typical A/B comparison, baseline and candidate override only the test seat. A cross-comparison can
also include a fixed test seat for the other lever in the opponent field. For rollout, the variants
override the five bot seats. The human test opponent remains fixed in the field. The runner executes
each used field and variant combination once. An acceptance configuration uses fixed versions in all
arms. The report records the specified version IDs and the configuration file's SHA-256.

The A/A audit should show exactly zero difference for valid tournament pairs. It uses the current strategy
in both arms. In this audit the result is used only to check infrastructure.

```powershell
deno task engine:experiment scripts/matchupAudit.js tmp/matchup-audit.json
```

## Replay from the Same Starting Spot

Replay collects decisions from baseline hands. `select(state, player, role, action)` returns the target
spot name or `null` after action selection and before execution. The configuration specifies an opponent
`field` and the `alternatives` to examine. Each alternative names a strategy from `strategies`; it takes
over the selected seat from the target spot for the rest of the hand. All other seats keep their strategy
and respond to the changed line.

For each alternative, the runner resets the hand with the same deck and player state. It checks actions
up to the branch and the state at the target spot, then the engine plays through payout. This allows a
turn call and its subsequent river costs to be compared. Strategies use only the acting seat's game
information and their respective in-state memory.

The report includes cards and pot at the decision, the action taken and net BB through the end of the
hand. The 95% interval resamples whole tournaments, keeping multiple spots from the same hand or
tournament together. Replay findings apply to the baseline's starting situations. The subsequent matchup
batch shows which situations actually arise with the candidate in tournaments.

```powershell
deno task engine:replay scripts/matchupReplayAudit.js tmp/matchup-replay-audit.json
```

## Metrics and Acceptance Criteria

Delta is candidate minus baseline. `bbPerHand` refers to hands played by the role. `bbPerSpot` refers to
marked decisions, with chip value measured from the decision to the end of the hand. `winRate` is the
share of tournaments won. The first two metrics weight each hand or spot equally.

If a variant changes the number of marked spots, compare both the count and `bbPerHand`. The spot average
applies to decisions that actually occurred. To measure the direct value of a specific action, use replay
from the same starting spot.

A criterion defines a metric, minimum delta, minimum number of tournament pairs with observations per arm,
and optionally a minimum number of observations per arm. For control fields, a tolerable loss can be
entered as a negative minimum delta. Win rates are proportions: for example, 0.02 is two percentage points.

```js
criteria: [
    { metric: "bbPerSpot", minDelta: 0.10, minPairs: 100, minObservations: 200 },
    { metric: "bbPerHand", minDelta: -0.02, minPairs: 100 },
];
```

These values are illustrative. Set thresholds for the specific experiment before running it. For the
95% interval the runner draws 2,000 samples of whole tournament pairs. Criteria are evaluated per
comparison. With multiple comparisons, the interval is per metric and comparison.

| Status | Meaning |
| --- | --- |
| `pass` | The entire interval is at or above the predefined threshold. |
| `fail` | The entire interval is below the threshold. |
| `inconclusive` | The interval crosses the threshold. |
| `insufficient` | Too few pairs or observations, or no calculable interval. |
| `blocked` | At least one arm has an invalid pot or a tournament at the hand limit. |
| `descriptive` | Comparison without an acceptance criterion. |

An invalid run and its partners are excluded from the delta. Raw values and the reason remain visible in
JSON. The comparison is `blocked` even if the remaining pairs reach the threshold. The CLI writes the
report and exits with code 1 for a blocked run. Holdout and rollout also require `pass` for exit code 0.

## Attack and Defense Together

A comparison with `attack` and `defense` in addition to `baseline` and `candidate` uses four variants.
The candidate is the combination. The reported delta is `(combination − attack) − (defense − baseline)`,
in the same field. It shows how much the defense effect depends on the attack also being active. Use a
normal comparison of the combination against baseline to measure the joint effect.
