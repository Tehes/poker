/* --------------------------------------------------------------------------------------------------
Human Turn Controller And Seat Action Controls
---------------------------------------------------------------------------------------------------*/

// Shared action-control wiring for host, remote, and single-seat views.
// This file is intentionally layered:
// 1) amount-only slider/button math
// 2) one shared interactive control shell
// 3) thin flow-specific wrappers for host and synced seat views
// Do not embed poker rules already covered by actionModel, nor generic rendering.

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

	return direction > 0 ? normalizeActionAmount(nextAmount, actionState) : actionState.minAmount;
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
		sliderOutput.classList.toggle(
			"invalid",
			isInvalidRaiseAmount(nextAmount, currentActionState),
		);
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

function createTurnActionUi({
	visibleElements,
	foldButton,
	actionButton,
	amountSlider,
	sliderOutput,
	decrementButton = null,
	incrementButton = null,
	actionStep = 10,
	onHidden = null,
}) {
	let isInitialized = false;
	let currentActionState = null;
	let currentOnSubmit = null;
	let currentOnFold = null;
	const amountControls = createActionAmountControls({
		actionButton,
		amountSlider,
		sliderOutput,
		decrementButton,
		incrementButton,
	});

	// Keep all DOM-only control behavior in one place so host and remote flows cannot drift.

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

	function handlePrimaryAction() {
		if (!currentActionState || typeof currentOnSubmit !== "function") {
			return;
		}

		const amount = Number.parseInt(amountSlider.value, 10);
		if (Number.isNaN(amount)) {
			return;
		}

		const actionRequest = getActionRequestForAmount(amount, currentActionState);
		currentOnSubmit(actionRequest);
	}

	function handleFoldAction() {
		if (typeof currentOnFold !== "function") {
			return;
		}
		currentOnFold();
	}

	function init() {
		if (isInitialized) {
			return;
		}

		amountControls.init();
		foldButton.addEventListener("click", handleFoldAction);
		actionButton.addEventListener("click", handlePrimaryAction);
		isInitialized = true;
		hide();
	}

	function show(actionState, {
		resetAmount = false,
		enabled = true,
		onSubmit = null,
		onFold = null,
	} = {}) {
		if (!isInitialized) {
			init();
		}

		currentActionState = actionState;
		currentOnSubmit = onSubmit;
		currentOnFold = onFold;
		setVisible(true);
		amountControls.render(actionState, {
			actionStep,
			resetAmount,
		});
		setEnabled(enabled);
	}

	function hide() {
		currentActionState = null;
		currentOnSubmit = null;
		currentOnFold = null;
		setVisible(false);
		amountControls.clear();
		setEnabled(false);
		onHidden?.();
	}

	return {
		init,
		show,
		hide,
		setEnabled,
	};
}

export function createHumanTurnController({
	foldButton,
	actionButton,
	amountControls,
	amountSlider,
	sliderOutput,
	decrementButton = null,
	incrementButton = null,
	actionPollInterval = 1000,
	actionStep = 10,
	onControlsHidden = null,
	setActiveTurnPlayer,
	setPendingAction,
	clearPendingAction,
	fetchPendingRemoteAction,
	applyTurnAction,
	continueAfterResolvedTurn,
	getPlayerActionState,
	getResolvedTurnMeta,
}) {
	// The host wrapper owns turn session state and polling.
	// The shared UI shell above only handles controls, listeners, and reset behavior.
	let activeTurnState = null;
	const turnActionUi = createTurnActionUi({
		visibleElements: [
			foldButton,
			actionButton,
			amountControls,
		],
		foldButton,
		actionButton,
		amountSlider,
		sliderOutput,
		decrementButton,
		incrementButton,
		actionStep,
		onHidden: onControlsHidden,
	});

	function clearRemoteActionTimer(turnState) {
		if (!turnState || turnState.remoteActionTimer === null) {
			return;
		}
		clearTimeout(turnState.remoteActionTimer);
		turnState.remoteActionTimer = null;
	}

	function releaseActiveTurn({ clearPending = false } = {}) {
		const turnState = activeTurnState;
		if (turnState) {
			turnState.cancelled = true;
			clearRemoteActionTimer(turnState);
			if (
				clearPending &&
				turnState.pendingAction &&
				turnState.pendingActionCleared !== true
			) {
				clearPendingAction();
				turnState.pendingActionCleared = true;
			}
			activeTurnState = null;
		}
		turnActionUi.hide();
	}

	function init() {
		turnActionUi.init();
	}

	function hide() {
		releaseActiveTurn({ clearPending: true });
	}

	function normalizeRemoteActionRequest(turnState, remoteAction) {
		if (
			!remoteAction ||
			remoteAction.seatIndex !== turnState.player.seatIndex ||
			remoteAction.turnToken !== turnState.pendingAction?.turnToken
		) {
			return null;
		}

		switch (remoteAction.action) {
			case "fold":
				return { action: "fold" };
			case "check":
				return turnState.actionState.canCheck
					? getActionRequestForAmount(0, turnState.actionState)
					: null;
			case "call":
				return turnState.actionState.needToCall > 0
					? getActionRequestForAmount(
						Math.min(turnState.actionState.needToCall, turnState.player.chips),
						turnState.actionState,
					)
					: null;
			case "allin":
				return turnState.player.chips > 0
					? { action: "allin", amount: turnState.player.chips }
					: null;
			case "raise": {
				const amount = Number.parseInt(remoteAction.amount, 10);
				if (Number.isNaN(amount) || amount <= turnState.actionState.needToCall) {
					return null;
				}
				return getActionRequestForAmount(
					Math.min(amount, turnState.player.chips),
					turnState.actionState,
				);
			}
			default:
				return null;
		}
	}

	function submitHumanTurn(turnState, actionRequest) {
		if (
			activeTurnState !== turnState ||
			turnState.turnResolved ||
			turnState.cancelled ||
			!actionRequest
		) {
			return false;
		}

		turnActionUi.setEnabled(false);
		const resolvedAction = applyTurnAction(turnState.player, actionRequest);
		if (!resolvedAction) {
			if (activeTurnState === turnState && turnState.cancelled !== true) {
				turnActionUi.setEnabled(true);
			}
			return false;
		}

		turnState.turnResolved = true;
		clearPendingAction();
		turnState.pendingActionCleared = true;
		activeTurnState = null;
		turnActionUi.hide();
		const turnMeta = getResolvedTurnMeta(resolvedAction);
		continueAfterResolvedTurn({
			player: turnState.player,
			cycles: turnState.cycles,
			anyUncalled: turnState.anyUncalled,
			nextPlayer: turnState.nextPlayer,
			logPrefix: turnMeta.logPrefix,
			advanceReason: turnMeta.advanceReason,
		});
		return true;
	}

	function scheduleRemoteActionPoll(turnState) {
		if (
			activeTurnState !== turnState ||
			turnState.turnResolved ||
			turnState.cancelled ||
			!turnState.pendingAction?.turnToken
		) {
			return;
		}
		turnState.remoteActionTimer = setTimeout(() => {
			pollRemoteAction(turnState);
		}, actionPollInterval);
	}

	async function pollRemoteAction(turnState) {
		turnState.remoteActionTimer = null;
		if (
			activeTurnState !== turnState ||
			turnState.turnResolved ||
			turnState.cancelled ||
			turnState.remoteActionInFlight ||
			!turnState.pendingAction?.turnToken
		) {
			return;
		}

		turnState.remoteActionInFlight = true;
		try {
			const remoteAction = await fetchPendingRemoteAction(turnState.pendingAction.turnToken);
			if (
				activeTurnState !== turnState ||
				turnState.turnResolved ||
				turnState.cancelled
			) {
				return;
			}
			const normalizedRequest = normalizeRemoteActionRequest(turnState, remoteAction);
			if (normalizedRequest) {
				submitHumanTurn(turnState, normalizedRequest);
				return;
			}
		} finally {
			turnState.remoteActionInFlight = false;
		}

		if (
			activeTurnState === turnState &&
			turnState.turnResolved !== true &&
			turnState.cancelled !== true
		) {
			scheduleRemoteActionPoll(turnState);
		}
	}

	function runHumanTurn({ player, cycles, anyUncalled, nextPlayer }) {
		releaseActiveTurn({ clearPending: true });
		setActiveTurnPlayer(player);

		const turnState = {
			player,
			cycles,
			anyUncalled,
			nextPlayer,
			actionState: getPlayerActionState(player),
			pendingAction: null,
			remoteActionTimer: null,
			remoteActionInFlight: false,
			turnResolved: false,
			cancelled: false,
			pendingActionCleared: false,
		};
		turnState.pendingAction = setPendingAction(player);
		activeTurnState = turnState;

		turnActionUi.show(turnState.actionState, {
			resetAmount: true,
			enabled: true,
			onSubmit: (actionRequest) => submitHumanTurn(turnState, actionRequest),
			onFold: () => submitHumanTurn(turnState, { action: "fold" }),
		});
		if (turnState.pendingAction?.turnToken) {
			scheduleRemoteActionPoll(turnState);
		}
	}

	return {
		init,
		hide,
		runHumanTurn,
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
	// Synced seat views only submit actions to the host/backend.
	// They reuse the same control shell, but do not own a local turn lifecycle.
	let currentPendingAction = null;
	let isSubmittingAction = false;
	const turnActionUi = createTurnActionUi({
		visibleElements,
		foldButton,
		actionButton,
		amountSlider,
		sliderOutput,
		decrementButton,
		incrementButton,
		actionStep,
	});

	async function submitActionRequest(actionRequest) {
		if (!currentPendingAction || !tableId || seatIndex === null || isSubmittingAction) {
			return;
		}

		isSubmittingAction = true;
		turnActionUi.setEnabled(false);

		try {
			const res = await fetch(actionEndpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					tableId,
					seatIndex,
					turnToken: currentPendingAction.turnToken,
					action: actionRequest.action,
					amount: actionRequest.amount ?? null,
				}),
			});
			if (!res.ok) {
				throw new Error(`action request failed with status ${res.status}`);
			}
		} catch (error) {
			console.warn("action request failed", error);
			isSubmittingAction = false;
			turnActionUi.setEnabled(true);
			if (typeof onActionError === "function") {
				onActionError(error);
			}
		}
	}

	function init() {
		turnActionUi.init();
	}

	function hide() {
		currentPendingAction = null;
		isSubmittingAction = false;
		turnActionUi.hide();
	}

	function render(seatView, pendingAction) {
		if (!shouldShowSeatActionControls(seatView, pendingAction, seatIndex)) {
			hide();
			return;
		}

		const isNewTurn = currentPendingAction?.turnToken !== pendingAction.turnToken;
		currentPendingAction = pendingAction;
		if (isNewTurn) {
			isSubmittingAction = false;
		}
		turnActionUi.show(pendingAction, {
			resetAmount: isNewTurn,
			enabled: !isSubmittingAction,
			onSubmit: submitActionRequest,
			onFold: () => submitActionRequest({ action: "fold" }),
		});
	}

	return {
		init,
		hide,
		render,
	};
}
