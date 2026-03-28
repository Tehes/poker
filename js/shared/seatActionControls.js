/* --------------------------------------------------------------------------------------------------
Seat Action Controls
---------------------------------------------------------------------------------------------------*/

// Shared remote action-control wiring for seat-based views.
// Put code here for slider/button state, request submission, and pending-action driven visibility.
// Do not embed poker rules already covered by actionModel, nor polling, rendering, or full game flow here.

import {
	clampActionAmount,
	getActionButtonLabel,
	getActionRequestForAmount,
	isInvalidRaiseAmount,
	normalizeActionAmount,
} from "./actionModel.js";

export function shouldShowSeatActionControls(seatView, pendingAction, seatIndex) {
	return !!pendingAction &&
		pendingAction.seatIndex === seatIndex &&
		!seatView.folded &&
		!seatView.allIn;
}

export function getSeatPendingAction(tableView, seatIndex) {
	const tablePendingAction = tableView?.pendingAction ?? null;
	if (tablePendingAction?.seatIndex === seatIndex) {
		return tablePendingAction;
	}
	return null;
}

export function configureViewSwitchLink(linkEl, targetPath, tableId, seatIndex) {
	if (!linkEl || !tableId || seatIndex === null) {
		return;
	}
	linkEl.href = `${targetPath}?tableId=${encodeURIComponent(tableId)}&seatIndex=${seatIndex}`;
}

export function setViewSwitchLinkVisible(linkEl, isVisible) {
	if (!linkEl) {
		return;
	}
	linkEl.classList.toggle("hidden", !isVisible);
}

function getSliderStepAmount(amountSlider) {
	const parsedStep = Number.parseInt(amountSlider.step, 10);
	if (Number.isNaN(parsedStep) || parsedStep <= 0) {
		return 1;
	}
	return parsedStep;
}

function getSteppedActionAmount(currentAmount, actionState, sliderStep, direction) {
	const nextAmount = clampActionAmount(currentAmount + (direction * sliderStep), actionState);
	if (!isInvalidRaiseAmount(nextAmount, actionState)) {
		return nextAmount;
	}

	return direction > 0
		? normalizeActionAmount(nextAmount, actionState)
		: actionState.minAmount;
}

export function createActionAmountControls({
	actionButton,
	amountSlider,
	sliderOutput,
	decrementButton = null,
	incrementButton = null,
}) {
	let currentActionState = null;

	function setCurrentAmount(amount, { normalize = false } = {}) {
		if (!currentActionState) {
			return;
		}

		const parsedAmount = Number.isNaN(amount) ? currentActionState.minAmount : amount;
		const nextAmount = normalize
			? normalizeActionAmount(parsedAmount, currentActionState)
			: clampActionAmount(parsedAmount, currentActionState);

		amountSlider.value = nextAmount;
		sliderOutput.value = nextAmount;
		sliderOutput.classList.toggle("invalid", isInvalidRaiseAmount(nextAmount, currentActionState));
		actionButton.textContent = getActionButtonLabel(nextAmount, currentActionState);
	}

	function handleActionSliderInput() {
		setCurrentAmount(Number.parseInt(amountSlider.value, 10));
	}

	function handleActionSliderChange() {
		setCurrentAmount(Number.parseInt(amountSlider.value, 10), { normalize: true });
	}

	function stepAmount(direction) {
		if (!currentActionState) {
			return;
		}

		const currentAmount = clampActionAmount(
			Number.parseInt(amountSlider.value, 10),
			currentActionState,
		);
		const sliderStep = getSliderStepAmount(amountSlider);
		const nextAmount = getSteppedActionAmount(
			currentAmount,
			currentActionState,
			sliderStep,
			direction,
		);
		setCurrentAmount(nextAmount);
	}

	function handleDecrementClick() {
		stepAmount(-1);
	}

	function handleIncrementClick() {
		stepAmount(1);
	}

	function init() {
		amountSlider.addEventListener("input", handleActionSliderInput);
		amountSlider.addEventListener("change", handleActionSliderChange);
		decrementButton?.addEventListener("click", handleDecrementClick);
		incrementButton?.addEventListener("click", handleIncrementClick);
	}

	function clear() {
		currentActionState = null;
		sliderOutput.classList.remove("invalid");
	}

	function render(actionState, { actionStep = amountSlider.step, resetAmount = false } = {}) {
		currentActionState = actionState;
		if (!currentActionState) {
			clear();
			return;
		}

		amountSlider.min = currentActionState.minAmount;
		amountSlider.max = currentActionState.maxAmount;
		amountSlider.step = actionStep;

		if (resetAmount) {
			amountSlider.value = currentActionState.minAmount;
		}

		setCurrentAmount(Number.parseInt(amountSlider.value, 10));
	}

	return {
		init,
		clear,
		render,
	};
}

export function createSeatActionControls({
	tableId,
	seatIndex,
	actionEndpoint,
	actionStep = 10,
	visibleElements = [],
	foldButton,
	actionButton,
	amountSlider,
	sliderOutput,
	decrementButton = null,
	incrementButton = null,
	onActionError = null,
}) {
	let currentPendingAction = null;
	let isSubmittingAction = false;
	const amountControls = createActionAmountControls({
		actionButton,
		amountSlider,
		sliderOutput,
		decrementButton,
		incrementButton,
	});

	function setVisible(isVisible) {
		visibleElements.forEach((el) => {
			if (!el) {
				return;
			}
			el.classList.toggle("hidden", !isVisible);
		});
	}

	function setEnabled(enabled) {
		foldButton.disabled = !enabled;
		actionButton.disabled = !enabled;
		amountSlider.disabled = !enabled;
		if (decrementButton) {
			decrementButton.disabled = !enabled;
		}
		if (incrementButton) {
			incrementButton.disabled = !enabled;
		}
	}

	async function submitActionRequest(action, amount = null) {
		if (!currentPendingAction || !tableId || seatIndex === null || isSubmittingAction) {
			return;
		}

		isSubmittingAction = true;
		setEnabled(false);

		try {
			const res = await fetch(actionEndpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					tableId,
					seatIndex,
					turnToken: currentPendingAction.turnToken,
					action,
					amount,
				}),
			});
			if (!res.ok) {
				throw new Error(`action request failed with status ${res.status}`);
			}
		} catch (error) {
			console.warn("action request failed", error);
			isSubmittingAction = false;
			setEnabled(true);
			if (typeof onActionError === "function") {
				onActionError(error);
			}
		}
	}

	function handlePrimaryAction() {
		if (!currentPendingAction) {
			return;
		}

		const amount = Number.parseInt(amountSlider.value, 10);
		if (Number.isNaN(amount)) {
			return;
		}

		const request = getActionRequestForAmount(amount, currentPendingAction);
		submitActionRequest(request.action, request.amount);
	}

	function handleFoldAction() {
		submitActionRequest("fold");
	}

	function init() {
		amountControls.init();
		foldButton.addEventListener("click", handleFoldAction);
		actionButton.addEventListener("click", handlePrimaryAction);
	}

	function hide() {
		currentPendingAction = null;
		isSubmittingAction = false;
		setVisible(false);
		amountControls.clear();
		setEnabled(false);
	}

	function render(seatView, pendingAction) {
		if (!shouldShowSeatActionControls(seatView, pendingAction, seatIndex)) {
			hide();
			return;
		}

		const isNewTurn = currentPendingAction?.turnToken !== pendingAction.turnToken;
		currentPendingAction = pendingAction;
		setVisible(true);
		if (isNewTurn) {
			isSubmittingAction = false;
		}
		amountControls.render(pendingAction, {
			actionStep,
			resetAmount: isNewTurn,
		});
		setEnabled(!isSubmittingAction);
	}

	return {
		init,
		hide,
		render,
	};
}
