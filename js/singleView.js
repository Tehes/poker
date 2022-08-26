/* --------------------------------------------------------------------------------------------------
Imports
---------------------------------------------------------------------------------------------------*/

/* --------------------------------------------------------------------------------------------------
Variables
---------------------------------------------------------------------------------------------------*/


/* --------------------------------------------------------------------------------------------------
functions
---------------------------------------------------------------------------------------------------*/

function init() {
    document.addEventListener("touchstart", function() {}, false);

    var queryString = window.location.search;
    var urlParams = new URLSearchParams(queryString);

    var params= urlParams.get('cards').split('-');

    var slots = document.querySelectorAll("img");
    slots[0].src = "cards/"+params[0]+".svg";
    slots[1].src = "cards/"+params[1]+".svg";

    var nameBadge = document.querySelector("h3");
    nameBadge.textContent = params[2];

    var chips = document.querySelector(".total");
    chips.textContent = params[3];
}

/* --------------------------------------------------------------------------------------------------
public members, exposed with return statement
---------------------------------------------------------------------------------------------------*/
window.app = {
    init
};

app.init();
