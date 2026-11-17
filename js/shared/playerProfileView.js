import { getPlayerProfileComparison } from "../playerProfile.js";

const METRIC_GROUPS = [
	{
		label: "Tournament results",
		metrics: [
			{
				label: "Tournaments",
				kind: "tournaments",
				help: "Completed tournaments. Leaving an unfinished game does not add a result.",
			},
			{
				label: "Win rate",
				kind: "winRate",
				help: "Percentage of tournaments you won.",
			},
			{
				label: "Placement",
				kind: "placement",
				help:
					"Latest shows your actual finish. L10 and Overall average finishes after scaling them to six players.",
			},
			{
				label: "Hands per game",
				kind: "handsPerGame",
				help:
					"Average hands dealt to you per completed tournament, until you were eliminated or won. Latest shows that tournament's hands.",
			},
			{
				label: "Hands won",
				numerator: "handsWon",
				denominator: "hands",
				help:
					"Hands in which you won a pot. Split pots count as one won hand; returned, uncalled chips do not count as a win.",
			},
			{
				label: "Non-showdown wins",
				numerator: "handsWon",
				subtract: "showdownsWon",
				denominator: "handsWon",
				help: "Percentage of hands you won that ended without a showdown.",
			},
		],
	},
	{
		label: "Preflop",
		metrics: [
			{
				label: "VPIP",
				numerator: "vpip",
				denominator: "hands",
				help: "Hands in which you voluntarily called or raised preflop. Posting blinds does not count.",
			},
			{
				label: "PFR",
				numerator: "pfr",
				denominator: "hands",
				help: "Hands in which you raised preflop at least once.",
			},
			{
				label: "VPIP–PFR gap",
				kind: "gap",
				numerator: "vpip",
				subtract: "pfr",
				denominator: "hands",
				help:
					"VPIP minus PFR, in percentage points (pp). This describes how often you entered preflop without raising.",
			},
			{
				label: "3-Bet",
				rate: "threeBetPct",
				help: "How often you reraised when facing one preflop raise and able to raise.",
			},
			{
				label: "Fold to 3-Bet",
				rate: "foldToThreeBetPct",
				help: "How often you folded your original preflop raise to a 3-bet. An intervening 4-bet is excluded.",
			},
			{
				label: "Raise first in",
				rate: "raiseFirstInPct",
				help:
					"How often you raised when nobody had voluntarily entered the pot before you and you could raise.",
			},
			{
				label: "Attempt to steal",
				rate: "attemptToStealPct",
				help:
					"Raises first in from the cutoff, button, or small blind, including the small blind in heads-up play.",
			},
			{
				label: "Fold BB to steal",
				rate: "foldBigBlindToStealPct",
				help:
					"How often you folded the big blind directly to a steal. Intervening calls or raises are excluded.",
			},
			{
				label: "Preflop fold",
				numerator: "foldsPreflop",
				denominator: "hands",
				help: "Hands in which you folded before the flop.",
			},
			{
				label: "Flop seen",
				rate: "flopSeenPct",
				help:
					"Hands in which you reached the flop without folding, including all-in runouts and free flops in the big blind.",
			},
		],
	},
	{
		label: "Postflop",
		metrics: [
			{
				label: "Flop C-Bet",
				rate: "flopCbetPct",
				help: "How often you made the first bet on the flop as the last preflop raiser, when able to bet.",
			},
			{
				label: "Fold to flop C-Bet",
				rate: "foldToFlopCbetPct",
				help:
					"How often you folded directly to a flop continuation bet. Calls by other players still count; an intervening raise does not.",
			},
			{
				label: "Aggression factor",
				kind: "ratio",
				rate: "aggressionFactor",
				help:
					"Postflop bets and raises divided by calls. All-in calls count as calls. With no calls, there is no finite factor to display.",
			},
			{
				label: "WTSD",
				rate: "wtsdPct",
				help: "Went to showdown: how often you reached a showdown after seeing the flop.",
			},
			{
				label: "W$SD",
				numerator: "showdownsWon",
				denominator: "showdowns",
				help: "Won at showdown: how often you won a pot when reaching showdown. Split-pot wins count once.",
			},
			{
				label: "WWSF",
				numerator: "handsWonAfterFlop",
				denominator: "flopsSeen",
				help: "Won when saw flop: how often you won a pot after seeing the flop, with or without a showdown.",
			},
			{
				label: "All-in",
				numerator: "allins",
				denominator: "hands",
				help: "Hands in which you went all-in by calling or raising. Forced blind all-ins are excluded.",
			},
		],
	},
];

function formatNumber(value) {
	return value.toLocaleString("en");
}

function formatDate(timestamp) {
	return new Date(timestamp).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
}

function formatMetric(period, metric) {
	if (metric.kind === "tournaments") {
		return formatNumber(period.tournaments);
	}
	if (metric.kind === "winRate") {
		return `${period.winPct.toFixed(1)}%`;
	}
	if (metric.kind === "placement") {
		if (period.placement !== undefined) {
			return `${period.placement} / ${period.participantCount}`;
		}
		const averagePlaceAtSix = 1 + (period.averageRelativePlacementPct / 100) * 5;
		return `${averagePlaceAtSix.toFixed(1)} / 6`;
	}
	if (metric.kind === "handsPerGame") {
		return (period.stats.hands / period.tournaments).toLocaleString("en", { maximumFractionDigits: 1 });
	}
	if (metric.kind === "ratio") {
		const ratio = period.rates[metric.rate];
		return ratio === null ? "—" : ratio.toFixed(2);
	}
	let rate;
	if (metric.rate) {
		rate = period.rates[metric.rate];
	} else {
		const numerator = period.stats[metric.numerator] - (metric.subtract ? period.stats[metric.subtract] : 0);
		const denominator = period.stats[metric.denominator];
		rate = denominator > 0 ? numerator / denominator * 100 : null;
	}
	return rate === null ? "—" : `${rate.toFixed(1)}${metric.kind === "gap" ? " pp" : "%"}`;
}

export function renderPlayerProfile(elements, profile) {
	const comparison = getPlayerProfileComparison(profile);
	const periods = [{ label: "Latest", ...comparison.latest }];
	if (comparison.last10) {
		periods.push({ label: "L10", ...comparison.last10 });
	}
	periods.push({ label: "Overall", ...comparison.overall });
	elements.groups.replaceChildren();
	for (const group of METRIC_GROUPS) {
		const section = elements.groupTemplate.content.firstElementChild.cloneNode(true);
		section.querySelector("h3").textContent = group.label;
		const header = section.querySelector("thead tr");
		const body = section.querySelector("tbody");
		const explanations = section.querySelector("dl");
		for (const period of periods) {
			const heading = elements.headingTemplate.content.firstElementChild.cloneNode(true);
			heading.querySelector(".period-label").textContent = period.label;
			heading.querySelector(".period-detail").textContent = period.finishedAt
				? formatDate(period.finishedAt)
				: `${formatNumber(period.tournaments)} games`;
			header.appendChild(heading);
		}
		for (const metric of group.metrics) {
			const row = elements.rowTemplate.content.firstElementChild.cloneNode(true);
			row.querySelector("th").textContent = metric.label;
			for (const period of periods) {
				const cell = elements.cellTemplate.content.firstElementChild.cloneNode(true);
				cell.querySelector(".metric-value").textContent = formatMetric(period, metric);
				row.appendChild(cell);
			}
			body.appendChild(row);
			const explanation = elements.helpTemplate.content.firstElementChild.cloneNode(true);
			explanation.querySelector("dt").textContent = metric.label;
			explanation.querySelector("dd").textContent = metric.help;
			explanations.appendChild(explanation);
		}
		elements.groups.appendChild(section);
	}
	elements.history.replaceChildren();
	elements.history.style.setProperty("--history-count", profile.recentTournaments.length);
	for (const tournament of profile.recentTournaments.slice().reverse()) {
		const item = elements.historyTemplate.content.firstElementChild.cloneNode(true);
		const position = (tournament.placement - 1) / (tournament.participantCount - 1) * 100;
		item.style.setProperty("--finish-position", `${position}%`);
		item.title = `${
			formatDate(tournament.finishedAt)
		} · Place ${tournament.placement} of ${tournament.participantCount}`;
		item.querySelector(".history-place").textContent = `${tournament.placement}/${tournament.participantCount}`;
		elements.history.appendChild(item);
	}
}
