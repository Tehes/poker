# Bot Tuning Backlog

This backlog collects open strategic hypotheses and topics for investigation, not binding tasks or
proven leaks. Assess relevance and profitability according to the [Bot Tuning Playbook](./bot-tuning-playbook.md),
using the existing [learnings](./bot-tuning-learnings.md) as a starting point. Priorities are provisional.
Add new hypotheses, remove disproven or completed topics, and record relevant findings in the learnings.

## High Priority

### Pot Odds for Short All-in Calls

The bot calculates pot odds using the full amount needed to match the bet and the total pot. A short
stack can call less and may only be eligible for part of that pot. Determine the actual call amount and
contestable pot, including eligible contributions from folded players, and examine how often the
difference changes decisions. Compare affected folds and calls by hand strength, price and pot structure,
including multiway all-ins and side pots.

### Effective Stack Depth in Heads-up Play

The bot tracks effective stack depth, while its preflop Harrington zone is based on its own stack. In
heads-up play, investigate whether this leads to weaker decisions when the bot covers a short opponent.
Compare the same hands and effective depths from both stack perspectives, including opens, limps, shoves
and calls. Use published heads-up push/fold ranges as a reference for short stacks, and compare the chip
value of available actions against relevant opponent responses. Preserve profitable alternatives to shoving.

### Exploitability by Above-Average Aggression

Higher overfolding was accepted when adjusting weak turn calls. Whether aggressive opponents can
systematically profit from it remains open. The goal is to determine whether increased bluff frequencies
win above-average chips against the bots. Which streets, betting lines and bet sizes are vulnerable,
does opponent adaptation respond sufficiently, and at what aggression level do additional bluffs
become unprofitable? Evaluate profitability including losses from failed bluffs; a high fold rate alone
does not establish a leak.

### Thin River Value Bets

The bot can bet medium-strength made hands when checked to. Whether those bets earn more than checking
against different opponents remains open. In the November 25 discovery run, the test bot bet second
pair in position heads-up on the river in 83 of 87 free-action spots across the reference and mixed
fields. This is a small sample from an earlier bot version and does not establish profitability.

Compare betting at the existing size with checking from the same starting spots. Which worse hands call,
which better hands fold, and what do raises cost? Examine the results by opponent profile, board texture
and prior line, including calling stations and tighter opponents. Measure chip value and spot frequency,
and protect profitable value bets when considering any adjustment.

### Adaptive Bluffcatching Frequency

For certain weak hands, the bot already adjusts its call barrier based on the aggressor's aggression
and showdown results. These signals alone do not establish bluff frequency. Whether they reliably
identify frequent bluffers and trigger an adjustment quickly and strongly enough remains open. The goal
is profitable opponent-specific defense rather than a blanket increase in calls. Are profitable
bluffcatchers folded too often against frequent bluffers, and does adaptation lead to unprofitable calls
against aggressive but predominantly value-oriented opponents? Examine differences by street, bet size,
hand quality and prior betting line, as well as the number of available observations.

### Cross-Street Hand Planning

The preflop aggressor already plans a continuation bet and, after a flop bet, a possible turn barrel;
board texture, hand strength and opponent data are considered. Whether this limited line memory supports
sufficiently coherent planning through the river is open. The goal is coherent betting lines that react
to new community cards and actions. How do runouts change the prior line, estimated ranges and profitable
continuations? An earlier examination of a specific river line found no reliable incremental benefit over
hand strength and price; reopening that route requires new evidence.

### Profitable Follow-up Bluffs

`nonValueAggressionMade` restricts certain follow-up actions marked as bluffs or stabs; it does not block
every later aggressive action or semi-bluff. This protects against uncontrolled, isolated follow-up
bluffs, but could prevent profitable continuations. The goal is to preserve that protection and identify
profitable lines. Is the restriction still necessary in its current form alongside today's street planning,
and under what conditions are double and triple barrels profitable compared with checking?

### Blocker-Based Board Risk Assessment

`evaluateBoardTexture()` assesses connectedness, suits and pairing from the board alone. The rest of the
postflop evaluation already considers hole cards elsewhere; whether board risk itself is sufficiently
interpreted in their context is open. The goal is a more precise assessment of opponent threats, not a
general reduction in defensive play.

Should objective board texture be distinguished from individual risk? What difference do flush blockers
on boards with three or four cards of a suit, straight blockers on connected boards, and full-house and
quads blockers on paired boards make? Examine blocker quality too, such as an ace versus a low card of
the same suit. When do blockers and unblockers also help select bluff and bluffcatch candidates?
Profitability and potential effects on defense must be established according to the playbook.

## Medium Priority

### Squeeze Hand Selection

The bot recognizes a preflop raise followed by callers and adjusts its 3-bet size. Whether it selects
profitable squeeze hands across different opener positions, caller ranges and stack depths remains open.
First measure spot frequency, then compare squeezing with calling or folding from the same starting spots.
Examine folds, calls by worse hands, 4-bets and chip value across relevant opponent profiles while
protecting value raises and playable calls.

### Strategic Knowledge Transfer from Opponent Profiles

TAG, LAG, Nit and Calling Station use profile-specific decision heuristics; attacks can consider blockers,
new board cards and missed draws. Whether the standard bot consequently lacks profitable capabilities is
open. The goal is to identify suitable insights without changing its strategic direction. How do bluff
candidate selection and cross-street attacking lines differ, and which heuristics are profitable under
which conditions and transferable to the standard bot?

### Draw Quality

The existing draw evaluation counts potential flush and straight outs, counting shared outs only once;
whether they win against opponents' hands is not established. The goal is an evaluation suited to the
price and situation without losing strong draws that should be protected. Where do nominal versus truly
winning outs, nut and dominated draws, and public draws make a relevant difference to decisions and chip
value?

### Situational Opponent Adaptation

The bot already uses weighted general opponent data and a situational read for big-blind folds to steals.
For narrower postflop situations, these data need to be sufficiently reliable and informative beyond
public context. The goal is profitable adaptation to different opponents. Which existing statistics
actually help on which street, decision and betting line, and are the observation counts sufficient?

## Low Priority

### Bet Sizing

Postflop, the bot uses standardized bet sizes selected by intent and context, with stack caps; whether
their distribution is exploitable is unknown. The goal is profitable sizing and appropriate value and
bluff ranges. In which situations do more variable sizes, particularly overbets or more overlap between
value and bluff sizes, provide an advantage over existing sizes against relevant opponent responses?
