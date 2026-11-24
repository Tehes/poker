# Matchup-Experimente

Der Experiment-Runner vergleicht Strategieversionen gegen dieselben Gegner. Er übernimmt
Sitzrotation, Seed-Paarung, Auswertung und Mindestanforderungen an die Stichprobe. Der
[Bot Tuning Playbook](./bot-tuning-playbook.md) beschreibt, wann das Ergebnis in die Freigabe eingeht.

## Gemeinsame Mustersuche

```powershell
deno task engine:diagnose -- --runs=1000 --out=tmp/matchup-discovery
```

Der Runner verwendet das Referenzfeld und den gemischten Tisch aus dem Gegnerpool. Er rotiert
den Testsitz und paart die Felder nach Seed. Wähle pro Lauf einen neuen Ausgabeordner.

- `summary.json` stellt beide Felder pro Spot nebeneinander. Abschnitte gliedern nach Street und
  Entscheidungssituation sowie nach Handklasse, Position, Line, Betgröße oder Gegnerprofil.
  Je Feld stehen dort Spot-Anzahl, Spots pro 100 gespielten Händen, Aktionshäufigkeiten und
  beobachtete Netto-BB ab der Entscheidung. All-in-Calls und All-in-Raises haben eigene
  Aktionszahlen. `mixedMinusReferenceBb` ist die beobachtete Differenz je Spot.
- `decisions.jsonl.gz` enthält die Entscheidungen des Testsitzes. Die erste JSONL-Zeile benennt
  die Spalten der folgenden Arrays. Karten sind aneinandergehängte Zwei-Zeichen-Codes.
  `field`, `run`, `seed`, `handId` und `decisionId` identifizieren die Beobachtung.
  `netChipsFromDecision` enthält den Chipwert ab der Entscheidung. Teile ihn für BB durch
  `bigBlind`. Das Archiv wird beim Schreiben pro Turnierpaar komprimiert.

`line` enthält den Preflop-Pottyp, die Rolle des Bots als Preflop-Aggressor und die Zahl der
durchgecheckten Streets. `betSize` nutzt die Betgrößenklassen des Core-Berichts. Pot, Call-Betrag
und ausgeführte Betgröße stehen zusätzlich als Chipbeträge im Archiv.

Standardmäßig erscheint eine Gruppe im Bericht ab 20 Entscheidungen in mindestens einem Feld.
`--min-spots` setzt diese Grenze für die Übersicht. Die Archivzeilen bleiben einzeln auswertbar.
Die Abschnitte gruppieren dieselben Entscheidungen aus verschiedenen Blickwinkeln.
Falls ein Turnier abbricht oder einen Pot falsch abrechnet, markiert der Runner die Zeilen
beider Partner mit `included: false` und führt das Paar unter `excludedPairs` auf. Die Übersicht
zählt die gültigen Paare. Der beobachtete Chipwert ist ein Hinweis für die Mustersuche. Im
Replay lässt sich anschließend der Wert einer alternativen Aktion aus demselben Spot prüfen.

## Varianten und Gegnerfelder

Eine Experimentdatei exportiert die Konfiguration als JavaScript-Objekt. Der
[A/A-Audit](../matchupAudit.js) ist eine ausführbare Vorlage für die Struktur.

| Feld | Inhalt |
| --- | --- |
| `name`, `stage` | Name und Stufe `diagnosis`, `validation`, `holdout` oder `rollout`. |
| `seed`, `runs` | Fester Seed und Anzahl Turniere je Feld und Variante. |
| `fields` | Gegnerfelder. Jedes benennt dieselben Rollen und weist ihnen feste Strategien zu. |
| `strategies`, `strategyVersions` | Strategiefunktionen und ihre Versionen. Verwende für Vergleiche feste Source-Snapshots oder Commit-IDs im Versionsfeld. |
| `variants` | Zu überschreibende Rollen pro Variante. Eine leere Variante übernimmt das gesamte Feld. |
| `comparisons` | Vergleichs-ID, Feld, Basisvariante und Kandidat. `role` gibt den gemessenen Sitz an. Voreinstellung ist `test`. |
| `classifySpot`, `spot` | Optionaler Name eines vor der Aktion erfassten Zielspots. |

Für einen üblichen A/B-Vergleich überschreiben Baseline und Kandidat nur den Testsitz. Ein
Kreuzvergleich kann zusätzlich einen festen Testsitz des anderen Hebels im Gegnerfeld führen.
Für einen Rollout überschreiben die Varianten die fünf Bot-Sitze. Der menschliche Testgegner
bleibt im Feld konstant. Der Runner führt jede verwendete Kombination aus Feld und Variante
einmal aus. Eine Konfiguration für die Freigabe verwendet feste Versionen in allen Armen.
Der Report protokolliert die angegebenen Versions-IDs und den SHA-256 der Konfigurationsdatei.

Der A/A-Audit sollte bei gültigen Turnierpaaren exakt null Unterschied zeigen. Er verwendet die
aktuelle Strategie in beiden Armen. Im Audit dient das Ergebnis allein der Prüfung der Infrastruktur.

```powershell
deno task engine:experiment scripts/matchupAudit.js tmp/matchup-audit.json
```

## Replay mit identischem Ausgangsspot

Das Replay sammelt Entscheidungen aus Händen der Baseline. `select(state, player, role, action)`
liefert nach der Aktionswahl und vor ihrer Ausführung den Namen des Zielspots oder `null`.
Die Konfiguration legt ein Gegnerfeld `field` und die zu prüfenden `alternatives` fest. Jede
Alternative benennt eine Strategie aus `strategies`. Sie übernimmt den ausgewählten Sitz ab dem
Zielspot für den Rest der Hand. Alle anderen Sitze behalten ihre Strategie und reagieren auf
die veränderte Line.

Für jede Alternative setzt der Runner die Hand mit demselben Kartenstapel und demselben
Spielerzustand neu auf. Er prüft die Aktionen bis zur Abzweigung und den Zustand am Zielspot.
Dann spielt die Engine bis zur Auszahlung. So lassen sich auch ein Turn-Call und seine
Folgekosten am River vergleichen. Strategien verwenden nur die Spielinformationen des
handelnden Sitzes und ihr jeweiliges zustandsinternes Gedächtnis.

Der Bericht enthält Karten und Pot am Entscheidungspunkt, die ausgeführte Aktion und die
Netto-BB bis zum Handende. Das 95-%-Intervall zieht ganze Turniere wiederholt als Stichprobe,
damit mehrere Spots aus derselben Hand oder demselben Turnier zusammenbleiben. Der Replay-Befund
gilt für die Ausgangssituationen der Baseline. Der nachfolgende Matchup-Batch zeigt, welche
Situationen mit dem Kandidaten im Turnier tatsächlich entstehen.

```powershell
deno task engine:replay scripts/matchupReplayAudit.js tmp/matchup-replay-audit.json
```

## Kennzahlen und Freigabekriterien

Der Delta-Wert ist jeweils Kandidat minus Baseline. `bbPerHand` bezieht sich auf die gespielten
Hände der Rolle. `bbPerSpot` bezieht sich auf markierte Entscheidungen, deren Chipwert vom
Entscheidungspunkt bis zum Handende gemessen wird. `winRate` ist der Anteil gewonnener
Turniere. Die beiden ersten Kennzahlen gewichten jede Hand beziehungsweise jeden Spot gleich.

Wenn eine Variante die Zahl der markierten Spots verändert, vergleiche sowohl die Anzahl als
auch `bbPerHand`. Der Spot-Mittelwert gilt für die tatsächlich entstandenen Entscheidungen.
Für den direkten Wert einer konkreten Aktion brauchst du das Replay vom selben Ausgangsspot.

Ein Kriterium definiert Metrik, Mindestdelta, Mindestzahl an Turnierpaaren mit Beobachtungen pro
Arm und optional eine Mindestzahl an Beobachtungen je Arm. Für Kontrollfelder kann ein
tolerierbarer Verlust als negatives Mindestdelta eingetragen werden. Siegquoten werden als
Anteile angegeben. Beispielsweise entsprechen 0,02 zwei Prozentpunkten.

```js
criteria: [
	{ metric: "bbPerSpot", minDelta: 0.10, minPairs: 100, minObservations: 200 },
	{ metric: "bbPerHand", minDelta: -0.02, minPairs: 100 },
];
```

Diese Werte dienen der Illustration. Lege die Schwellen für das konkrete Experiment vor dem
Lauf fest. Für das 95-%-Intervall zieht der Runner 2.000 Stichproben aus ganzen Turnierpaaren.
Kriterien werden pro Vergleich ausgewertet. Bei mehreren Vergleichen ist das Intervall ein
Intervall je Kennzahl und Vergleich.

| Status | Bedeutung |
| --- | --- |
| `pass` | Das ganze Intervall liegt auf oder über der vorab definierten Grenze. |
| `fail` | Das ganze Intervall liegt unter der Grenze. |
| `inconclusive` | Das Intervall schneidet die Grenze. |
| `insufficient` | Zu wenige Paare oder Beobachtungen oder kein berechenbares Intervall. |
| `blocked` | Mindestens ein Arm hat einen ungültigen Pot oder ein Turnier am Handlimit. |
| `descriptive` | Vergleich ohne Freigabekriterium. |

Ein ungültiger Lauf wird zusammen mit seinen Partnerläufen aus dem Delta ausgeschlossen. Die
Rohwerte und der Grund bleiben im JSON sichtbar. Der Vergleich erhält den Status `blocked`,
auch wenn das Ergebnis aus den übrigen Paaren die Grenze erreicht. Der CLI schreibt den Bericht
und quittiert einen blockierten Lauf mit Exit-Code 1. Holdout und Rollout benötigen ebenfalls
ein `pass` für Exit-Code 0.

## Angriff und Defense zusammen

Ein Vergleich mit `attack` und `defense` zusätzlich zu `baseline` und `candidate` verwendet
vier Varianten. Der Kandidat ist hier die Kombination. Das ausgewiesene Delta lautet
`(Kombination − Angriff) − (Defense − Baseline)`, jeweils im selben Feld. Es zeigt, wie sehr
der Effekt der Defense davon abhängt, ob auch der Angriff aktiv ist. Verwende einen gewöhnlichen
Vergleich der Kombination gegen die Baseline, um den gemeinsamen Effekt zu messen.
