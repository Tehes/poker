/* --------------------------------------------------------------------------------------------------
Seat Action Controls
---------------------------------------------------------------------------------------------------*/

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
	onActionError = null,
}) {
	let currentPendingAction = null;
	let isSubmittingAction = false;

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
	}

	function updatePrimaryActionLabel() {
		if (!currentPendingAction) {
			return;
		}

		const amount = clampActionAmount(
			Number.parseInt(amountSlider.value, 10),
			currentPendingAction,
		);
		sliderOutput.value = amount;
		sliderOutput.classList.toggle("invalid", isInvalidRaiseAmount(amount, currentPendingAction));
		actionButton.textContent = getActionButtonLabel(amount, currentPendingAction);
	}

	function handleActionSliderInput() {
		updatePrimaryActionLabel();
	}

	function handleActionSliderChange() {
		if (!currentPendingAction) {
			return;
		}

		const amount = Number.parseInt(amountSlider.value, 10);
		const normalizedAmount = normalizeActionAmount(amount, currentPendingAction);
		amountSlider.value = normalizedAmount;
		sliderOutput.value = normalizedAmount;
		sliderOutput.classList.remove("invalid");
		updatePrimaryActionLabel();
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
		amountSlider.addEventListener("input", handleActionSliderInput);
		amountSlider.addEventListener("change", handleActionSliderChange);
		foldButton.addEventListener("click", handleFoldAction);
		actionButton.addEventListener("click", handlePrimaryAction);
	}

	function hide() {
		currentPendingAction = null;
		isSubmittingAction = false;
		setVisible(false);
		sliderOutput.classList.remove("invalid");
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

		amountSlider.min = pendingAction.minAmount;
		amountSlider.max = pendingAction.maxAmount;
		amountSlider.step = actionStep;

		if (isNewTurn) {
			isSubmittingAction = false;
			amountSlider.value = pendingAction.minAmount;
		} else {
			const currentAmount = Number.parseInt(amountSlider.value, 10);
			amountSlider.value = clampActionAmount(currentAmount, pendingAction);
		}

		updatePrimaryActionLabel();
		setEnabled(!isSubmittingAction);
	}

	return {
		init,
		hide,
		render,
	};
}
