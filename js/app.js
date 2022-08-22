/* --------------------------------------------------------------------------------------------------
Imports
---------------------------------------------------------------------------------------------------*/

/* --------------------------------------------------------------------------------------------------
Variables
---------------------------------------------------------------------------------------------------*/
var startButton = document.querySelector("aside button");
var rotateIcons = document.querySelectorAll(".seat .rotate");
var nameBadges = document.querySelectorAll("h3");
var qrCodes = document.querySelectorAll(".qr");
var holeCards = document.querySelectorAll("img:not([class])");
var closeButtons = document.querySelectorAll(".close");

// Clubs, Diamonds, Hearts, Spades
// 2,3,4,5,6,7,8,9,T,J,Q,K,A
var cards = [
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

var players = [];

/* --------------------------------------------------------------------------------------------------
functions
---------------------------------------------------------------------------------------------------*/
Array.prototype.shuffle = function () {
	var i = this.length;
	while (i) {
		var j = Math.floor(Math.random() * i);
		var t = this[--i];
		this[i] = this[j];
		this[j] = t;
	}
	return this;
};

function startGame(event) {
	for (var rotateIcon of rotateIcons) {
		rotateIcon.classList.add("hidden");
	}
	for (var closeButton of closeButtons) {
		closeButton.classList.add("hidden");
	}
	for (var name of nameBadges) {
		name.contentEditable = "false";
	}
	event.target.classList.add("hidden");

	var activePlayers = document.querySelectorAll(".seat:not(.hidden)");
	for (const player of activePlayers) {
		var playerObject = {
			name: player.querySelector("h3").textContent,
			seat: player,
			qr: player.querySelector(".qr"),
			cards: player.querySelectorAll(".card"),
			dealerButton: player.querySelector(".dealer"),
			totalChips: player.querySelector(".chips .total").textContent,
			betChips: player.querySelector(".chips .bet").textContent,
		}
		players.push(playerObject);
	}
	
	console.log(players[0]);
}

function rotateSeat(event) {
	var seat = event.target.parentElement.parentElement;
	seat.dataset.rotation = parseInt(seat.dataset.rotation) + 90;
	seat.style.transform = "rotate(" + seat.dataset.rotation + "deg)";
}

function deletePlayer(event) {
	var seat = event.target.parentElement.parentElement;
	seat.classList.add("hidden");
}


function init() {
	document.addEventListener("touchstart", function () { }, false);
	startButton.addEventListener("click", startGame, false);

	for (var rotateIcon of rotateIcons) {
		rotateIcon.addEventListener("click", rotateSeat, false);
	}
	for (var closeButton of closeButtons) {
		closeButton.addEventListener("click", deletePlayer, false);
	}
}

/* --------------------------------------------------------------------------------------------------
public members, exposed with return statement
---------------------------------------------------------------------------------------------------*/
window.app = {
	init
};

app.init();
