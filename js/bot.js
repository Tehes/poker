/* 
 * bot.js
 * 
 * Implements the poker bot's decision-making logic, including hand evaluation,
 * action selection based on game context, and managing delayed execution of bot actions.
 */

/* ===========================
   Configuration
========================== */
// Configuration constants
// Delay in milliseconds between enqueued bot actions
export const BOT_ACTION_DELAY = 1500;

// Enable verbose logging of bot decisions
const DEBUG_DECISIONS = true;
// Maximum number of raises allowed per betting round
const MAX_RAISES_PER_ROUND = 3;
// Tie-breaker thresholds for close decisions
const STRENGTH_TIE_DELTA = 0.25; // Threshold for treating strength close to the raise threshold as a tie
const ODDS_TIE_DELTA = 0.02;     // Threshold for treating pot odds close to expected value as a tie
// Opponent-aware aggression tuning
const OPPONENT_THRESHOLD = 3;    // Consider "few" opponents when fewer than this
const AGG_FACTOR = 0.1;          // Aggressiveness increase per missing opponent
// Lower raise threshold slightly as opponents drop out; using a small factor so
// heads-up play only reduces it by ~0.6
const THRESHOLD_FACTOR = 0.3;
// Minimum average hands before opponent stats influence the bot
const MIN_HANDS_FOR_WEIGHT = 10;
// Controls how quickly stat influence grows as more hands are played
const WEIGHT_GROWTH = 10;
// Detect opponents that shove frequently
const ALL_IN_FREQ_THRESHOLD = 0.3;
const GOOD_HAND_PREFLOP = 0.9;
const GOOD_HAND_POSTFLOP = 0.6;

const botActionQueue = [];
let processingBotActions = false;

/* ===========================
   Action Queue Management
========================== */
// Task queue management: enqueue bot actions for delayed execution
export function enqueueBotAction(fn) {
    botActionQueue.push(fn);
    if (!processingBotActions) {
        processingBotActions = true;
        setTimeout(processBotQueue, BOT_ACTION_DELAY);
    }
}

// Execute queued actions at fixed intervals
function processBotQueue() {
    if (botActionQueue.length === 0) {
        processingBotActions = false;
        return;
    }
    const fn = botActionQueue.shift();
    fn();
    if (botActionQueue.length > 0) {
        setTimeout(processBotQueue, BOT_ACTION_DELAY);
    } else {
        processingBotActions = false;
    }
}

/* ===========================
   Logging and Utilities
========================== */
// Debug logging: prints decision details when enabled
function logDecision(msg) {
    if (DEBUG_DECISIONS) console.log(msg);
}

// Card display utilities
// Map suit codes to their Unicode symbols
const SUIT_SYMBOLS = { C: "♣", D: "♦", H: "♥", S: "♠" };
// Convert internal card code to human-readable symbol string
function formatCard(code) {
    return code[0].replace("T", "10") + SUIT_SYMBOLS[code[1]];
}

// Numeric utility: round to nearest multiple of 10
function roundTo10(x) {
    return Math.round(x / 10) * 10;
}

// Calculate how often a player folds
function calcFoldRate(p) {
    return p.stats.hands > 0 ? p.stats.folds / p.stats.hands : 0;
}

// Average fold rate across a set of opponents
function avgFoldRate(opponents) {
    if (opponents.length === 0) return 0;
    return opponents.reduce((s, p) => s + calcFoldRate(p), 0) / opponents.length;
}

/* ===========================
   Preflop Hand Evaluation
========================== */
// Preflop hand evaluation using simplified Chen formula
function preflopHandScore(cardA, cardB) {
    const order = "23456789TJQKA";
    const base = { A: 10, K: 8, Q: 7, J: 6, T: 5, "9": 4.5, "8": 4, "7": 3.5, "6": 3, "5": 2.5, "4": 2, "3": 1.5, "2": 1 };

    let r1 = cardA[0];
    let r2 = cardB[0];
    let s1 = cardA[1];
    let s2 = cardB[1];

    let i1 = order.indexOf(r1);
    let i2 = order.indexOf(r2);
    if (i1 < i2) {
        [r1, r2] = [r2, r1];
        [s1, s2] = [s2, s1];
        [i1, i2] = [i2, i1];
    }

    let score = base[r1];
    if (r1 === r2) {
        score *= 2;
        if (score < 5) score = 5;
    }

    if (s1 === s2) score += 2;

    const gap = i1 - i2 - 1;
    if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap >= 4) score -= 5;

    if (gap <= 1 && i1 < order.indexOf("Q")) score += 1;

    if (score < 0) score = 0;

    return Math.min(10, score);
}

/* ===========================
   Decision Engine: Bot Action Selection
========================== */
export function chooseBotAction(player, ctx) {
    const { currentBet, pot, smallBlind, bigBlind, raisesThisRound, currentPhaseIndex, players } = ctx;
    // Determine amount needed to call the current bet
    const needToCall = currentBet - player.roundBet;

    // Calculate pot odds to assess call viability
    const potOdds = needToCall / (pot + needToCall);
    // Compute risk as fraction of stack required
    const stackRatio = needToCall / player.chips;
    const blindLevel = { small: smallBlind, big: bigBlind };
    // Check if bot is allowed to raise this round
    const canRaise = raisesThisRound < MAX_RAISES_PER_ROUND && player.chips > blindLevel.big;

    // Compute positional factor dynamically based on active players
    const active = players.filter(p => !p.folded);
    // Number of opponents still in the hand
    const activeOpponents = active.length - 1;

    // Helper: find the next active player after the given index
    function nextActive(startIdx) {
        for (let i = 1; i <= players.length; i++) {
            const idx = (startIdx + i) % players.length;
            if (!players[idx].folded) return players[idx];
        }
        return players[startIdx];
    }

    const seatIdx = active.indexOf(player);
    const firstToAct = currentPhaseIndex === 0
        ? nextActive(players.findIndex(p => p.bigBlind))
        : nextActive(players.findIndex(p => p.dealer));
    const refIdx = active.indexOf(firstToAct);

    const pos = (seatIdx - refIdx + active.length) % active.length;
    const positionFactor = active.length > 1 ? pos / (active.length - 1) : 0;

    // Collect community cards from the board
    const communityCards = Array.from(
        document.querySelectorAll("#community-cards .cardslot img")
    ).map(img => {
        const m = img.src.match(/\/cards\/([2-9TJQKA][CDHS])\.svg$/);
        return m ? m[1] : null;
    }).filter(Boolean);

    // Determine if we are in pre-flop stage
    const preflop = communityCards.length === 0;

    // Evaluate hand strength
    let strength;
    if (preflop) {
        strength = preflopHandScore(player.cards[0].dataset.value, player.cards[1].dataset.value);
    } else {
        const cards = [
            player.cards[0].dataset.value,
            player.cards[1].dataset.value,
            ...communityCards
        ];
        strength = Hand.solve(cards).rank;
    }

    // Normalize strength to [0,1]
    const strengthRatio = strength / 10;

    // Calculate dynamic thresholds for raising
    const raiseBase = preflop
        ? Math.max(blindLevel.big * (strength >= 8 ? 3 : 2), pot / 2)
        : Math.max(blindLevel.big * 2, pot * 0.6);
    // When only a few opponents remain, play slightly more aggressively
    const oppAggAdj =
        activeOpponents < OPPONENT_THRESHOLD
            ? (OPPONENT_THRESHOLD - activeOpponents) * AGG_FACTOR
            : 0;
    const thresholdAdj =
        activeOpponents < OPPONENT_THRESHOLD
            ? (OPPONENT_THRESHOLD - activeOpponents) * THRESHOLD_FACTOR
            : 0;
    let aggressiveness = (preflop
        ? 0.8 + 0.4 * positionFactor
        : 1 + 0.6 * positionFactor) + oppAggAdj;
    let raiseThreshold = preflop
        ? 8 - 2 * positionFactor
        : Math.max(2, 4 - 2 * positionFactor);
    raiseThreshold = Math.max(1, raiseThreshold - thresholdAdj);
    let bluffChance = 0;

    // Adjust based on observed opponent tendencies
    const opponents = players.filter(p => p !== player);
    const allInAggressor = opponents.find(p =>
        p.allIn &&
        p.stats.hands >= MIN_HANDS_FOR_WEIGHT &&
        p.stats.allins / p.stats.hands >= ALL_IN_FREQ_THRESHOLD
    );
    const facingShove = Boolean(allInAggressor);
    if (opponents.length > 0) {
        const avgVPIP =
            opponents.reduce((s, p) => s + (p.stats.vpip + 1) / (p.stats.hands + 2), 0) /
            opponents.length;
        const avgAgg =
            opponents.reduce((s, p) => s + (p.stats.aggressiveActs + 1) / (p.stats.calls + 1), 0) /
            opponents.length;
        const foldRate = avgFoldRate(opponents);

        // Weight adjustments by average hands played to avoid overreacting in early rounds
        const avgHands = opponents.reduce((s, p) => s + p.stats.hands, 0) / opponents.length;
        const weight =
            avgHands < MIN_HANDS_FOR_WEIGHT
                ? 0
                : 1 - Math.exp(-(avgHands - MIN_HANDS_FOR_WEIGHT) / WEIGHT_GROWTH);
        bluffChance = Math.min(0.3, foldRate) * weight;

        if (avgVPIP < 0.25) {
            raiseThreshold -= 0.5 * weight;
            aggressiveness += 0.1 * weight;
        } else if (avgVPIP > 0.5) {
            raiseThreshold += 0.5 * weight;
            aggressiveness -= 0.1 * weight;
        }

        if (avgAgg > 1.5) {
            aggressiveness -= 0.1 * weight;
        } else if (avgAgg < 0.7) {
            aggressiveness += 0.1 * weight;
        }
    }

    /* -------------------------
       Decision logic with tie-breakers
    ------------------------- */
    /* Tie-breaker explanation:
       - When the difference between hand strength and the raise threshold is within STRENGTH_TIE_DELTA,
         the bot randomly chooses between the two close options to introduce unpredictability.
       - Similarly, when the difference between (strengthRatio * aggressiveness) and potOdds is within ODDS_TIE_DELTA,
         the bot randomly resolves between call and fold to break ties.
     */
    let decision;

    if (needToCall <= 0) {
        if (canRaise && strength >= raiseThreshold) {
            let raiseAmt = Math.min(
                player.chips,
                Math.max(currentBet + blindLevel.big, raiseBase * (1 + positionFactor * 0.5))
            );
            raiseAmt = Math.min(player.chips, roundTo10(raiseAmt));
            // Strength tie-breaker:
            // When hand strength is within STRENGTH_TIE_DELTA of the raise threshold,
            // randomly choose between 'check' and 'raise' to break ties.
            if (Math.abs(strength - raiseThreshold) <= STRENGTH_TIE_DELTA) {
                decision = Math.random() < 0.5
                    ? { action: "check" }
                    : { action: "raise", amount: raiseAmt };
            } else {
                decision = { action: "raise", amount: raiseAmt };
            }
        } else {
            decision = { action: "check" };
        }
    } else if (canRaise && strength >= raiseThreshold && stackRatio <= 1 / 3) {
        let raiseAmt = Math.min(
            player.chips,
            Math.max(currentBet + blindLevel.big, raiseBase * (1 + positionFactor * 0.5))
        );
        raiseAmt = Math.min(player.chips, roundTo10(raiseAmt));
        // Raise vs. alternative tie-breaker:
        // When strength is near the threshold in this branch,
        // randomly choose between 'raise' and the alternative (call or fold).
        if (Math.abs(strength - raiseThreshold) <= STRENGTH_TIE_DELTA) {
            const callAmt = Math.min(player.chips, needToCall);
            const alt = (strengthRatio * aggressiveness >= potOdds && stackRatio <= (preflop ? 0.5 : 0.7))
                ? { action: "call", amount: callAmt }
                : { action: "fold" };
            decision = Math.random() < 0.5
                ? { action: "raise", amount: raiseAmt }
                : alt;
        } else {
            decision = { action: "raise", amount: raiseAmt };
        }
    } else if (strengthRatio * aggressiveness >= potOdds && stackRatio <= (preflop ? 0.5 : 0.7)) {
        const callAmt = Math.min(player.chips, needToCall);
        // Odds tie-breaker:
        // When adjusted strength (strengthRatio * aggressiveness) is within ODDS_TIE_DELTA of pot odds,
        // randomly decide between 'call' and 'fold' to break ties.
        if (Math.abs(strengthRatio * aggressiveness - potOdds) <= ODDS_TIE_DELTA) {
            decision = Math.random() < 0.5
                ? { action: "call", amount: callAmt }
                : { action: "fold" };
        } else {
            decision = { action: "call", amount: callAmt };
        }
    } else {
        decision = { action: "fold" };
    }

    // If facing an all-in from a shove-happy opponent, do not fold
    if (decision.action === "fold" && facingShove) {
        const goodThreshold = preflop ? GOOD_HAND_PREFLOP : GOOD_HAND_POSTFLOP;
        if (strengthRatio >= goodThreshold) {
            decision = { action: "call", amount: Math.min(player.chips, needToCall) };
        }
    }

    let isBluff = false;
    if (bluffChance > 0 && canRaise && (decision.action === "check" || decision.action === "fold")) {
        if (Math.random() < bluffChance) {
            const bluffAmt = Math.min(
                player.chips,
                Math.max(currentBet + blindLevel.big, blindLevel.big * 2)
            );
            decision = { action: "raise", amount: roundTo10(bluffAmt) };
            isBluff = true;
        }
    }

    const h1 = formatCard(player.cards[0].dataset.value);
    const h2 = formatCard(player.cards[1].dataset.value);
    const handName = !preflop ? Hand.solve([
        player.cards[0].dataset.value,
        player.cards[1].dataset.value,
        ...communityCards
    ]).name : "preflop";

    // Map aggressiveness to an emoji for logging
    let aggrEmoji;
    if (aggressiveness >= 1.5) aggrEmoji = '🔥';
    else if (aggressiveness >= 1.2) aggrEmoji = '⚡';
    else if (aggressiveness >= 1.0) aggrEmoji = '👌';
    else if (aggressiveness >= 0.8) aggrEmoji = '🐌';
    else aggrEmoji = '❄️';

    console.table([{
        Player: player.name,
        Cards: `${h1} ${h2}`,
        Hand: handName,
        Strength: strengthRatio.toFixed(2),
        PotOdds: potOdds.toFixed(2),
        StackRatio: stackRatio.toFixed(2),
        Position: positionFactor.toFixed(2),
        Opponents: activeOpponents,
        RaiseThreshold: (raiseThreshold / 10).toFixed(2),
        Aggressiveness: aggressiveness.toFixed(2),
        Emoji: aggrEmoji,
        Action: decision.action,
        Bluff: isBluff
    }]);

    return decision;
}
