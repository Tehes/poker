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
				label: "Wins",
				kind: "wins",
				help: "Tournaments in which you finished first, with your tournament win rate below.",
			},
			{
				label: "Placement",
				kind: "placement",
				help:
					"Latest shows your place and the original number of players. Other columns show your average finishing place.",
			},
			{
				label: "Relative placement",
				kind: "relative",
				note: "0% first · 100% last",
				help:
					"Finishing place adjusted for each tournament's original field size. This allows comparisons between different table sizes.",
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
				unit: "hands",
				help:
					"Hands in which you won a pot. Split pots count as one won hand; returned, uncalled chips do not count as a win.",
			},
			{
				label: "Pots without showdown",
				kind: "count",
				numerator: "handsWon",
				subtract: "showdownsWon",
				help: "Hands won because every opponent folded, including hands that ended before the flop.",
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
				unit: "hands",
				help: "Hands in which you voluntarily called or raised preflop. Posting blinds does not count.",
			},
			{
				label: "PFR",
				numerator: "pfr",
				denominator: "hands",
				unit: "hands",
				help: "Hands in which you raised preflop at least once.",
			},
			{
				label: "VPIP–PFR gap",
				kind: "gap",
				numerator: "vpip",
				subtract: "pfr",
				denominator: "hands",
				unit: "hands",
				help:
					"VPIP minus PFR, in percentage points (pp). This describes how often you entered preflop without raising.",
			},
			{
				label: "3-Bet",
				rate: "threeBetPct",
				numerator: "threeBets",
				denominator: "threeBetOpportunities",
				unit: "chances",
				help: "How often you reraised when facing one preflop raise and able to raise.",
			},
			{
				label: "Fold to 3-Bet",
				rate: "foldToThreeBetPct",
				numerator: "foldsToThreeBet",
				denominator: "foldToThreeBetOpportunities",
				unit: "chances",
				help: "How often you folded your original preflop raise to a 3-bet. An intervening 4-bet is excluded.",
			},
			{
				label: "Raise first in",
				rate: "raiseFirstInPct",
				numerator: "raisesFirstIn",
				denominator: "raiseFirstInOpportunities",
				unit: "chances",
				help:
					"How often you raised when nobody had voluntarily entered the pot before you and you could raise.",
			},
			{
				label: "Attempt to steal",
				rate: "attemptToStealPct",
				numerator: "stealAttempts",
				denominator: "stealOpportunities",
				unit: "chances",
				help:
					"Raises first in from the cutoff, button, or small blind, including the small blind in heads-up play.",
			},
			{
				label: "Fold BB to steal",
				rate: "foldBigBlindToStealPct",
				numerator: "foldsBigBlindToSteal",
				denominator: "bigBlindStealOpportunities",
				unit: "chances",
				help:
					"How often you folded the big blind directly to a steal. Intervening calls or raises are excluded.",
			},
			{
				label: "Preflop fold",
				numerator: "foldsPreflop",
				denominator: "hands",
				unit: "hands",
				help: "Hands in which you folded before the flop.",
			},
			{
				label: "Flop seen",
				rate: "flopSeenPct",
				numerator: "flopsSeen",
				denominator: "hands",
				unit: "hands",
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
				numerator: "flopCbets",
				denominator: "flopCbetOpportunities",
				unit: "chances",
				help: "How often you made the first bet on the flop as the last preflop raiser, when able to bet.",
			},
			{
				label: "Fold to flop C-Bet",
				rate: "foldToFlopCbetPct",
				numerator: "foldsToFlopCbet",
				denominator: "foldToFlopCbetOpportunities",
				unit: "chances",
				help:
					"How often you folded directly to a flop continuation bet. Calls by other players still count; an intervening raise does not.",
			},
			{
				label: "Aggression factor",
				kind: "ratio",
				rate: "aggressionFactor",
				numerator: "aggressiveActs",
				denominator: "calls",
				help:
					"Postflop bets and raises divided by calls. All-in calls count as calls. With no calls, there is no finite factor to display.",
			},
			{
				label: "WTSD",
				rate: "wtsdPct",
				numerator: "showdowns",
				denominator: "flopsSeen",
				unit: "flops",
				help: "Went to showdown: how often you reached a showdown after seeing the flop.",
			},
			{
				label: "W$SD",
				numerator: "showdownsWon",
				denominator: "showdowns",
				unit: "showdowns",
				help: "Won at showdown: how often you won a pot when reaching showdown. Split-pot wins count once.",
			},
			{
				label: "WWSF",
				numerator: "handsWonAfterFlop",
				denominator: "flopsSeen",
				unit: "flops",
				help: "Won when saw flop: how often you won a pot after seeing the flop, with or without a showdown.",
			},
			{
				label: "All-in",
				numerator: "allins",
				denominator: "hands",
				unit: "hands",
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
		return { value: formatNumber(period.tournaments), sample: "" };
	}
	if (metric.kind === "wins") {
		return { value: formatNumber(period.wins), sample: `${period.winPct.toFixed(1)}%` };
	}
	if (metric.kind === "placement") {
		return period.placement !== undefined
			? { value: `${period.placement} / ${period.participantCount}`, sample: "" }
			: { value: period.averagePlacement.toFixed(1), sample: "average place" };
	}
	if (metric.kind === "relative") {
		return { value: `${period.averageRelativePlacementPct.toFixed(1)}%`, sample: "" };
	}
	if (metric.kind === "handsPerGame") {
		return {
			value: (period.stats.hands / period.tournaments).toLocaleString("en", { maximumFractionDigits: 1 }),
			sample: "",
		};
	}
	const numerator = period.stats[metric.numerator] - (metric.subtract ? period.stats[metric.subtract] : 0);
	if (metric.kind === "count") {
		return { value: formatNumber(numerator), sample: "" };
	}
	const denominator = period.stats[metric.denominator];
	if (metric.kind === "ratio") {
		const ratio = period.rates[metric.rate];
		return {
			value: ratio === null ? "—" : ratio.toFixed(2),
			sample: `${formatNumber(numerator)} bets + raises / ${formatNumber(denominator)} calls`,
		};
	}
	const rate = metric.rate ? period.rates[metric.rate] : denominator > 0 ? numerator / denominator * 100 : null;
	return {
		value: rate === null ? "—" : `${rate.toFixed(1)}${metric.kind === "gap" ? " pp" : "%"}`,
		sample: metric.kind === "gap"
			? `${formatNumber(denominator)} ${metric.unit}`
			: `${formatNumber(numerator)} / ${formatNumber(denominator)} ${metric.unit}`,
	};
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
			const label = row.querySelector("th");
			label.textContent = metric.label;
			if (metric.note) {
				const note = document.createElement("small");
				note.textContent = metric.note;
				label.appendChild(note);
			}
			for (const period of periods) {
				const cell = elements.cellTemplate.content.firstElementChild.cloneNode(true);
				const metricValue = formatMetric(period, metric);
				cell.querySelector(".metric-value").textContent = metricValue.value;
				cell.querySelector(".metric-sample").textContent = metricValue.sample;
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
