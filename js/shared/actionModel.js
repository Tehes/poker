/* --------------------------------------------------------------------------------------------------
Action Model Helpers
---------------------------------------------------------------------------------------------------*/

// Keep this module DOM-free.
// It is the shared source of truth for action math that both table view and single view consume.
// If action rules change, update them here instead of re-deriving them in each UI.
export function getPlayerActionState(gameState, player) {
	const needToCall = Math.max(0, gameState.currentBet - player.roundBet);
	const minAmount = gameState.currentPhaseIndex > 0 && gameState.currentBet === 0
		? 0
		: Math.min(needToCall, player.chips);
	const maxAmount = player.chips;
	const minRaise = needToCall + gameState.lastRaise;
	return {
		needToCall,
		minAmount,
		maxAmount,
		minRaise,
		canCheck: needToCall === 0,
	};
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
	return amount > actionState.needToCall &&
		amount < actionState.minRaise &&
		amount < actionState.maxAmount;
}

export function normalizeActionAmount(amount, actionState) {
	const clampedAmount = clampActionAmount(amount, actionState);
	if (isInvalidRaiseAmount(clampedAmount, actionState)) {
		return Math.min(actionState.maxAmount, actionState.minRaise);
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
