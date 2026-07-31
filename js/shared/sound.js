/* ==================================================================================================
MODULE BOUNDARY: Shared Sound
================================================================================================== */

// CURRENT STATE: Dependency-free Web Audio playback, audio unlock, global mute control, and the
// two-tone cue used to alert a human player that it is their turn to act.
// TARGET STATE: Keep shared sound infrastructure and concrete game cues in this module.
// DO NOT PUT HERE: Turn-detection logic (who should hear the cue and when) — that stays with the
// callers in humanTurnController.js and its consumers.

const MUTE_STORAGE_KEY = "poker:sound-muted";
const SOUND_ON_LABEL = "Sound on";
const SOUND_OFF_LABEL = "Sound off";

// Low note then high note — kept intentionally simple so it reads as one clear "your turn" cue.
const TURN_CHIME_NOTES = [
	{ frequency: 587.33, offset: 0, duration: 0.14, gain: 0.35 },
	{ frequency: 880.0, offset: 0.11, duration: 0.22, gain: 0.4 },
];

let sharedAudioContext = null;
let isSoundInitialized = false;
let isSoundMuteStateLoaded = false;
let soundMuted = false;

function getLocalStorage() {
	try {
		return globalThis.localStorage ?? null;
	} catch (error) {
		console.warn("sound storage unavailable", error);
		return null;
	}
}

function loadSoundMuteState() {
	if (isSoundMuteStateLoaded) {
		return;
	}

	isSoundMuteStateLoaded = true;
	const storage = getLocalStorage();
	if (!storage) {
		return;
	}

	try {
		soundMuted = storage.getItem(MUTE_STORAGE_KEY) === "true";
	} catch (error) {
		console.warn("sound storage read failed", error);
	}
}

function getAudioContext() {
	const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
	if (!AudioContextClass) {
		return null;
	}
	if (!sharedAudioContext) {
		sharedAudioContext = new AudioContextClass();
	}
	return sharedAudioContext;
}

function removeAudioUnlockListeners() {
	document.removeEventListener("pointerdown", unlockAudioContext, true);
	document.removeEventListener("keydown", unlockAudioContext, true);
}

async function unlockAudioContext() {
	const audioContext = getAudioContext();
	if (!audioContext) {
		removeAudioUnlockListeners();
		return;
	}

	if (audioContext.state !== "running") {
		try {
			await audioContext.resume();
		} catch {
			return;
		}
	}

	if (audioContext.state === "running") {
		removeAudioUnlockListeners();
	}
}

export function initSound() {
	if (isSoundInitialized) {
		return;
	}

	isSoundInitialized = true;
	document.addEventListener("pointerdown", unlockAudioContext, true);
	document.addEventListener("keydown", unlockAudioContext, true);
}

export function isSoundMuted() {
	loadSoundMuteState();
	return soundMuted;
}

export function setSoundMuted(muted) {
	soundMuted = muted;
	isSoundMuteStateLoaded = true;
	const storage = getLocalStorage();
	if (!storage) {
		return;
	}

	try {
		storage.setItem(MUTE_STORAGE_KEY, muted ? "true" : "false");
	} catch (error) {
		console.warn("sound storage write failed", error);
	}
}

export function initSoundButton(button) {
	function render() {
		button.textContent = isSoundMuted() ? SOUND_OFF_LABEL : SOUND_ON_LABEL;
	}

	button.addEventListener("click", () => {
		const muted = !isSoundMuted();
		setSoundMuted(muted);
		render();
	});
	render();
}

function playTone(audioContext, { frequency, startTime, duration, gain, type = "triangle" }) {
	const oscillator = audioContext.createOscillator();
	const gainNode = audioContext.createGain();

	oscillator.type = type;
	oscillator.frequency.setValueAtTime(frequency, startTime);

	// Quick fade in/out to avoid audible clicks at the start/end of the tone.
	gainNode.gain.setValueAtTime(0, startTime);
	gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.015);
	gainNode.gain.linearRampToValueAtTime(0, startTime + duration);

	oscillator.connect(gainNode);
	gainNode.connect(audioContext.destination);

	oscillator.start(startTime);
	oscillator.stop(startTime + duration + 0.02);
}

/**
 * Plays a short two-note chime (low, then high) to signal that it is now a human player's turn
 * to act. Safe to call liberally: it no-ops when muted or when Web Audio is unavailable.
 *
 * Notes are only scheduled once the AudioContext is confirmed running. Scheduling them against
 * a context that is still mid-`resume()` (e.g. on the very first call right after a user's first
 * page interaction) causes the earliest note(s) to be silently dropped, so the first cue of a
 * session can come out sounding like a single tone instead of the full two-note melody.
 */
async function playNotes(notes) {
	if (isSoundMuted()) {
		return;
	}

	const audioContext = getAudioContext();
	if (!audioContext) {
		return;
	}

	if (audioContext.state !== "running") {
		try {
			await audioContext.resume();
		} catch {
			// No user gesture has unlocked audio yet — skip this cue rather than play it broken.
			return;
		}
	}
	if (audioContext.state !== "running") {
		return;
	}

	const now = audioContext.currentTime;
	notes.forEach(({ frequency, offset, duration, gain }) => {
		playTone(audioContext, { frequency, startTime: now + offset, duration, gain });
	});
}

export function playTurnChime() {
	return playNotes(TURN_CHIME_NOTES);
}
