/* --------------------------------------------------------------------------------------------------
Imports
---------------------------------------------------------------------------------------------------*/

/* --------------------------------------------------------------------------------------------------
Variables
---------------------------------------------------------------------------------------------------*/
var startButton = document.querySelector("aside button");
var rotateIcons = document.querySelectorAll(".seat .rotate");
var nameBadges = document.querySelectorAll("h3");

/* --------------------------------------------------------------------------------------------------
functions
---------------------------------------------------------------------------------------------------*/
function startGame() {
	for (var rotateIcon of rotateIcons) {
		rotateIcon.classList.add("hidden");
	}
	for (var name of nameBadges) {
		name.contentEditable = "false";
	}
	event.target.classList.add("hidden");
}

function rotateSeat() {
	var seat = event.target.parentElement.parentElement;
	seat.dataset.rotation = parseInt(seat.dataset.rotation)+90;
	seat.style.transform = "rotate("+ seat.dataset.rotation +"deg)";
}


function init() {
    document.addEventListener("touchstart", function() {}, false);
	startButton.addEventListener("click", startGame, false);
	
	for (var rotateIcon of rotateIcons) {
		rotateIcon.addEventListener("click", rotateSeat, false);
	}
}

/* --------------------------------------------------------------------------------------------------
public members, exposed with return statement
---------------------------------------------------------------------------------------------------*/
window.app = {
    init
};

app.init();
