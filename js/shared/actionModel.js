/* ==================================================================================================
MODULE BOUNDARY: Shared Action Model
================================================================================================== */

// CURRENT STATE: Single shared source of truth for check, call, raise, and all-in amount math used
// by host and seat controls.
// TARGET STATE: Keep all action math that can be derived from explicit game state in one place so
// every UI uses the same rules.
// PUT HERE: Amount normalization, button labels, and semantic action derivation from explicit game
// state.
// DO NOT PUT HERE: Action submission, DOM control handling, polling, or turn-flow ownership.

export function getPlayerActionState(gameState, player) {
	const needToCall = Math.max(0, gameState.currentBet - player.roundBet);
	const minAmount = gameState.currentPhaseIndex > 0 && gameState.currentBet === 0
		? 0
		: Math.min(needToCall, player.chips);
	const maxAmount = player.chips;
	const minRaise = needToCall + gameState.lastRaise;
	const effectiveRaiseCap = getEffectiveRaiseCap(gameState, player);
	const maxRaiseAmount = Math.min(maxAmount, Math.max(minRaise, effectiveRaiseCap));
	return {
		needToCall,
		minAmount,
		maxAmount,
		minRaise,
		maxRaiseAmount,
		canCheck: needToCall === 0,
	};
}

export function getEffectiveRaiseCap(gameState, player) {
	const maxOpponentTotal = gameState.players.reduce((maxTotal, currentPlayer) => {
		if (
			currentPlayer === player ||
			currentPlayer.folded ||
			currentPlayer.allIn ||
			currentPlayer.chips <= 0
		) {
			return maxTotal;
		}

		return Math.max(maxTotal, currentPlayer.roundBet + currentPlayer.chips);
	}, 0);

	return Math.max(0, maxOpponentTotal - player.roundBet);
}

export function getActionButtonLabel(amount, actionState) {
	if (amount === 0) {
		return "Check";
	}
	if (amount === actionState.maxAmount) {
		return "All-In";
	}
	if (amount === actionState.needToCall) {
		return "Call";
	}
	return "Raise";
}

export function clampActionAmount(amount, actionState) {
	const parsedAmount = Number.isNaN(amount) ? actionState.minAmount : amount;
	return Math.max(
		actionState.minAmount,
		Math.min(parsedAmount, actionState.maxAmount),
	);
}

export function isInvalidRaiseAmount(amount, actionState) {
	const maxRaiseAmount = actionState.maxRaiseAmount ?? actionState.maxAmount;
	return amount > actionState.needToCall &&
		(amount < actionState.minRaise || amount > maxRaiseAmount) &&
		amount < actionState.maxAmount;
}

export function normalizeActionAmount(amount, actionState) {
	const clampedAmount = clampActionAmount(amount, actionState);
	const maxRaiseAmount = actionState.maxRaiseAmount ?? actionState.maxAmount;
	if (clampedAmount === actionState.maxAmount) {
		return clampedAmount;
	}
	if (clampedAmount > maxRaiseAmount) {
		return maxRaiseAmount;
	}
	if (isInvalidRaiseAmount(clampedAmount, actionState)) {
		return Math.min(maxRaiseAmount, actionState.minRaise);
	}
	return clampedAmount;
}

// The UIs submit semantic actions, but both UIs derive them from the same slider state.
export function getActionRequestForAmount(amount, actionState) {
	const normalizedAmount = normalizeActionAmount(amount, actionState);

	if (normalizedAmount === 0) {
		return { action: "check", amount: 0 };
	}
	if (normalizedAmount === actionState.maxAmount) {
		return { action: "allin", amount: normalizedAmount };
	}
	if (normalizedAmount === actionState.needToCall) {
		return { action: "call", amount: normalizedAmount };
	}
	return { action: "raise", amount: normalizedAmount };
}
