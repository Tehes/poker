/* --------------------------------------------------------------------------------------------------
Imports
---------------------------------------------------------------------------------------------------*/
import { chooseBotAction, enqueueBotAction } from "./bot.js";

/* --------------------------------------------------------------------------------------------------
Variables
---------------------------------------------------------------------------------------------------*/
const startButton = document.querySelector("#start-button");
const rotateIcons = document.querySelectorAll(".seat .rotate");
const nameBadges = document.querySelectorAll("h3");
const closeButtons = document.querySelectorAll(".close");
const notification = document.querySelector("#notification");
const foldButton = document.querySelector("#fold-button");
const actionButton = document.querySelector("#action-button");
const amountSlider = document.querySelector("#amount-slider");
let communitySlots;
const Phases = ["preflop", "flop", "turn", "river", "showdown"];
let currentPhaseIndex = 0;
let currentBet = 0;
let pot = 0;
let initialDealerName = null;
let dealerOrbitCount = -1;
let gameStarted = false;
let openCardsMode = false;

let botCount = 0;

const MAX_ITEMS = 5;
const notifArr = [];
const pendingNotif = [];
let isNotifProcessing = false;
const NOTIF_INTERVAL = 750;

const MAX_RAISES_PER_ROUND = 3;
let raisesThisRound = 0;

// Clubs, Diamonds, Hearts, Spades
// 2,3,4,5,6,7,8,9,T,J,Q,K,A
let cards = [
	"2C", "2D", "2H", "2S",
	"3C", "3D", "3H", "3S",
	"4C", "4D", "4H", "4S",
	"5C", "5D", "5H", "5S",
	"6C", "6D", "6H", "6S",
	"7C", "7D", "7H", "7S",
	"8C", "8D", "8H", "8S",
	"9C", "9D", "9H", "9S",
	"TC", "TD", "TH", "TS",
	"JC", "JD", "JH", "JS",
	"QC", "QD", "QH", "QS",
	"KC", "KD", "KH", "KS",
	"AC", "AD", "AH", "AS",
];

let cardGraveyard = [];
let players = [];

let smallBlind = 10;
let bigBlind = 20;


/* --------------------------------------------------------------------------------------------------
functions
---------------------------------------------------------------------------------------------------*/
Array.prototype.shuffle = function () {
	let i = this.length;
	while (i) {
		let j = Math.floor(Math.random() * i);
		let t = this[--i];
		this[i] = this[j];
		this[j] = t;
	}
	return this;
};

function startGame(event) {
	if (!gameStarted) {
		createPlayers();
		openCardsMode = players.filter(p => !p.isBot).length === 1;

		if (players.length > 1) {
			for (const rotateIcon of rotateIcons) {
				rotateIcon.classList.add("hidden");
			}
			for (const closeButton of closeButtons) {
				closeButton.classList.add("hidden");
			}
			for (const name of nameBadges) {
				name.contentEditable = "false";
			}
			event.target.classList.add("hidden");
			gameStarted = true;
			preFlop();
		} else {
			for (const name of nameBadges) {
				if (name.textContent === "") {
					name.parentElement.classList.remove("hidden");
				}
				players = [];
			}
			enqueueNotification("Not enough players");
		}
	} else {
		// New Round
		preFlop();
	}
}

function createPlayers() {
	// Auto-fill empty seats with Bots
	let botIndex = 1;
	for (const seat of document.querySelectorAll(".seat")) {
		const nameEl = seat.querySelector("h3");
		if (seat.classList.contains("hidden")) continue;
		if (nameEl.textContent.trim() === "") {
			nameEl.textContent = `Bot ${botIndex++}`;
			seat.classList.add("bot");
		}
	}

	const activePlayers = document.querySelectorAll(".seat:not(.hidden)");
	for (const player of activePlayers) {
		const playerObject = {
			name: player.querySelector("h3").textContent,
			isBot: player.querySelector("h3").textContent.startsWith("Bot"),
			seat: player,
			qr: {
				show: function (card1, card2) {
					player.querySelector(".qr").classList.remove("hidden");
					const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, "");
					player.querySelector(".qr").src =
						`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${base}hole-cards.html?params=${card1}-${card2}-${playerObject.name}-${playerObject.chips}`;
				},
				hide: function () {
					player.querySelector(".qr").classList.add("hidden");
				}
			},
			cards: player.querySelectorAll(".card"),
			dealer: false,
			smallBlind: false,
			bigBlind: false,
			assignRole: function (role) {
				// Convert kebab-case role to camelCase flag name
				const flag = role.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
				this[flag] = true;
				this.seat.querySelector(`.${role}`).classList.remove("hidden");
			},
			clearRole: function (role) {
				const flag = role.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
				this[flag] = false;
				this.seat.querySelector(`.${role}`).classList.add("hidden");
			},
			folded: false,
			chips: 2000,
			allIn: false,
			totalBet: 0,
                        roundBet: 0,
                        stats: {
                                hands: 0,
                                handsWon: 0,
                                vpip: 0,
                                pfr: 0,
                                calls: 0,
                                aggressiveActs: 0,
                                showdowns: 0,
                                showdownsWon: 0
                        },
                        showTotal: function () {
                                player.querySelector(".chips .total").textContent = playerObject.chips;
                        },
			placeBet: function (x) {
				// Clamp bet to available chips → prevents negative stacks
				const bet = Math.min(x, playerObject.chips);
				playerObject.roundBet += bet;
				playerObject.totalBet += bet;
				player.querySelector(".chips .bet").textContent = playerObject.roundBet;
				playerObject.chips -= bet;
				if (playerObject.chips === 0) {
					playerObject.allIn = true;
				}
				playerObject.showTotal();
				return bet;   // return the real amount pushed to the pot
			},
			resetRoundBet: function () {
				playerObject.roundBet = 0;
				player.querySelector(".chips .bet").textContent = 0;
			},
		};
		players.push(playerObject);
	}
}

function setDealer() {
	const isNotDealer = (currentValue) => currentValue.dealer === false;
	if (players.every(isNotDealer)) {
		const randomPlayerIndex = Math.floor(Math.random() * players.length);
		players[randomPlayerIndex].dealer = true;
		players[randomPlayerIndex].assignRole("dealer");
		initialDealerName = players[randomPlayerIndex].name;
	}
	else {
		const dealerIndex = players.findIndex(p => p.dealer);
		// clear current dealer flag
		players[dealerIndex].dealer = false;
		players[dealerIndex].clearRole("dealer");

		// assign new dealer – wrap with modulo to avoid “undefined”
		const nextIndex = (dealerIndex + 1) % players.length;
		players[nextIndex].dealer = true;
		players[nextIndex].assignRole("dealer");
	}

	while (players[0].dealer === false) {
		players.unshift(players.pop());
	}

	enqueueNotification(`${players[0].name} is Dealer.`);
}

function setBlinds() {
	// When the dealer is back at initialDealer → increment orbit
	if (players[0].name === initialDealerName) {
		dealerOrbitCount++;
		if (dealerOrbitCount > 0 && dealerOrbitCount % 2 === 0) {
			// Increase blind level
			smallBlind *= 2;
			bigBlind *= 2;
			enqueueNotification(`Blinds are now ${smallBlind}/${bigBlind}.`);
		}
	}

	// Clear previous roles and icons
	players.forEach(p => {
		p.clearRole("small-blind");
		p.clearRole("big-blind");
	});
	// Post blinds for Pre-Flop and set currentBet
	const sbIdx = (players.length > 2) ? 1 : 0;
	const bbIdx = (players.length > 2) ? 2 : 1;

	const sbBet = players[sbIdx].placeBet(smallBlind);
	const bbBet = players[bbIdx].placeBet(bigBlind);

	enqueueNotification(`${players[sbIdx].name} posted small blind of ${sbBet}.`);
	enqueueNotification(`${players[bbIdx].name} posted big blind of ${bbBet}.`);

	// Add blinds to the pot
	pot += sbBet + bbBet;
	document.getElementById("pot").textContent = pot;
	// Assign new blinds
	players[sbIdx].assignRole("small-blind");
	players[bbIdx].assignRole("big-blind");
	currentBet = bigBlind;
}

function dealCards() {
	cards = cards.concat(cardGraveyard);
	cardGraveyard = [];
	cards.shuffle();

	for (const player of players) {
		player.cards[0].dataset.value = cards[0];
		player.cards[1].dataset.value = cards[1];
		if (!player.isBot) {
			if (openCardsMode) {
				player.cards[0].src = `cards/${cards[0]}.svg`;
				player.cards[1].src = `cards/${cards[1]}.svg`;
			} else {
				player.qr.show(cards[0], cards[1]);
			}
		}
		cardGraveyard.push(cards.shift());
		cardGraveyard.push(cards.shift());
	}
}

/**
 * Execute the standard pre-flop steps: rotate dealer, post blinds, deal cards, start betting.
 */
function preFlop() {
	// Reset phase to preflop
	currentPhaseIndex = 0;

	startButton.classList.add("hidden");

	// Clear folded state and remove CSS-Klasse
	players.forEach(p => {
		p.folded = false;
		p.allIn = false;
		p.totalBet = 0;
		p.seat.classList.remove("folded");
	});

	// Remove any previous winner highlighting
	players.forEach(p => p.seat.classList.remove("winner"));

	// Cover all hole cards with card back
	players.forEach(p => {
		p.cards[0].src = "cards/1B.svg";
		p.cards[1].src = "cards/1B.svg";
	});

	// Clear community cards from last hand
	document.querySelectorAll("#community-cards .cardslot").forEach(slot => {
		slot.innerHTML = "";
	});

	// Remove players with zero chips from the table
	const remainingPlayers = [];
	players.forEach(p => {
		if (p.chips <= 0) {
			p.chips = 0;
			p.seat.classList.add("hidden");
			enqueueNotification(`${p.name} is out of the game!`);
		} else {
			remainingPlayers.push(p);
		}
	});
        players = remainingPlayers;

        // Start statistics for a new hand
        players.forEach(p => {
                p.stats.hands++;
        });

	// If the original dealer is eliminated, update initialDealerName and reset dealerOrbitCount
	if (!players.some(p => p.name === initialDealerName) && players.length > 0) {
		initialDealerName = players[0].name;
		dealerOrbitCount = -1;
	}

	// ----------------------------------------------------------
	// GAME OVER: only one player left at the table
	if (players.length === 1) {
		const champion = players[0];
		enqueueNotification(`${champion.name} wins the game! 🏆`);
		// Reveal champion's stack
		champion.showTotal();
		champion.seat.classList.add("winner");
		return;                // skip the rest of preFlop()
	}
	// ----------------------------------------------------------

	// Assign dealer 
	setDealer();

	// post blinds
	setBlinds();

	// Shuffle and deal new hole cards
	dealCards();

	// Start first betting round (preflop)
	startBettingRound();
}

function setPhase() {
	// If only one player remains, skip community deals and go straight to showdown
	const activePlayers = players.filter(p => !p.folded);
	if (activePlayers.length <= 1) {
		return doShowdown();
	}

	currentPhaseIndex++;
	switch (Phases[currentPhaseIndex]) {
		case "flop":
			dealCommunityCards(3);
			enqueueNotification("Flop (3 cards) dealt.");
			startBettingRound();
			break;
		case "turn":
			dealCommunityCards(1);
			enqueueNotification("Turn (4th card) dealt.");
			startBettingRound();
			break;
		case "river":
			dealCommunityCards(1);
			enqueueNotification("River (5th card) dealt.");
			startBettingRound();
			break;
		case "showdown": doShowdown(); break;
	}
}

function dealCommunityCards(amount) {
	const emptySlots = document.querySelectorAll("#community-cards .cardslot:empty");
	if (emptySlots.length < amount) {
		console.warn("Not enough empty slots for", amount);
		return;
	}
	cardGraveyard.push(cards.shift()); // burn
	for (let i = 0; i < amount; i++) {
		const card = cards.shift();
		emptySlots[i].innerHTML = `<img src="cards/${card}.svg">`;
		cardGraveyard.push(card);   // back into Deck
	}
}

function startBettingRound() {
	// ------------------------------------------------------------------
	// EARLY EXIT: If zero or only one player still has chips to act,
	// no betting round is possible. Skip straight to the next phase.
	const actionable = players.filter(p => !p.folded && !p.allIn);
	if (actionable.length <= 1) {
		return setPhase();
	}
	// ------------------------------------------------------------------

	// 2) Determine start index
	let startIdx;
	if (currentPhaseIndex === 0) {
		// UTG: first player left of big blind
		const bbIdx = players.findIndex(p => p.bigBlind);
		startIdx = (bbIdx + 1) % players.length;
	} else {
		// first player left of dealer
		const dealerIdx = players.findIndex(p => p.dealer);
		startIdx = (dealerIdx + 1) % players.length;
		// Reset currentBet for post-Flop rounds
		currentBet = 0;
		// Reset bets only for post-flop rounds
		players.forEach(p => p.resetRoundBet());
	}

	raisesThisRound = 0;
	let idx = startIdx;
	let cycles = 0;

	function anyUncalled() {
		if (currentBet === 0) {
			// Post-flop: Prüfe ob alle Spieler schon dran waren
			return cycles < players.filter(p => !p.folded && !p.allIn).length;
		}
		return players.some(p => !p.folded && !p.allIn && p.roundBet < currentBet);
	}


	function nextPlayer() {
		// --- EARLY EXIT --------------------------------------------------
		// If only ONE player has not folded, the hand ends immediately
		if (players.filter(p => !p.folded).length === 1) {
			return setPhase();        // immediately triggers the show-down / pot award
		}

		// -------------------------------------------------------------------
		// Find next player who still owes action
		let player = players[idx % players.length];
		idx++;
		cycles++;

		// Skip folded or all-in players immediately
		if (player.folded || player.allIn) {
			return nextPlayer();
		}

		// Skip if player already matched the current bet
		if (player.roundBet >= currentBet) {
			// Allow one pass-through for Big Blind pre-flop or Check post-flop
			if (
				(currentPhaseIndex === 0 && cycles <= players.length) ||
				(currentPhaseIndex > 0 && currentBet === 0 && cycles <= players.length)
			) {
				// within first cycle: let them act
			} else {
				if (anyUncalled()) return nextPlayer();
				return setPhase();
			}
		}

		// If this is a bot, choose an action based on hand strength
		if (player.isBot) {
			document.querySelectorAll(".seat").forEach(s => s.classList.remove("active"));
			player.seat.classList.add("active");

                        const decision = chooseBotAction(player, {
                                currentBet,
                                pot,
                                smallBlind,
                                bigBlind,
                                raisesThisRound,
                                currentPhaseIndex,
                                players
                        });
			const needToCall = currentBet - player.roundBet;

			if (decision.action === "fold") {
				player.folded = true;
				notifyPlayerAction(player, "fold");
				player.qr.hide();
				player.seat.classList.add("folded");
			} else if (decision.action === "check") {
				notifyPlayerAction(player, "check");
			} else if (decision.action === "call") {
				const actual = player.placeBet(decision.amount);
				pot += actual;
				document.querySelector("#pot").textContent = pot;
				notifyPlayerAction(player, "call", actual);
			} else if (decision.action === "raise") {
				const amt = player.placeBet(decision.amount);
				if (amt > needToCall) {
					currentBet = player.roundBet;
				}
				pot += amt;
				document.getElementById("pot").textContent = pot;
				notifyPlayerAction(player, "raise", player.roundBet);
				raisesThisRound++;
			}

			enqueueBotAction(() => {
				if (cycles < players.length) {
					nextPlayer();
				} else if (anyUncalled()) {
					nextPlayer();
				} else {
					setPhase();
				}
			});
			return;
		}



		// Highlight active player
		// remove previous highlight
		document.querySelectorAll(".seat").forEach(s => s.classList.remove("active"));
		player.seat.classList.add("active");

		const needToCall = currentBet - player.roundBet;

		// UI: prepare slider and buttons
		if (currentPhaseIndex > 0 && currentBet === 0) {
			// First bet post-flop: allow Check (0) or at least big blind
			amountSlider.min = 0;
			amountSlider.max = player.chips;
			// Step equals big blind (or entire stack if less than big blind)
			amountSlider.step = (player.chips >= bigBlind) ? bigBlind : player.chips;
			amountSlider.value = 0;
			amountSlider.nextElementSibling.value = 0;
		} else {
			// Determine minimum bet as the lesser of needToCall and player chips
			const minBet = Math.min(needToCall, player.chips);
			amountSlider.min = minBet;
			amountSlider.max = player.chips;
			amountSlider.step = 10;
			amountSlider.value = minBet;
			amountSlider.nextElementSibling.value = minBet;
		}

		// Update button label on slider input
		function onSliderInput() {
			const val = parseInt(amountSlider.value, 10);
			if (val === 0) {
				actionButton.textContent = "Check";
			} else if (val === player.chips) {
				actionButton.textContent = "All-In";
			} else if (val === needToCall) {
				actionButton.textContent = "Call";
			} else {
				actionButton.textContent = "Raise";
			}
		}
		amountSlider.addEventListener("input", onSliderInput);
		onSliderInput();

		// Event handlers
		function onAction() {
			const bet = parseInt(amountSlider.value, 10);
			const needToCall = currentBet - player.roundBet;

			// Remove active highlight and slider listener
			player.seat.classList.remove("active");
			amountSlider.removeEventListener("input", onSliderInput);

			// Handle action types
			if (bet === 0) {
				// Check
				notifyPlayerAction(player, "check");
			} else if (bet === player.chips) {
				// All-In
				player.placeBet(bet);
				pot += bet;
				document.getElementById("pot").textContent = pot;
				// If this all-in meets or exceeds the call amount, treat it as a raise
				if (bet >= needToCall) {
					currentBet = player.roundBet;
					raisesThisRound++;
				}
				notifyPlayerAction(player, "allin", bet);
				foldButton.removeEventListener("click", onFold);
				actionButton.removeEventListener("click", onAction);
				return nextPlayer();
			} else if (bet === needToCall) {
				// Call
				player.placeBet(bet);
				pot += bet;
				document.getElementById("pot").textContent = pot;
				notifyPlayerAction(player, "call", player.roundBet);
			} else {
				// Raise
				player.placeBet(bet);
				currentBet = player.roundBet;
				pot += bet;
				document.getElementById("pot").textContent = pot;
				notifyPlayerAction(player, "raise", player.roundBet);
				raisesThisRound++;
			}

			foldButton.removeEventListener("click", onFold);
			actionButton.removeEventListener("click", onAction);
			nextPlayer();
		}
		function onFold() {
			player.folded = true;
			notifyPlayerAction(player, "fold");
			player.qr.hide();
			// Visually mark folded player
			player.seat.classList.add("folded");
			player.seat.classList.remove("active");
			amountSlider.removeEventListener("input", onSliderInput);
			foldButton.removeEventListener("click", onFold);
			actionButton.removeEventListener("click", onAction);
			nextPlayer();
		}

		foldButton.addEventListener("click", onFold);
		actionButton.addEventListener("click", onAction);
	}

	nextPlayer();
}

/**
 * Animate chip transfer from the pot display to a player's total chips.
 * amount   – integer to transfer
 * playerObj – player object to receive chips
 * onDone   – callback after animation completes
 */
function animateChipTransfer(amount, playerObj, onDone) {
	const steps = 30;
	const totalDuration = Math.min(Math.max(amount * 20, 300), 3000);
	const delay = totalDuration / steps;
	const increment = Math.floor(amount / steps);
	let remainder = amount - increment * steps;
	let currentStep = 0;

	function step() {
		if (currentStep < steps) {
			// decrement pot
			const potElem = document.getElementById("pot");
			let potVal = parseInt(potElem.textContent, 10);
			potVal -= increment;
			potElem.textContent = potVal;

			// increment player chips
			playerObj.chips += increment;
			playerObj.showTotal();

			currentStep++;
			setTimeout(step, delay);
		} else {
			// add any remainder
			const potElem = document.getElementById("pot");
			let potVal = parseInt(potElem.textContent, 10);
			potVal -= remainder;
			potElem.textContent = potVal;

			playerObj.chips += remainder;
			playerObj.showTotal();

			if (onDone) onDone();
		}
	}
	step();
}

function doShowdown() {
	// Reset round bets now that they are in the pot
	players.forEach(p => p.resetRoundBet());

        // Filter active players
        const activePlayers = players.filter(p => !p.folded);
        const contributors = players.filter(p => p.totalBet > 0);

        const hadShowdown = activePlayers.length > 1;
        if (hadShowdown) {
                activePlayers.forEach(p => p.stats.showdowns++);
        }

	// Reveal hole cards of all active players
	if (activePlayers.length > 1) {
		activePlayers.forEach(p => {
			const card1 = p.cards[0].dataset.value;
			const card2 = p.cards[1].dataset.value;
			p.cards[0].src = `cards/${card1}.svg`;
			p.cards[1].src = `cards/${card2}.svg`;
			p.qr.hide();
		});
	}


	// Single-player case: immediate win (no hand needed)
        if (activePlayers.length === 1) {
                const winner = activePlayers[0];
                winner.stats.handsWon++;
                // Animate the chip transfer for the single winner
                winner.seat.classList.add("winner");
		winner.seat.classList.remove("active");
		winner.qr.hide();                // keep hole cards concealed
		enqueueNotification(`${winner.name} wins ${pot}!`);
		animateChipTransfer(pot, winner, () => {
			pot = 0;
			document.getElementById("pot").textContent = pot;
			startButton.textContent = "New Round";
			startButton.classList.remove("hidden");
		});
		return;
	}

	// 2) Gather community cards from the DOM
	const communityCards = Array.from(
		document.querySelectorAll("#community-cards .cardslot img")
	).map(img => {
		// Extract card code from src, e.g., ".../cards/Ah.svg" → "Ah"
		const match = img.src.match(/\/cards\/([2-9TJQKA][CDHS])\.svg$/);
		return match ? match[1] : null;
	}).filter(Boolean);

	// ---- Build side pots based on each player's totalBet ----
	const contenders = contributors.slice();
	const sidePots = [];
	const sorted = contenders.slice().sort((a, b) => a.totalBet - b.totalBet);
	let prev = 0;
	for (let i = 0; i < sorted.length; i++) {
		const lvl = sorted[i].totalBet;
		const diff = lvl - prev;
		if (diff > 0) {
			const eligible = sorted.slice(i);
			sidePots.push({
				amount: diff * eligible.length,
				eligible
			});
			prev = lvl;
		}
	}

	// ------------------------------------------------------------------
	// COSMETIC MERGE: combine consecutive side pots whose eligible
	// player sets are identical.  This removes tiny "blind-only" pots
	// when all remaining contenders have contributed to the next level.
	for (let i = 0; i < sidePots.length - 1;) {
		const eligA = sidePots[i].eligible.filter(p => !p.folded);
		const eligB = sidePots[i + 1].eligible.filter(p => !p.folded);

		const sameEligible =
			eligA.length === eligB.length &&
			eligA.every(p => eligB.includes(p));

		if (sameEligible) {
			// Merge amounts and discard the next pot
			sidePots[i].amount += sidePots[i + 1].amount;
			sidePots.splice(i + 1, 1);
			// Do not increment i – check the newly merged pot against the next
		} else {
			i++; // move to next pair
		}
	}
	// ------------------------------------------------------------------

	// ---- Collect animated chip transfers ----
        const transferQueue = [];
        const winnersSet = new Set();

	// ---- Evaluate each side pot ----
	// Collect results for notification consolidation
	const potResults = [];
	sidePots.forEach((sp, potIdx) => {
		const spHands = sp.eligible
			.filter(p => !p.folded)   // only players still in the hand can win
			.map(p => {
				const seven = [
					p.cards[0].dataset.value,
					p.cards[1].dataset.value,
					...communityCards
				];
				return { player: p, handObj: Hand.solve(seven) };
			});

		// --- If only one player is eligible for this pot, refund/award it immediately ---
                if (sp.eligible.filter(p => !p.folded).length === 1) {
                        const solePlayer = sp.eligible.find(p => !p.folded);
                        transferQueue.push({ player: solePlayer, amount: sp.amount });
                        if (!winnersSet.has(solePlayer)) {
                                solePlayer.stats.handsWon++;
                                if (hadShowdown) solePlayer.stats.showdownsWon++;
                                winnersSet.add(solePlayer);
                        }
                        // Collect for notification consolidation
                        potResults.push({ players: [solePlayer.name], amount: sp.amount, hand: null });
                        return;
                }

		const winners = Hand.winners(spHands.map(h => h.handObj));
		const share = Math.floor(sp.amount / winners.length);
		let remainder = sp.amount - share * winners.length;

                winners.forEach(w => {
                        const entry = spHands.find(h => h.handObj === w);
                        const payout = share + (remainder > 0 ? 1 : 0);
                        if (remainder > 0) remainder--;
                        transferQueue.push({ player: entry.player, amount: payout });
                        if (!winnersSet.has(entry.player)) {
                                entry.player.stats.handsWon++;
                                if (hadShowdown) entry.player.stats.showdownsWon++;
                                winnersSet.add(entry.player);
                        }
                        // Highlight winners only for the main pot
                        if (potIdx === 0) {
                                entry.player.seat.classList.add("winner");
                                entry.player.seat.classList.remove("active");
                        }
                });

		// ---- Build detailed payout message for this pot ----
		const winnerDescriptions = winners.map(w => {
			const e = spHands.find(h => h.handObj === w);
			return `${e.player.name} (${w.name})`;
		}).join(" & ");

		if (winners.length === 1 && sidePots.length === 1) {
			// Only one pot in the hand and a single winner → concise wording
			const entry = spHands.find(h => h.handObj === winners[0]);
			potResults.push({ players: [entry.player.name], amount: sp.amount, hand: winners[0].name });
		} else if (winners.length === 1) {
			// Single winner but multiple pots in the hand
			const entry = spHands.find(h => h.handObj === winners[0]);
			potResults.push({ players: [entry.player.name], amount: sp.amount, hand: winners[0].name });
		} else {
			potResults.push({
				players: winners.map(w => {
					const e = spHands.find(h => h.handObj === w);
					return `${e.player.name}`;
				}), amount: sp.amount, hand: null
			});
		}
	});

	// Filter out side-pots where the winner only gets their own bet back (no profit)
	const filteredResults = potResults.filter(r => !(r.players.length === 1 && r.hand === null));

	// Consolidate notifications: if same player wins all pots, combine amounts
	if (filteredResults.length > 0) {
		const allSame = filteredResults.every(r => r.players.length === 1 && r.players[0] === filteredResults[0].players[0]);
		if (allSame) {
			const total = filteredResults.reduce((sum, r) => sum + r.amount, 0);
			let msg = `${filteredResults[0].players[0]} wins ${total}`;
			if (filteredResults[0].hand) msg += ` with ${filteredResults[0].hand}`;
			enqueueNotification(msg);
		} else {
			filteredResults.forEach(r => {
				if (r.players.length === 1) {
					let msg = `${r.players[0]} wins ${r.amount}`;
					if (r.hand) msg += ` with ${r.hand}`;
					enqueueNotification(msg);
				} else {
					enqueueNotification(`${r.players.join(" & ")} split ${r.amount}`);
				}
			});
		}
	}

	// Run queued chip transfers sequentially with animation
	function runTransfers(index) {
		if (index >= transferQueue.length) {
			// All animations done – reset pot, show New Round button
			pot = 0;
			document.getElementById("pot").textContent = pot;

			startButton.textContent = "New Round";
			startButton.classList.remove("hidden");
			return;
		}
		const t = transferQueue[index];
		animateChipTransfer(t.amount, t.player, () => runTransfers(index + 1));
	}
	runTransfers(0);
	return; // exit doShowdown early because UI flow continues in animation
}

function rotateSeat(ev) {
	const seat = ev.target.parentElement.parentElement;
	seat.dataset.rotation = parseInt(seat.dataset.rotation) + 90;
	seat.style.transform = "rotate(" + seat.dataset.rotation + "deg)";
}

function deletePlayer(ev) {
	const seat = ev.target.parentElement.parentElement;
	seat.classList.add("hidden");
}

function notifyPlayerAction(player, action, amount) {
        // Update statistics based on action and phase
        if (currentPhaseIndex === 0) {
                if (action === "call" || action === "raise" || action === "allin") {
                        player.stats.vpip++;
                }
                if (action === "raise" || action === "allin") {
                        player.stats.pfr++;
                }
        } else {
                if (action === "raise" || action === "allin") {
                        player.stats.aggressiveActs++;
                } else if (action === "call") {
                        player.stats.calls++;
                }
        }

        let msg = "";
	switch (action) {
		case "fold":
			msg = `${player.name} folded.`;
			break;
		case "check":
			msg = `${player.name} checked.`;
			break;
		case "call":
			msg = `${player.name} called ${amount}.`;
			break;
		case "raise":
			msg = `${player.name} raised to ${amount}.`;
			break;
		case "allin":
			msg = `${player.name} is all-in.`;
			break;
		default:
			msg = `${player.name} did something…`;
	}
	enqueueNotification(msg);
}

function enqueueNotification(msg) {
	pendingNotif.push(msg);
	if (!isNotifProcessing) {
		showNextNotif();
	}
}

function showNextNotif() {
	if (pendingNotif.length === 0) {
		isNotifProcessing = false;
		return;
	}
	isNotifProcessing = true;
	const msg = pendingNotif.shift();
	// newest message first for tracking
	notifArr.unshift(msg);
	if (notifArr.length > MAX_ITEMS) notifArr.pop();
	// create a new span for this message
	const span = document.createElement("span");
	span.textContent = msg;
	// prepend to container
	notification.prepend(span);
	// remove excess spans from end if over limit
	while (notification.childElementCount > MAX_ITEMS) {
		notification.removeChild(notification.lastChild);
	}
	console.log(msg);
	setTimeout(showNextNotif, NOTIF_INTERVAL);
}


function init() {
	document.addEventListener("touchstart", function () { }, false);
	startButton.addEventListener("click", startGame, false);

	for (const rotateIcon of rotateIcons) {
		rotateIcon.addEventListener("click", rotateSeat, false);
	}
	for (const closeButton of closeButtons) {
		closeButton.addEventListener("click", deletePlayer, false);
	}
}

/* --------------------------------------------------------------------------------------------------
public members, exposed with return statement
---------------------------------------------------------------------------------------------------*/
window.poker = {
	init, players
};

poker.init();
