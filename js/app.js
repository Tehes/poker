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
		notification.textContent = "Game has begun. ";
		setDealer();
		dealCards();
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
				show: function (card1, card2, name, chips) {
					player.querySelector(".qr").classList.remove("hidden");
					player.querySelector(".qr").src = "https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=" + window.location.href + "hole-cards.html?cards=" + card1 + "-" + card2 + "-" + name + "-" + chips;
				},
				hide: function () {
					player.querySelector(".qr").classList.add("hidden");
				}
			},
			cards: player.querySelectorAll(".card"),
			dealer: false,
			dealerButton: {
				show: function () {
					player.querySelector(".dealer").classList.remove("hidden");
				},
				hide: function () {
					player.querySelector(".dealer").classList.add("hidden");
				}
			},
			totalChips: player.querySelector(".chips .total").textContent,
			betChips: player.querySelector(".chips .bet").textContent,
		};
		players.push(playerObject);
	}
}

function setDealer() {
	const randomPlayerIndex = Math.floor(Math.random() * players.length);
	players[randomPlayerIndex].dealer = true;
	players[randomPlayerIndex].dealerButton.show();
}

function dealCards() {
	cards = cards.concat(cardGraveyard);
	cardGraveyard = [];
	cards.shuffle();

	for (const player of players) {
		player.cards[0].dataset.value = cards[0];
		player.cards[1].dataset.value = cards[1];
		player.qr.show(cards[0], cards[1], player.name, player.totalChips);
		cardGraveyard.push(cards.shift());
		cardGraveyard.push(cards.shift());
	}
}

function rotateSeat(event) {
	const seat = event.target.parentElement.parentElement;
	seat.dataset.rotation = parseInt(seat.dataset.rotation) + 90;
	seat.style.transform = "rotate(" + seat.dataset.rotation + "deg)";
}

function deletePlayer(event) {
	const seat = event.target.parentElement.parentElement;
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
	init, players, cards, cardGraveyard
};

poker.init();
