/* --------------------------------------------------------------------------------------------------
Imports
---------------------------------------------------------------------------------------------------*/

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
let gameStarted = false;

let notificationQueue = [];
let isDisplayingNotification = false;

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
	for (const name of nameBadges) {
		if (name.textContent === "") {
			name.parentElement.classList.add("hidden");
		}
	}

	const activePlayers = document.querySelectorAll(".seat:not(.hidden)");
	for (const player of activePlayers) {
		const playerObject = {
			name: player.querySelector("h3").textContent,
			seat: player,
			qr: {
				show: function (card1, card2) {
					player.querySelector(".qr").classList.remove("hidden");
					player.querySelector(".qr").src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${window.location.href}hole-cards.html?params=${card1}-${card2}-${playerObject.name}-${playerObject.chips}`;
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
				this.seat.querySelector(`#${role}`).classList.remove('hidden');
			},
			clearRole: function (role) {
				const flag = role.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
				this[flag] = false;
				this.seat.querySelector(`#${role}`).classList.add('hidden');
			},
			folded: false,
			chips: 2000,
			allIn: false,
			totalBet: 0,
			roundBet: 0,
			showTotal: function () {
				player.querySelector(".chips .total").textContent = playerObject.chips;
			},
			placeBet: function (x) {
				playerObject.roundBet += x;
				playerObject.totalBet += x;
				player.querySelector(".chips .bet").textContent = playerObject.roundBet;
				playerObject.chips -= x;
				if (playerObject.chips === 0) {
					playerObject.allIn = true;
				}
				playerObject.showTotal();
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
		players[randomPlayerIndex].assignRole('dealer');
	}
	else {
		// If only one player remains, keep them as dealer and exit early
		if (players.length === 1) {
			players[0].dealer = true;
			players[0].assignRole('dealer');
			enqueueNotification(`${players[0].name} is Dealer.`);
			return;
		}
		const dealerIndex = players.findIndex(p => p.dealer);
		// clear current dealer flag
		players[dealerIndex].dealer = false;
		players[dealerIndex].clearRole('dealer');

		// assign new dealer – wrap with modulo to avoid “undefined”
		const nextIndex = (dealerIndex + 1) % players.length;
		players[nextIndex].dealer = true;
		players[nextIndex].assignRole('dealer');
	}

	while (players[0].dealer === false) {
		players.unshift(players.pop());
	}

	enqueueNotification(`${players[0].name} is Dealer.`);
}

function setBlinds() {
	// If there are fewer than two players, no blinds are posted.
	if (players.length < 2) {
		currentBet = 0;
		enqueueNotification("Waiting for more players – blinds skipped.");
		return;
	}
	// Clear previous roles and icons
	players.forEach(p => {
		p.clearRole('small-blind');
		p.clearRole('big-blind');
	});
	// Post blinds for Pre-Flop and set currentBet
	const sbIdx = (players.length > 2) ? 1 : 0;
	const bbIdx = (players.length > 2) ? 2 : 1;
	players[sbIdx].placeBet(smallBlind);
	players[bbIdx].placeBet(bigBlind);
	enqueueNotification(`${players[sbIdx].name} posted small blind of ${smallBlind}. ${players[bbIdx].name} posted big blind of ${bigBlind}.`);
	// Add blinds to the pot
	pot += smallBlind + bigBlind;
	document.getElementById("pot").textContent = pot;
	// Assign new blinds
	players[sbIdx].assignRole('small-blind');
	players[bbIdx].assignRole('big-blind');
	currentBet = bigBlind;
}

function dealCards() {
	cards = cards.concat(cardGraveyard);
	cardGraveyard = [];
	cards.shuffle();

	for (const player of players) {
		player.cards[0].dataset.value = cards[0];
		player.cards[1].dataset.value = cards[1];
		player.qr.show(cards[0], cards[1]);
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
	players.forEach(p => { p.totalBet = 0; });

	startButton.classList.add("hidden");

	// Clear folded state and remove CSS-Klasse
	players.forEach(p => {
		p.folded = false;
		p.allIn = false;
		p.totalBet = 0;
		p.seat.classList.remove('folded');
	});

	// Remove any previous winner highlighting
	players.forEach(p => p.seat.classList.remove('winner'));

	// Cover all hole cards with card back
	players.forEach(p => {
		p.cards[0].src = "cards/1B.svg";
		p.cards[1].src = "cards/1B.svg";
	});

	// Reset all previous round bets
	players.forEach(p => p.resetRoundBet());

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
			enqueueNotification(`${p.name} is out of chips and leaves the table.`);
		} else {
			remainingPlayers.push(p);
		}
	});
	players = remainingPlayers;

	// ----------------------------------------------------------
	// GAME OVER: only one player left at the table
	if (players.length === 1) {
		const champion = players[0];
		enqueueNotification(`${champion.name} has won all the chips and the game! 🏆`);
		// Reveal champion's stack
		champion.showTotal();
		// Show start button for a fresh game
		startButton.textContent = "Restart";
		startButton.classList.remove("hidden");
		gameStarted = false;   // allow new startGame() to reset everything
		return;                // skip the rest of preFlop()
	}
	// ----------------------------------------------------------

	// Assign dealer and post blinds
	setDealer();
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
			enqueueNotification("Flop dealt: 3 community cards");
			startBettingRound();
			break;
		case "turn":
			dealCommunityCards(1);
			enqueueNotification("Turn dealt: 4th community card");
			startBettingRound();
			break;
		case "river":
			dealCommunityCards(1);
			enqueueNotification("River dealt: 5th community card");
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
		emptySlots[i].innerHTML = `<img src="cards/${cards.shift()}.svg">`;
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

	let idx = startIdx;
	let cycles = 0;

	function anyUncalled() {
		return players.some(p => !p.folded && !p.allIn && p.roundBet < currentBet);
	}

	function nextPlayer() {
		// --- Guard against infinite recursion -----------------------------
		// If nobody who is NOT folded and NOT all‑in can still act, advance the phase.
		const someoneCanAct = players.some(p =>
			!p.folded &&                 // still in hand
			!p.allIn &&                  // has chips left
			(currentBet === 0 || p.roundBet < currentBet) // owes action
		);
		if (!someoneCanAct) {
			return setPhase();
		}
		// -------------------------------------------------------------------

		// If only one player remains, skip to next phase (or showdown)
		const remaining = players.filter(p => !p.folded);
		if (remaining.length === 1) {
			return setPhase();
		}
		// Find next player who still owes action
		let player = players[idx % players.length];
		idx++;
		cycles++;

		// Always skip folded or all-in players
		if (player.folded || player.allIn) {
			// Skip this seat – guard clause at the top ensures we won't recurse forever
			return nextPlayer();
		}

		// Only check roundBet for skipping/termination
		if (player.roundBet >= currentBet) {
			// Allow one pass-through for Big Blind pre-flop or Check post-flop
			if (
				(currentPhaseIndex === 0 && cycles <= players.length) ||
				(currentPhaseIndex > 0 && currentBet === 0 && cycles <= players.length)
			) {
				// within first cycle: let them act (Big Blind gets checked, others check post-flop)
			} else {
				if (anyUncalled()) return nextPlayer();
				return setPhase();
			}
		}

		// Highlight active player
		// remove previous highlight
		document.querySelectorAll('.seat').forEach(s => s.classList.remove('active'));
		player.seat.classList.add('active');

		const needToCall = currentBet - player.roundBet;

		// UI: prepare slider and buttons
		foldButton.disabled = false;
		actionButton.disabled = false;
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
			player.seat.classList.remove('active');
			amountSlider.removeEventListener("input", onSliderInput);

			// Handle action types
			if (bet === 0) {
				// Check
				notifyPlayerAction(player, "check");
			} else if (bet === player.chips && bet < needToCall) {
				// All-In (short stack)
				player.placeBet(bet);
				if (player.chips === 0) {
					player.allIn = true;
				}
				pot += bet;
				document.getElementById("pot").textContent = pot;
				notifyPlayerAction(player, "allin", bet);
				foldButton.removeEventListener("click", onFold);
				actionButton.removeEventListener("click", onAction);
				return nextPlayer();
			} else if (bet === needToCall) {
				// Call
				player.placeBet(bet);
				if (player.chips === 0) {
					player.allIn = true;
				}
				pot += bet;
				document.getElementById("pot").textContent = pot;
				notifyPlayerAction(player, "call", player.roundBet);
			} else {
				// Raise
				player.placeBet(bet);
				if (player.chips === 0) {
					player.allIn = true;
				}
				currentBet = player.roundBet;
				pot += bet;
				document.getElementById("pot").textContent = pot;
				notifyPlayerAction(player, "raise", player.roundBet);
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
			player.seat.classList.add('folded');
			player.seat.classList.remove('active');
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

function doShowdown() {
	// 1) Filter active players
	const activePlayers = players.filter(p => !p.folded);
	const contributors = players.filter(p => p.totalBet > 0);

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


	// Single-player case: immediate win
	if (activePlayers.length === 1) {
		const winner = activePlayers[0];
		winner.chips += pot;
		winner.showTotal();
		// Highlight the winning player
		winner.seat.classList.add('winner');
		// Determine winner’s hand description
		const hole = [winner.cards[0].dataset.value, winner.cards[1].dataset.value];
		const communityCards = Array.from(
			document.querySelectorAll("#community-cards .cardslot img")
		).map(img => img.src.match(/\/cards\/([2-9TJQKA][CDHS])\.svg$/)[1]);
		const winnerHand = Hand.solve([...hole, ...communityCards]);
		enqueueNotification(`${winner.name} wins the pot of ${pot}! (${winnerHand.name})`);
		pot = 0;
		document.getElementById("pot").textContent = pot;
		startButton.textContent = "New Round";
		startButton.classList.remove("hidden");
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

	// ---- Evaluate each side pot ----
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
			solePlayer.chips += sp.amount;
			solePlayer.showTotal();
			solePlayer.seat.classList.add('winner');
			enqueueNotification(`Pot ${potIdx + 1} (${sp.amount}): ${solePlayer.name} wins ${sp.amount} (uncalled).`);
			return; // skip normal evaluation
		}

		const winners = Hand.winners(spHands.map(h => h.handObj));
		const share = Math.floor(sp.amount / winners.length);
		let remainder = sp.amount - share * winners.length;

		winners.forEach(w => {
			const entry = spHands.find(h => h.handObj === w);
			entry.player.chips += share + (remainder > 0 ? 1 : 0);
			if (remainder > 0) remainder--;
			entry.player.showTotal();
			entry.player.seat.classList.add('winner');
		});


		// ---- Build detailed payout message for this pot ----
		const winnerDescriptions = winners.map(w => {
			const e = spHands.find(h => h.handObj === w);
			return `${e.player.name} (${w.name})`;
		}).join(" & ");

		if (winners.length === 1) {
			enqueueNotification(`Pot ${potIdx + 1} (${sp.amount}): ${winnerDescriptions} wins ${sp.amount}.`);
		} else {
			enqueueNotification(`Pot ${potIdx + 1} (${sp.amount}): ${winnerDescriptions} split ${sp.amount} (each ${share}).`);
		}

	});
	enqueueNotification("Showdown complete.");
	pot = 0;
	document.getElementById("pot").textContent = pot;
	startButton.textContent = "New Round";
	startButton.classList.remove("hidden");
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
			msg = `${player.name} is all-in (${amount}).`;
			break;
		case "postblind":
			msg = `${player.name} posted blind of ${amount}.`;
			break;
		default:
			msg = `${player.name} did something…`;
	}
	enqueueNotification(msg);
}

/**
 * Display the next notification from the queue.
 */
function displayNextNotification() {
	if (notificationQueue.length === 0) {
		isDisplayingNotification = false;
		return;
	}
	isDisplayingNotification = true;
	const msg = notificationQueue.shift();
	notification.textContent = msg;
	console.log("Notification:", msg);
	// Display each notification for 2 seconds
	setTimeout(() => {
		displayNextNotification();
	}, 2000);
}

function enqueueNotification(msg) {
	notificationQueue.push(msg);
	if (!isDisplayingNotification) {
		displayNextNotification();
	}
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
	init, players, preFlop
};

poker.init();
