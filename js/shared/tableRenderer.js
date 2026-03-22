/* --------------------------------------------------------------------------------------------------
Table Renderer Helpers
---------------------------------------------------------------------------------------------------*/

const MAX_VISUAL_STACK_CHIPS = 10;

export function renderNotificationBar(container, messages = [], fallbackText = "") {
	if (!container) {
		return;
	}

	container.replaceChildren();

	const normalizedMessages = Array.isArray(messages)
		? messages.filter((message) => typeof message === "string" && message.trim() !== "")
		: [];

	if (normalizedMessages.length === 0) {
		container.textContent = fallbackText;
		return;
	}

	normalizedMessages.forEach((message) => {
		const item = document.createElement("span");
		item.textContent = message;
		container.appendChild(item);
	});
}

export function getVisualChipCount(chips, chipLeader) {
	if (chips <= 0 || chipLeader <= 0) {
		return 0;
	}

	return Math.min(
		MAX_VISUAL_STACK_CHIPS,
		Math.ceil((chips / chipLeader) * MAX_VISUAL_STACK_CHIPS),
	);
}

export function renderChipStacks(playerList = []) {
	const chipLeader = playerList.reduce(
		(maxChips, player) => Math.max(maxChips, player.chips),
		0,
	);

	playerList.forEach((player) => {
		const visibleChips = getVisualChipCount(player.chips, chipLeader);

		player.stackChipEls.forEach((chipEl, index) => {
			chipEl.classList.toggle("hidden", index >= visibleChips);
		});
	});
}

export function renderCommunityCards(cardSlots, cardCodes = []) {
	cardSlots.forEach((slot, index) => {
		const cardCode = cardCodes[index];
		if (!cardCode) {
			slot.innerHTML = "";
			return;
		}
		slot.innerHTML = `<img src="cards/${cardCode}.svg">`;
	});
}

export function renderSeatCards(cardEls, cardCodes = []) {
	cardEls.forEach((cardEl, index) => {
		const cardCode = cardCodes[index];
		cardEl.src = cardCode ? `cards/${cardCode}.svg` : "cards/1B.svg";
	});
}

export function renderSeatPill(el, label, shouldShow = true) {
	if (!el) {
		return;
	}

	const show = shouldShow && !!label;
	el.textContent = show ? label : "";
	el.classList.toggle("hidden", !show);
}

export function clearRenderedSeat(seatRef) {
	seatRef.seatEl.classList.add("hidden");
	seatRef.seatEl.classList.remove(
		"active",
		"folded",
		"checked",
		"called",
		"raised",
		"allin",
		"winner",
		"action-label",
	);
	renderSeatCards(seatRef.cardEls, []);
	seatRef.nameEl.textContent = "";
	seatRef.totalEl.textContent = "0";
	seatRef.betEl.textContent = "0";
	seatRef.stackChipEls.forEach((chipEl) => chipEl.classList.add("hidden"));
	seatRef.dealerEl.classList.add("hidden");
	seatRef.smallBlindEl.classList.add("hidden");
	seatRef.bigBlindEl.classList.add("hidden");
	renderSeatPill(seatRef.handStrengthEl, "", false);
	renderSeatPill(seatRef.winProbabilityEl, "", false);
}

export function renderProjectedSeat(
	seatRef,
	publicSeat,
	{ activeSeatIndex = null, ownSeatIndex = null, ownSeatView = null } = {},
) {
	const isOwnSeat = publicSeat.seatIndex === ownSeatIndex && ownSeatView;
	const holeCards = isOwnSeat ? ownSeatView.holeCards : publicSeat.publicHoleCards;
	const handStrengthLabel = isOwnSeat
		? ownSeatView.handStrengthLabel
		: publicSeat.handStrengthLabel;
	const showWinProbability = isOwnSeat
		? ownSeatView.showWinProbability === true
		: publicSeat.showWinProbability === true;
	const winProbability = isOwnSeat ? ownSeatView.winProbability : publicSeat.winProbability;

	seatRef.seatEl.classList.remove("hidden");
	seatRef.seatEl.classList.toggle("active", activeSeatIndex === publicSeat.seatIndex);
	seatRef.seatEl.classList.toggle("folded", publicSeat.folded === true);
	seatRef.seatEl.classList.toggle("allin", publicSeat.allIn === true);
	seatRef.nameEl.textContent = publicSeat.name;
	seatRef.totalEl.textContent = `${publicSeat.chips}`;
	seatRef.betEl.textContent = `${publicSeat.roundBet}`;
	seatRef.dealerEl.classList.toggle("hidden", publicSeat.dealer !== true);
	seatRef.smallBlindEl.classList.toggle("hidden", publicSeat.smallBlind !== true);
	seatRef.bigBlindEl.classList.toggle("hidden", publicSeat.bigBlind !== true);
	renderSeatCards(seatRef.cardEls, holeCards);
	renderSeatPill(seatRef.handStrengthEl, handStrengthLabel);
	renderSeatPill(
		seatRef.winProbabilityEl,
		showWinProbability && typeof winProbability === "number"
			? `${Math.round(winProbability)}%`
			: "",
		showWinProbability,
	);
}
