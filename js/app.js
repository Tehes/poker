/* --------------------------------------------------------------------------------------------------
Imports
---------------------------------------------------------------------------------------------------*/

/* --------------------------------------------------------------------------------------------------
Variables
---------------------------------------------------------------------------------------------------*/
const startButton = document.querySelector("aside button");
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
	createPlayers();
	// Reset folded state at the beginning of each new hand
	players.forEach(p => p.folded = false);

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
		setDealer();
		setBlinds();
		dealCards();
		startBettingRound();
		pot = 0;
		document.getElementById("pot").textContent = pot;
	}
	else {
		for (const name of nameBadges) {
			if (name.textContent === "") {
				name.parentElement.classList.remove("hidden");
			}
			notification.textContent = "Not enough players";
			players = [];
		}
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
			roundBet: 0,
			showTotal: function () {
				player.querySelector(".chips .total").textContent = playerObject.chips;
			},
			placeBet: function (x) {
				playerObject.roundBet += x;
				player.querySelector(".chips .bet").textContent = playerObject.roundBet;
				playerObject.chips -= x;
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
		const isDealer = (element) => element.dealer === true;
		const dealerIndex = players.findIndex(isDealer);
		players[dealerIndex].dealer = false;
		players[dealerIndex].clearRole('dealer');
		players[dealerIndex + 1].dealer = true;
		players[dealerIndex + 1].assignRole('dealer');
	}

	while (players[0].dealer === false) {
		players.unshift(players.pop());
	}

	notification.textContent = players[0].name + " is Dealer. ";
}

function setBlinds() {
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
	// Assign new blinds
	players[sbIdx].assignRole('small-blind');
	players[bbIdx].assignRole('big-blind');
	currentBet = bigBlind;

	notification.textContent += players[sbIdx].name + " is small Blind. ";
	notification.textContent += players[bbIdx].name + " is big Blind";
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

function setPhase() {
	// If only one player remains, skip community deals and go straight to showdown
	const activePlayers = players.filter(p => !p.folded);
	if (activePlayers.length <= 1) {
		return doShowdown();
	}
	currentPhaseIndex++;
	switch (Phases[currentPhaseIndex]) {
		case "flop": dealCommunityCards(3); startBettingRound(); break;
		case "turn": dealCommunityCards(1); startBettingRound(); break;
		case "river": dealCommunityCards(1); startBettingRound(); break;
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

function doShowdown() {
	// Showdown logic not yet implemented
	notification.textContent = "Showdown: determining winner...";
	// TODO: implement hand evaluation and pot distribution
}

function startBettingRound() {
	// If only one player remains, proceed directly to showdown
	const activePlayers = players.filter(p => !p.folded);
	if (activePlayers.length <= 1) {
		return setPhase();
	}

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
		return players.some(p => !p.folded && p.roundBet < currentBet);
	}

	function nextPlayer() {
		// Find next player who still owes action
		let player = players[idx % players.length];
		idx++;
		cycles++;

		// Always skip folded players
		if (player.folded) {
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
		// Determine minimum bet as the lesser of needToCall and player chips
		const minBet = Math.min(needToCall, player.chips);
		amountSlider.min = minBet;
		// Cap slider to player's available chips
		amountSlider.max = player.chips;
		amountSlider.value = minBet;
		amountSlider.nextElementSibling.value = amountSlider.value;
		foldButton.disabled = false;
		actionButton.disabled = false;

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
			if (bet > needToCall) currentBet = player.roundBet + bet;
			player.placeBet(bet);
			pot += bet;
			document.getElementById("pot").textContent = pot;
			player.seat.classList.remove('active');
			amountSlider.removeEventListener("input", onSliderInput);
			foldButton.removeEventListener("click", onFold);
			actionButton.removeEventListener("click", onAction);
			nextPlayer();
		}
		function onFold() {
			player.folded = true;
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

function rotateSeat(ev) {
	const seat = ev.target.parentElement.parentElement;
	seat.dataset.rotation = parseInt(seat.dataset.rotation) + 90;
	seat.style.transform = "rotate(" + seat.dataset.rotation + "deg)";
}

function deletePlayer(ev) {
	const seat = ev.target.parentElement.parentElement;
	seat.classList.add("hidden");
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
