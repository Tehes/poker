/* --------------------------------------------------------------------------------------------------
Table View Renderer Helpers
---------------------------------------------------------------------------------------------------*/

// Shared DOM renderer for synced table views, including seat state and transient table animations.
// Put code here when a caller already decided the display state and only the DOM update is missing.
// Do not decide poker rules, sync payload shape, polling behavior, or visibility policy here.

const MAX_VISUAL_STACK_CHIPS = 10;

function getSeatEl(target) {
	return target?.seatEl ?? target?.seat ?? null;
}

function getPotEl(target) {
	return target?.potEl ?? null;
}

function getNameEl(target) {
	if (target?.nameEl) {
		return target.nameEl;
	}
	const seatEl = getSeatEl(target);
	return seatEl?.querySelector("h3") ?? null;
}

function getWinnerReactionEl(target) {
	return target?.winnerReactionEl ?? null;
}

function cancelSeatActionLabelTimer(target) {
	if (!target?.actionLabelTimer) {
		return;
	}
	clearTimeout(target.actionLabelTimer);
	target.actionLabelTimer = null;
}

function cancelWinnerReactionTimer(target) {
	if (!target?.winnerReactionTimer) {
		return;
	}
	clearTimeout(target.winnerReactionTimer);
	target.winnerReactionTimer = null;
}

function cancelChipTransferTimer(target) {
	if (!target?.chipTransferTimer) {
		return;
	}
	clearTimeout(target.chipTransferTimer);
	target.chipTransferTimer = null;
}

function getChipTransferIncrement(amount, stepCount) {
	if (!Number.isFinite(amount) || !Number.isFinite(stepCount) || stepCount <= 0) {
		return 0;
	}
	return Math.floor(amount / stepCount);
}

function getPaidChipTransferAmount(transfer, startedAt, now) {
	if (!transfer || !Number.isFinite(transfer.amount)) {
		return 0;
	}

	const amount = transfer.amount;
	const durationMs = Number.isFinite(transfer.durationMs) ? transfer.durationMs : 0;
	const stepCount = Number.isFinite(transfer.stepCount) ? Math.max(0, transfer.stepCount) : 0;
	if (now < startedAt) {
		return 0;
	}
	if (durationMs <= 0 || stepCount === 0) {
		return amount;
	}

	const elapsed = now - startedAt;
	if (elapsed >= durationMs) {
		return amount;
	}

	const stepDuration = durationMs / stepCount;
	if (!Number.isFinite(stepDuration) || stepDuration <= 0) {
		return amount;
	}

	const increment = getChipTransferIncrement(amount, stepCount);
	const completedSteps = Math.min(stepCount, Math.floor(elapsed / stepDuration) + 1);
	return Math.min(amount, increment * completedSteps);
}

function getNextChipTransferUpdateAt(chipTransfer, now) {
	const transfers = Array.isArray(chipTransfer?.transfers) ? chipTransfer.transfers : [];
	const startedAt = Number.isFinite(chipTransfer?.startedAt) ? chipTransfer.startedAt : 0;
	let nextUpdateAt = null;

	transfers.forEach((transfer) => {
		const durationMs = Number.isFinite(transfer?.durationMs) ? transfer.durationMs : 0;
		const stepCount = Number.isFinite(transfer?.stepCount) ? Math.max(0, transfer.stepCount) : 0;
		const endAt = startedAt + durationMs;

		if (now < startedAt) {
			nextUpdateAt = nextUpdateAt === null ? startedAt : Math.min(nextUpdateAt, startedAt);
			return;
		}
		if (durationMs <= 0 || stepCount === 0 || now >= endAt) {
			return;
		}

		const stepDuration = durationMs / stepCount;
		if (!Number.isFinite(stepDuration) || stepDuration <= 0) {
			nextUpdateAt = nextUpdateAt === null ? endAt : Math.min(nextUpdateAt, endAt);
			return;
		}

		const nextStepAt = Math.min(
			endAt,
			startedAt + (Math.floor((now - startedAt) / stepDuration) + 1) * stepDuration,
		);
		nextUpdateAt = nextUpdateAt === null ? nextStepAt : Math.min(nextUpdateAt, nextStepAt);
	});

	return nextUpdateAt;
}

function renderDisplayedChipTransferState(target, finalPot, players, chipTransfer, now) {
	const potEl = getPotEl(target);
	if (!potEl) {
		return { isComplete: true };
	}

	const transfers = Array.isArray(chipTransfer?.transfers) ? chipTransfer.transfers : [];
	const startedAt = Number.isFinite(chipTransfer?.startedAt) ? chipTransfer.startedAt : 0;
	const remainingBySeat = new Map();
	let remainingPot = 0;

	transfers.forEach((transfer) => {
		const amount = Number.isFinite(transfer?.amount) ? transfer.amount : 0;
		if (amount <= 0) {
			return;
		}
		const paidAmount = getPaidChipTransferAmount(transfer, startedAt, now);
		const remainingAmount = Math.max(0, amount - paidAmount);
		if (remainingAmount === 0) {
			return;
		}

		remainingPot += remainingAmount;
		const seatIndex = transfer.seatIndex;
		remainingBySeat.set(seatIndex, (remainingBySeat.get(seatIndex) || 0) + remainingAmount);
	});

	potEl.textContent = `${finalPot + remainingPot}`;

	const displayPlayers = players.map((player) => {
		const remainingAmount = remainingBySeat.get(player.seatIndex) || 0;
		const visibleChips = player.chips - remainingAmount;
		if (player.totalEl) {
			player.totalEl.textContent = `${visibleChips}`;
		}
		return {
			chips: visibleChips,
			stackChipEls: player.stackChipEls,
		};
	});

	renderChipStacks(displayPlayers);

	return {
		isComplete: remainingPot === 0,
	};
}

export function getActionLabelBadgeText(actionName = "") {
	switch (actionName) {
		case "fold":
			return "Fold";
		case "check":
			return "Check";
		case "call":
			return "Call";
		case "raise":
			return "Raise";
		case "allin":
			return "All-In";
		default:
			return "";
	}
}

export function clearSeatActionLabel(target, playerName = "") {
	const seatEl = getSeatEl(target);
	const nameEl = getNameEl(target);
	cancelSeatActionLabelTimer(target);
	if (!seatEl || !nameEl) {
		return;
	}
	seatEl.classList.remove("action-label");
	nameEl.textContent = playerName;
	if (typeof target.clearActionLabelState === "function") {
		target.clearActionLabelState();
	}
}

export function renderSeatActionLabel(
	target,
	{ playerName = "", actionName = "", labelUntil = 0 } = {},
) {
	const seatEl = getSeatEl(target);
	const nameEl = getNameEl(target);
	cancelSeatActionLabelTimer(target);
	if (!seatEl || !nameEl) {
		return;
	}

	const actionLabel = getActionLabelBadgeText(actionName);
	if (!actionLabel) {
		clearSeatActionLabel(target, playerName);
		return;
	}

	seatEl.classList.add("action-label");
	nameEl.textContent = actionLabel;

	const remainingDuration = Number.isFinite(labelUntil) ? Math.max(0, labelUntil - Date.now()) : 0;
	if (remainingDuration === 0) {
		clearSeatActionLabel(target, playerName);
		return;
	}

	target.actionLabelTimer = setTimeout(() => {
		clearSeatActionLabel(target, playerName);
	}, remainingDuration);
}

export function clearWinnerReaction(target) {
	const winnerReactionEl = getWinnerReactionEl(target);
	cancelWinnerReactionTimer(target);
	if (!winnerReactionEl) {
		return;
	}
	winnerReactionEl.textContent = "";
	winnerReactionEl.classList.remove("visible");
	winnerReactionEl.classList.add("hidden");
	if (typeof target.clearWinnerReactionState === "function") {
		target.clearWinnerReactionState();
	}
}

export function showWinnerReaction(target, emoji = "", visibleUntil = 0) {
	const winnerReactionEl = getWinnerReactionEl(target);
	cancelWinnerReactionTimer(target);
	if (!winnerReactionEl || !emoji) {
		clearWinnerReaction(target);
		return;
	}

	const remainingDuration = Number.isFinite(visibleUntil)
		? Math.max(0, visibleUntil - Date.now())
		: 0;
	if (remainingDuration === 0) {
		clearWinnerReaction(target);
		return;
	}

	winnerReactionEl.textContent = emoji;
	winnerReactionEl.classList.remove("visible");
	winnerReactionEl.classList.remove("hidden");
	void winnerReactionEl.offsetWidth;
	winnerReactionEl.classList.add("visible");
	target.winnerReactionTimer = setTimeout(() => {
		clearWinnerReaction(target);
	}, remainingDuration);
}

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

export function renderSeatWinnerState(target, isWinner = false) {
	const seatEl = getSeatEl(target);
	if (!seatEl) {
		return;
	}

	seatEl.classList.toggle("winner", isWinner === true);
}

export function clearChipTransferAnimation(target) {
	cancelChipTransferTimer(target);
	if (target) {
		target.activeChipTransferId = null;
		target.activeChipTransferState = null;
	}
}

export function renderChipTransferAnimation(
	target,
	{ finalPot = 0, players = [], chipTransfer = null } = {},
) {
	const normalizedPlayers = Array.isArray(players)
		? players.filter((player) =>
			Number.isFinite(player?.seatIndex) &&
			Number.isFinite(player?.chips) &&
			player?.totalEl &&
			player?.stackChipEls
		)
		: [];
	const transfers = Array.isArray(chipTransfer?.transfers)
		? chipTransfer.transfers.filter((transfer) =>
			Number.isFinite(transfer?.seatIndex) &&
			Number.isFinite(transfer?.amount) &&
			Number.isFinite(transfer?.durationMs) &&
			Number.isFinite(transfer?.stepCount)
		)
		: [];

	if (
		!target ||
		!getPotEl(target) ||
		normalizedPlayers.length === 0 ||
		transfers.length === 0 ||
		!Number.isFinite(chipTransfer?.startedAt)
	) {
		clearChipTransferAnimation(target);
		return;
	}

	const normalizedChipTransfer = { ...chipTransfer, transfers };
	const transferId = chipTransfer.id ?? null;
	const isSameActiveTransfer = transferId !== null && target.activeChipTransferId === transferId;

	target.activeChipTransferId = transferId;
	target.activeChipTransferState = {
		finalPot,
		players: normalizedPlayers,
		chipTransfer: normalizedChipTransfer,
	};

	if (!isSameActiveTransfer) {
		cancelChipTransferTimer(target);
	} else if (target.chipTransferTimer) {
		const { isComplete } = renderDisplayedChipTransferState(
			target,
			finalPot,
			normalizedPlayers,
			normalizedChipTransfer,
			Date.now(),
		);
		if (isComplete) {
			cancelChipTransferTimer(target);
		}
		return;
	}

	function renderStep() {
		const activeState = target?.activeChipTransferState;
		if (!activeState) {
			clearChipTransferAnimation(target);
			return;
		}

		const now = Date.now();
		const { isComplete } = renderDisplayedChipTransferState(
			target,
			activeState.finalPot,
			activeState.players,
			activeState.chipTransfer,
			now,
		);
		if (isComplete) {
			cancelChipTransferTimer(target);
			return;
		}

		const nextUpdateAt = getNextChipTransferUpdateAt(activeState.chipTransfer, now);
		if (nextUpdateAt === null) {
			cancelChipTransferTimer(target);
			return;
		}

		target.chipTransferTimer = setTimeout(renderStep, Math.max(0, Math.ceil(nextUpdateAt - now)));
	}

	renderStep();
}

export function clearRenderedSeat(seatRef) {
	clearSeatActionLabel(seatRef, "");
	clearWinnerReaction(seatRef);
	renderSeatWinnerState(seatRef, false);
	seatRef.seatEl.classList.add("hidden");
	seatRef.seatEl.classList.remove(
		"active",
		"folded",
		"checked",
		"called",
		"raised",
		"allin",
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
	renderSeatWinnerState(seatRef, publicSeat.winner === true);
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
