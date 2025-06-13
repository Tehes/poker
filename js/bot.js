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
const ALLIN_HAND_PREFLOP = 0.85;
const ALLIN_HAND_POSTFLOP = 0.5;

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

/* -----------------------------
   Post-flop Board Evaluation
----------------------------- */

// Determine if the two hole cards form a pocket pair
function isPocketPair(hole) {
    return new Card(hole[0]).rank === new Card(hole[1]).rank;
}

// Analyze hand context using pokersolver. Returns whether the bot has
// top pair (pair made with the highest board card) or over pair (pocket
// pair higher than any board card).
function analyzeHandContext(hole, board) {
    const hand = Hand.solve([...hole, ...board]);

    const boardRanks = board.map(c => new Card(c).rank);
    const highestBoard = Math.max(...boardRanks);
    const pocketPair = isPocketPair(hole);

    let isTopPair = false;
    let isOverPair = false;

    if (hand.name === 'Pair') {
        const pairRank = hand.cards[0].rank;
        isTopPair = pairRank === highestBoard;
        isOverPair = pocketPair && pairRank > highestBoard;
    }

    return { isTopPair, isOverPair };
}

// Detect draw potential after the flop. Straight draws should not trigger when
// a made straight already exists.
function analyzeDrawPotential(hole, board) {
    const allCards = [...hole, ...board];

    const draws = {
        flushDraw: false,
        straightDraw: false,
        outs: 0
    };

    // Count suits for flush draws
    const suits = {};
    allCards.forEach(c => {
        const suit = c[1];
        suits[suit] = (suits[suit] || 0) + 1;
    });
    const suitCounts = Object.values(suits);
    const hasFlush = suitCounts.some(c => c >= 5);
    if (!hasFlush) {
        draws.flushDraw = suitCounts.some(c => c === 4);
    }

    // Straight draw check
    const ranks = allCards.map(c => new Card(c).rank);
    if (ranks.includes(14)) ranks.push(1); // allow A-2-3-4-5
    const unique = [...new Set(ranks)].sort((a, b) => a - b);

    const straights = [];
    for (let start = 1; start <= 10; start++) {
        straights.push([start, start + 1, start + 2, start + 3, start + 4]);
    }
    for (const seq of straights) {
        const count = seq.filter(r => unique.includes(r)).length;
        if (count === 5) {
            // Already a straight; no draw
            draws.straightDraw = false;
            break;
        }
        if (count === 4) {
            draws.straightDraw = true;
            break;
        }
    }

    return draws;
}

// Evaluate board "texture" based on connectedness, suitedness and pairing.
// Returns a number between 0 (dry) and 1 (very wet).
function evaluateBoardTexture(board) {
    if (!board || board.length < 3) return 0;

    const rankMap = {
        '2': 2, '3': 3, '4': 4, '5': 5, '6': 6,
        '7': 7, '8': 8, '9': 9, 'T': 10,
        'J': 11, 'Q': 12, 'K': 13, 'A': 14
    };
    const suitMap = { '♣': 'C', '♦': 'D', '♥': 'H', '♠': 'S' };

    const ranks = [];
    const rankCounts = {};
    const suitCounts = {};

    board.forEach(card => {
        const r = card[0];
        let s = card[1];
        s = suitMap[s] || s;
        ranks.push(rankMap[r]);
        rankCounts[r] = (rankCounts[r] || 0) + 1;
        suitCounts[s] = (suitCounts[s] || 0) + 1;
    });

    // ----- Pairing -----
    const maxRankCount = Math.max(...Object.values(rankCounts));
    const pairRisk = maxRankCount > 1 ? (maxRankCount - 1) / (board.length - 1) : 0;

    // ----- Suitedness -----
    const maxSuitCount = Math.max(...Object.values(suitCounts));
    const suitRisk = (maxSuitCount - 1) / (board.length - 1);

    // ----- Connectedness -----
    const ranksForStraight = ranks.slice();
    if (ranksForStraight.includes(14)) ranksForStraight.push(1); // wheel
    const unique = [...new Set(ranksForStraight)].sort((a, b) => a - b);
    let maxConsecutive = 1;
    let currentRun = 1;
    for (let i = 1; i < unique.length; i++) {
        if (unique[i] === unique[i - 1] + 1) {
            currentRun += 1;
        } else {
            currentRun = 1;
        }
        if (currentRun > maxConsecutive) maxConsecutive = currentRun;
    }
    const connectedness =
        maxConsecutive >= 3
            ? Math.max(0, (maxConsecutive - 2) / (board.length - 2))
            : 0;

    const textureRisk = (connectedness + suitRisk + pairRisk) / 3;
    return Math.max(0, Math.min(1, textureRisk));
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
    // Stack-to-pot ratio used for shove decisions
    const spr = player.chips / Math.max(1, pot + needToCall);
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

    // Post-flop board context
    let topPair = false;
    let overPair = false;
    let drawChance = false;
    let textureRisk = 0;
    if (!preflop && communityCards.length >= 3) {
        const ctxInfo = analyzeHandContext(
            [player.cards[0].dataset.value, player.cards[1].dataset.value],
            communityCards
        );
        topPair = ctxInfo.isTopPair;
        overPair = ctxInfo.isOverPair;

        const draws = analyzeDrawPotential(
            [player.cards[0].dataset.value, player.cards[1].dataset.value],
            communityCards
        );
        drawChance = draws.flushDraw || draws.straightDraw;

        textureRisk = evaluateBoardTexture(communityCards);
    }

    // Normalize strength to [0,1]
    const strengthRatio = strength / 10;

    // Base thresholds for raising depend on stage and pot size
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

    if (!preflop) {
        if (overPair) {
            aggressiveness += 0.2;
            raiseThreshold -= 0.5;
        } else if (topPair) {
            aggressiveness += 0.1;
            raiseThreshold -= 0.3;
        }
        if (drawChance) {
            aggressiveness += 0.05;
            raiseThreshold -= 0.25;
        }

        // Reduce aggression on wet boards
        aggressiveness *= 1 - textureRisk * 0.5;
        raiseThreshold = Math.min(10, raiseThreshold + textureRisk);
    }

    let bluffChance = 0;

    function valueBetSize() {
        let base;
        if (preflop) {
            base = 0.55;
            if (strengthRatio >= 0.9) base += 0.15;
            base += activeOpponents * 0.04;
            base += (1 - positionFactor) * 0.05;
            if (positionFactor < 0.3 && strengthRatio >= 0.8) {
                base += 0.1; // bigger open from early position
            }
        } else {
            base = textureRisk > 0.6 ? 0.7 : textureRisk > 0.3 ? 0.6 : 0.45;
            if (strengthRatio > 0.95) base += 0.1; // polarise with very strong hands
            base += activeOpponents * 0.03;
            base += (1 - positionFactor) * 0.05;
        }
        if (spr < 2) base += 0.1;
        else if (spr < 4) base += 0.05;
        else if (spr > 6) base -= 0.05;
        const rand = Math.random() * 0.2 - 0.1;
        const factor = Math.min(1, Math.max(0.35, base + rand));
        return roundTo10(Math.min(player.chips, (pot + needToCall) * factor));
    }

    function bluffBetSize() {
        let base = 0.25 + textureRisk * 0.05;
        base += activeOpponents * 0.02;
        base += (1 - positionFactor) * 0.03;
        if (spr < 3) base += 0.05;
        else if (spr > 5) base -= 0.05;
        const rand = Math.random() * 0.08 - 0.04;
        const factor = Math.min(0.45, Math.max(0.2, base + rand));
        return roundTo10(Math.min(player.chips, (pot + needToCall) * factor));
    }

    function protectionBetSize() {
        let base = 0.45 + textureRisk * 0.25;
        base += activeOpponents * 0.03;
        base += (1 - positionFactor) * 0.04;
        if (spr < 3) base += 0.1;
        else if (spr > 5) base -= 0.05;
        const rand = Math.random() * 0.1 - 0.05;
        const factor = Math.min(0.8, Math.max(0.35, base + rand));
        return roundTo10(Math.min(player.chips, (pot + needToCall) * factor));
    }

    function overBetSize() {
        let base = 1.2 - textureRisk * 0.1;
        base += activeOpponents * 0.05;
        if (spr < 2) base += 0.3;
        const rand = Math.random() * 0.15 - 0.05;
        const factor = Math.max(1.1, Math.min(1.5, base + rand));
        return roundTo10(Math.min(player.chips, (pot + needToCall) * factor));
    }

    // Adjust based on observed opponent tendencies
    const opponents = players.filter(p => p !== player);
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
        bluffChance *= (1 - textureRisk * 0.5);

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

    // Automatic shove logic when stacks are shallow
    if (spr <= 1.2 && strengthRatio >= 0.65) {
        decision = { action: "raise", amount: player.chips };
    } else if (preflop && player.chips <= blindLevel.big * 10 && strengthRatio >= 0.75) {
        decision = { action: "raise", amount: player.chips };
    }

    if (!decision) {
        if (needToCall <= 0) {
            if (canRaise && strength >= raiseThreshold) {
                let raiseAmt = valueBetSize();
                raiseAmt = Math.max(currentBet + blindLevel.big, raiseAmt);
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
            let raiseAmt = protectionBetSize();
            raiseAmt = Math.max(currentBet + blindLevel.big, raiseAmt);
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
    }

    // If facing any all-in, do not fold always
    const facingAllIn = opponents.some(p => p.allIn);
    if (decision.action === "fold" && facingAllIn) {
        const goodThreshold = preflop ? ALLIN_HAND_PREFLOP : ALLIN_HAND_POSTFLOP;
        if (strengthRatio >= goodThreshold) {
            decision = { action: "call", amount: Math.min(player.chips, needToCall) };
        }
    }

    let isBluff = false;
    if (bluffChance > 0 && canRaise && (decision.action === "check" || decision.action === "fold") && !facingAllIn) {
        if (Math.random() < bluffChance) {
            const bluffAmt = Math.max(currentBet + blindLevel.big, bluffBetSize());
            decision = { action: "raise", amount: bluffAmt };
            isBluff = true;
        }
    }

    if (!preflop && decision.action === "raise" && strengthRatio >= 0.95 && spr <= 2 && Math.random() < 0.3) {
        decision.amount = Math.max(decision.amount, overBetSize());
    }

    if (!preflop && strengthRatio >= 0.9 && decision.action === "raise" && Math.random() < 0.3) {
        decision = { action: "check" };
    }

    if (!preflop && currentBet === 0 && decision.action === "check" && Math.random() < 0.3) {
        const betAmt = protectionBetSize();
        decision = { action: "raise", amount: Math.max(blindLevel.big, betAmt) };
    }

    const h1 = formatCard(player.cards[0].dataset.value);
    const h2 = formatCard(player.cards[1].dataset.value);
    const handName = !preflop ? Hand.solve([
        player.cards[0].dataset.value,
        player.cards[1].dataset.value,
        ...communityCards
    ]).name : "preflop";

    if (DEBUG_DECISIONS) {
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
            BoardCtx: overPair ? 'overpair' : (topPair ? 'top pair' : (drawChance ? 'draw' : '-')),
            Texture: textureRisk.toFixed(2),
            Emoji: aggrEmoji,
            Action: decision.action,
            Bluff: isBluff
        }]);
    }

    return decision;
}
