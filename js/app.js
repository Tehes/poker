/* --------------------------------------------------------------------------------------------------
Imports
---------------------------------------------------------------------------------------------------*/

/* --------------------------------------------------------------------------------------------------
Variables
---------------------------------------------------------------------------------------------------*/
var rotateIcons = document.querySelectorAll(".seat .rotate");

/* --------------------------------------------------------------------------------------------------
functions
---------------------------------------------------------------------------------------------------*/
function rotateSeat() {
	var seat = event.target.parentElement.parentElement;
	seat.dataset.rotation = parseInt(seat.dataset.rotation)+90;
	seat.style.transform = "rotate("+ seat.dataset.rotation +"deg)";
}


function init() {
    document.addEventListener("touchstart", function() {}, false);
	
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
