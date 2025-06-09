export const BOT_ACTION_DELAY = 1500;

const DEBUG_DECISIONS = true;
const MAX_RAISES_PER_ROUND = 3;
const STRENGTH_TIE_DELTA = 0.25; // Borderline Raise/Stärke
const ODDS_TIE_DELTA = 0.02;     // Borderline Call/Fold

const botActionQueue = [];
let processingBotActions = false;

export function enqueueBotAction(fn) {
    botActionQueue.push(fn);
    if (!processingBotActions) {
        processingBotActions = true;
        setTimeout(processBotQueue, BOT_ACTION_DELAY);
    }
}

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

function logDecision(msg) {
    if (DEBUG_DECISIONS) console.log(msg);
}

const SUIT_SYMBOLS = { C: "♣", D: "♦", H: "♥", S: "♠" };
function formatCard(code) {
    return code[0].replace("T", "10") + SUIT_SYMBOLS[code[1]];
}

function roundTo10(x) {
    return Math.round(x / 10) * 10;
}

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

export function chooseBotAction(player, ctx) {
    const { currentBet, pot, smallBlind, bigBlind, raisesThisRound, currentPhaseIndex, players } = ctx;
    const needToCall = currentBet - player.roundBet;

    const potOdds = needToCall / (pot + needToCall);
    const stackRatio = needToCall / player.chips;
    const blindLevel = { small: smallBlind, big: bigBlind };
    const canRaise = raisesThisRound < MAX_RAISES_PER_ROUND && player.chips > blindLevel.big;

    const seatIdx = players.indexOf(player);
    const refIdx = currentPhaseIndex === 0
        ? (players.findIndex(p => p.bigBlind) + 1) % players.length
        : (players.findIndex(p => p.dealer) + 1) % players.length;
    const pos = (seatIdx - refIdx + players.length) % players.length;
    const positionFactor = pos / (players.length - 1);

    const communityCards = Array.from(
        document.querySelectorAll("#community-cards .cardslot img")
    ).map(img => {
        const m = img.src.match(/\/cards\/([2-9TJQKA][CDHS])\.svg$/);
        return m ? m[1] : null;
    }).filter(Boolean);

    const cards = [
        player.cards[0].dataset.value,
        player.cards[1].dataset.value,
        ...communityCards
    ];

    const preflop = communityCards.length === 0;

    let strength;
    if (preflop) {
        strength = preflopHandScore(player.cards[0].dataset.value, player.cards[1].dataset.value);
    } else {
        const hand = Hand.solve(cards);
        strength = hand.rank;
    }

    const strengthRatio = strength / 10;

    const raiseBase = preflop
        ? Math.max(blindLevel.big * (strength >= 8 ? 3 : 2), pot / 2)
        : Math.max(blindLevel.big * 2, pot * 0.6);
    const aggressiveness = preflop
        ? 0.8 + 0.4 * positionFactor
        : 1 + 0.6 * positionFactor;
    const raiseThreshold = preflop
        ? 8 - 2 * positionFactor
        : Math.max(2, 4 - 2 * positionFactor);

    let decision;

    if (needToCall <= 0) {
        if (canRaise && strength >= raiseThreshold) {
            let raiseAmt = Math.min(
                player.chips,
                Math.max(currentBet + blindLevel.big, raiseBase * (1 + positionFactor * 0.5))
            );
            raiseAmt = Math.min(player.chips, roundTo10(raiseAmt));
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

    const h1 = formatCard(player.cards[0].dataset.value);
    const h2 = formatCard(player.cards[1].dataset.value);
    const handName = !preflop ? Hand.solve(cards).name : "preflop";
    logDecision(`${player.name} [${h1} ${h2}] | strength=${strength.toFixed(2)} potOdds=${potOdds.toFixed(2)} stack=${stackRatio.toFixed(2)} pos=${positionFactor.toFixed(2)} raises=${raisesThisRound} -> ${decision.action} (${handName})`);

    return decision;
}
