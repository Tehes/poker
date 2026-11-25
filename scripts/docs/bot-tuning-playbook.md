# Bot Tuning Playbook

## Zweck

Dieses Dokument führt größere Bot-Tuning-Iterationen. Es ist kein zweiter North Star. Die strategischen Leitplanken stehen in `js/bot.js`; dieses Playbook soll helfen, bei einer Iteration schnell die richtige Diagnose, den kleinsten sinnvollen Hebel und eine belastbare Validierung zu waehlen.

Lies vor jeder Bot-Tuning-Iteration auch `scripts/docs/bot-tuning-learnings.md`. Dort stehen akzeptierte und verworfene Routen, die nicht ohne neue Evidenz wiederholt werden sollen.

## Grundsatz

Tune nicht die Metrik. Tune die Ursache.

Der Bot bleibt heuristisch. Equity, MDF und Batch-Metriken sind Diagnose- und Kalibrierungsschichten, keine Runtime-Entscheidungsmodelle.

### Direkt verboten

- `equityPct` oder `equityRank` in `js/bot.js` als Entscheidungskriterium nutzen.
- Logs, Analyse oder Metrikdefinitionen ändern, nur damit ein Kandidat besser aussieht.
- MDF oder Overfold durch offensichtliche Trash-Calls reparieren.
- Globale Tightness oder globale Loose-ness ohne Root-Cause-Beleg einführen.
- Mehrere unabhängige Leaks in einem Pass lösen.

## Arbeitsbereich

### Normaler Tuning-Zielort

- `js/bot.js`

### Erlaubt, wenn es zur Iteration gehört

- temporäre Analysen und Reports in `tmp/`
- Batch-Ausgaben in `tmp/`
- `js/version.js` und Service-Worker-Version, wenn ein akzeptierter Kandidat live gehen soll
- Analyse-Erweiterungen nur mit ausdrücklicher Zustimmung und nur minimal

### Nicht ohne ausdrückliche Zustimmung

- Engine-Logik
- Testlogik
- Logging-Formate
- bestehende Metrikdefinitionen
- UI-/Copy-Änderungen

## Iteration in Kurzform

1. `scripts/docs/bot-tuning-learnings.md` lesen.
2. Self-Play- und Mixed-Baseline für dieselbe Bot-Version festlegen.
3. In beiden Baselines eigenständig nach auffälligen Mustern suchen und sie über die Gegnerfelder vergleichen.
4. Ursache lokalisieren: Arrival, Spot Decision, Line, Sizing, Range, Stackdruck oder Artefakt.
5. Plausible Alternativen im Replay prüfen. Bei Bedarf Equity-/MDF-/Backtrace-Diagnose nutzen.
6. Eine konkrete Hypothese formulieren.
7. Einen fokussierten Hebel in `js/bot.js` ändern.
8. Staged Validation laufen lassen.
9. Akzeptieren, verwerfen oder Diagnose aktualisieren.

## Goal-Loop-Vertrag

Ein Goal bearbeitet genau ein Leak und eine Root-Cause. Es darf nicht verlangen, um jeden Preis
eine Verbesserung zu produzieren, und beginnt keine angrenzende Tuning-Frage.

- Diagnose und Counterfactual zählen noch nicht als Kandidaten-Pass.
- Es gibt höchstens zwei Kandidaten-Pässe mit jeweils einer Hypothese und einem fokussierten Hebel.
- Ein dritter Pass ist nur erlaubt, wenn neue Evidenz die Hypothese materiell verändert und der
  Kandidat vor der nächsten Code-Änderung neu qualifiziert wird.
- Ohne neue Evidenz endet das Goal nach zwei verworfenen Kandidaten.
- Ein fehlgeschlagener 1000er Acceptance-Batch beendet das Goal; danach folgt kein weiterer Pass.
- Derselbe Batch wird ohne materielle Code- oder Hypothesenänderung nicht wiederholt.
- Nach jedem Pass wird nur kurz Hypothese, Änderung, Evidenz und nächstes Gate festgehalten.

Terminalzustände sind `accepted` oder `no-qualified-candidate`. Ein echter externer Blocker darf das
Goal blockieren; schwierige oder uneindeutige Tuning-Ergebnisse sind kein Blocker.

## Baseline Policy

Nutze die letzte akzeptierte 1000er Baseline, solange sie noch zur Bot-Version und zur Fragestellung passt.

Erzeuge eine frische 1000er Core-Baseline, wenn:

- eine neue größere Tuning-Kampagne beginnt,
- der letzte akzeptierte Stand unklar ist,
- seit der letzten Baseline mehrere Bot-Änderungen passiert sind,
- die Vergleichsfrage ohne frische Baseline nicht fair beantwortet werden kann.

### Core-Baseline

```bash
deno task engine:batch:1000
```

Notiere immer:

- Pfad
- Run Count
- Hand Count
- Decision Coverage
- Showdown / Uncontested
- Preflop Fold / Call / Raise
- Postflop Fold / Call / Raise
- SB-HU und BTN-3 Open/Defend-Dynamik
- Guardrails
- Early-Bust- und Tournament-Flow

## Mustersuche vor der Hebelwahl

Beginne die Diagnose mit der aktuellen Bot-Version im Self-Play und im Mixed-Batch. Suche in
beiden Berichten eigenständig nach auffälligen Mustern. Das Mixed-Feld kann bereits vor der
Kandidatenwahl zusätzliche Schwächen zeigen, die sich erst gegen andere Strategien ergeben.

```bash
deno task engine:diagnose -- --runs=1000 --out=tmp/matchup-discovery
```

Der Runner erzeugt beide Diagnosefelder in einem Lauf. Der gemeinsame Diagnosebericht stellt
`reference` und `mixed` für denselben Testsitz und dieselben Seeds nebeneinander. Er enthält
übergreifende Spots und Auswertungen nach Handklasse, Position, Line, Betgröße und Gegnerprofil.
Für feinere Schnitte verwende das komprimierte Entscheidungslog mit derselben Definition
in beiden Feldern. Die Core-Baseline ergänzt die Sicht auf den gesamten Tisch und die Guardrails.
[Diagnosebericht und Logformat](./matchup-experiments.md#gemeinsame-mustersuche)

Halte pro Muster fest, wie häufig der Spot entsteht, welche Hände dort ankommen, wie oft die
auffällige Aktion gewählt wird und wie der beobachtete Chipwert pro Spot ausfällt. Berichte die
Anzahl vergleichbarer Spots je Feld. Wenige Beobachtungen lassen die Übertragbarkeit offen.

Ein Muster in beiden Feldern spricht für eine breitere Schwäche. Ein belastbares Muster in
einem einzelnen Feld kann ebenfalls ein Ziel-Leak sein. Tausche bei einem vermuteten
Gegnereffekt das relevante Profil gezielt gegen ein Kontrollprofil. Prüfe anschließend plausible
Alternativen am selben Ausgangsspot im Replay. Wähle erst daraus einen Hebel für die vermutete
Ursache.

## Diagnose-Menü

Wähle die Diagnose nach dem Leak. Nicht jeder Leak braucht alle Werkzeuge.

### Core-Struktur

```bash
deno task engine:batch
```

### Core-Stabilität

```bash
deno task engine:batch:500
```

### Core-Freigabelauf

```bash
deno task engine:batch:1000
```

### Postflop-Equity-Diagnose

```bash
deno task engine:batch -- --runs=300 --equity --equity-limit=1000
```

### Preflop-/Arrival-/Blind-Defense-Equity-Diagnose

```bash
deno task engine:batch -- --runs=300 --equity-preflop --equity-limit=3000
```

### Größerer Equity-Check

Bei wichtigen oder ambivalenten Kandidaten:

```bash
deno task engine:batch -- --runs=1000 --equity-preflop --equity-limit=3000
```

### Speedmode

- Wenn lokale Browser-Automation verfügbar ist, nach Bot-Logik-Änderungen staged Speedmode nutzen.
- Wenn Speedmode blockiert ist, den Blocker klar nennen und Engine-Batches verwenden.

## Root-Cause-Fragen

Bevor Code geändert wird, beantworte kurz:

### 1. Was ist sichtbar schlecht?

- Welche Metrik?
- Wie groß ist die Sample Size?
- Auf welcher Street, Route, Position oder Handklasse?

### 2. Wo entsteht es wahrscheinlich?

- **Arrival Quality:** Kommt die Range schon schlecht im Spot an?
- **Spot Decision:** Ist die konkrete Entscheidung falsch?
- **Line / Sequence:** Führt eine frühere Line in schlechte Spätspots?
- **Sizing / Pot Geometry:** Erzeugen Bets oder Calls schlechte SPR/Pot-Odds?
- **Range Composition:** Ist die Range zu trash-heavy, capped oder value-arm?
- **Table Dynamics:** HU/MW, Position, Blind-Kontext, Stackdruck, Gegnerread?
- **Artifact / Noise:** Ist die Metrik erklärbar oder zu klein?

### 3. Was wäre der kleinste Runtime-Proxy?

- Route / spotKey
- Handfamilie / Handklasse
- Position / Blind-Kontext
- HU/MW
- Pot-Odds-Bucket
- `flatScore` / `defendScore` / playability / domination
- `preflopRaiseCount` / `raiseLevel`
- PairClass / DrawFlag / LiftType / Texture

## Equity richtig verwenden

Equity ist besonders nützlich bei:

- Call-Qualität
- High-Equity-Folds
- Low-Equity-Calls
- Low-Equity-Raises
- Preflop-Arrival
- Blind-Defense
- MDF-/Overfold-Widersprüchen
- trash-heavy späteren Ranges

Auswerten nach:

- phase / action
- signal
- `candidate.reason`
- `equityPct`
- `potOddsPct`
- `marginPct`
- `equityRank`
- `activePlayers`
- route / spotKey
- handClass
- position / blind context
- HU/MW
- spätere Arrival-Klasse

Wichtig:

- Einzelbeispiele sind Hinweise, keine Wahrheit.
- `equity_enriched/candidates` misst nur die Abdeckung der vorselektierten Kandidaten. Bei einer
  gezielten Diagnose zusätzlich prüfen, ob alle Entscheidungen des untersuchten Pfads ein
  `equityDiagnostic` haben. Fehlende Abdeckung am Mechanismus oder an der Route ergänzen, nicht über
  einzelne bekannte Handfamilien.
- Negative Equity-Margin ist kein automatischer Fold.
- Positive Equity-Margin ist kein automatischer Call.
- Position, Realisierung, Stackdruck, Handklasse und Exploitability bleiben entscheidend.

## MDF / Overfold / Range Defense

Bei MDF- oder Overfold-Leaks zuerst klären:

### 1. Gute Range, falsche Entscheidung

- Genügend defendable Hände vorhanden.
- Diese folden trotz Preis, Position oder Handqualität zu oft.
- Hebel: konkrete Postflop-Defendability oder Call-Barriere.

### 2. Schlechte Range, schlechtes Arrival

- Viele schlechte passive Preflop-Routen oder trash-heavy Ankunft.
- Späteres Lockern würde nur Trash-Calls erzeugen.
- Hebel: upstream Entry, Call, Limp oder Defense.

### 3. Gute Hände, schlechte Line

- Plausible Hände kommen an, werden aber durch Check/Call/Barrel-Abbruch/Sizing schlecht geführt.
- Hebel: Line-Fortsetzung oder Pot-Geometrie.

Preflop-Tightening ist kein gültiger MDF-Fix, wenn der Backtrace zeigt, dass der Overfold breit über viele Familien verteilt ist und vor allem aus Air, weak draws, Overcards oder Blocker-Klassifikation entsteht.

## Early Busts und kurze Turniere

Kurze Turniere sind in Winner-take-all nicht automatisch schlecht.

Early Busts sind nur ein Leak-Kandidat, wenn mehrere Signale zusammenkommen:

- schwache oder dominierte Handklasse
- schlechte Equity/Pot-Odds-Marge
- schlechte Position oder zweiter Blind
- falsche Zone oder unnötiger Stackdruck
- wiederholtes Muster in ausreichend Sample

Starke Hände, Push-Fold-Druck und echte Cooler sind keine Failures.

## Short-Handed Action

SB-HU und BTN-3 sind Action-Engines. Sie sollen Druck erzeugen.

Bewerte sie als System:

- Open-Frequenz
- Blind-Defense
- beide Blinds defend
- Flop-seen
- Uncontested
- Showdown-Struktur
- Early-Bust-Effekt

Hohe BTN-3 combined Blind-Defense ist nicht automatisch schlecht, weil zwei Blinds verteidigen können. SB-Defense und zweite Blind-Entries brauchen aber mehr Disziplin als BB-Closes mit gutem Preis.

## Candidate Gate

Ein Kandidat ist qualifiziert, wenn:

- die Sample Size reicht,
- die Ursache strategisch plausibel ist,
- der Hebel in `js/bot.js` durch Runtime-Signale abbildbar ist,
- Equity/MDF/Backtrace die Hypothese stützt oder nicht widerspricht,
- priced/playable Hände im selben Cluster geschützt bleiben,
- Core-Action-Engines nicht austrocknen,
- keine harte Guardrail gefährdet wird.

### Range-Preservation-Gate

Bei jedem Tightening muss vor der Bewertung gezeigt werden, welche plausiblen Hände als
Nebenwirkung seltener gespielt werden. Der Vergleich muss mindestens enthalten:

- Zielcluster und bewusst entfernte schwache Hände
- geschützte benachbarte Handfamilien
- starke Kontrollgruppe
- guter und schlechter Preis
- HU/MW sowie IP/OOP, soweit für die Route relevant

Prüfe bei jedem Tightening, welche Calls und Raises im Zielspot und in späteren Lines
wegfallen. Ziel ist, die Botmetriken zu verbessern und die Range gegen plausible Bluffs
menschlicher Gegner verteidigungsfähig zu halten.

- Kann das Tightening die Defense in einer für Gegner erkennbaren Line schwächen, validiere
  gegen ein aggressives Kontrollprofil, das in dieser Line ausreichend oft Druck macht.
- Fallen dort plausible Bluffcatcher oder starke Hände aus einer Check-Range, prüfe zusätzlich
  eine erhöhte Bluff-Frequenz bei gleicher Value-Range und Betgröße.
- Lege den tolerierbaren Rückgang im Chipwert des Kontrollfelds vor dem Lauf fest
  ([Vergleich aufsetzen](#vergleich-aufsetzen)).

Nutze MDF, um mögliche Lücken zu finden. Bewerte die Fortsetzungen anhand von Preis,
Betfolge und Chipwert gegen die getesteten Value- und Bluff-Ranges. Kommen zu wenige
verteidigungsfähige Hände an, prüfe das Arrival und die Zusammensetzung der Check-Range.

Core Health und eine verbesserte Zielmetrik reichen nicht als Freigabe. Der Kandidat ist nicht
qualifiziert, wenn geschützte priced/playable Hände deutlich austrocknen, ohne dass Equity,
Backtrace und Range Composition den Verlust stützen.

Bei jedem Loosening gilt die Gegenprobe: Zuerst zeigen, welcher zusätzliche Trash in die Range
gelangt, bevor die gewünschte Mehraktivität bewertet wird.

Ein Kandidat ist nicht qualifiziert, wenn:

- er nur eine auffällige Zahl optimiert,
- der Effekt wahrscheinlich Noise ist,
- er direkt Equity in Runtime-Logik braucht,
- er breite neue Hard Guards erfordert,
- er eine Zielmetrik durch Problemverschiebung verbessert,
- er gute Calls oder Value-Aggression überproportional entfernt.

## Stop-Kriterien

Starte keinen neuen Tuning-Pass, wenn:

- nur eine einzelne Metrik auffällt und keine Beispielanalyse denselben Leak bestätigt,
- der Leak nicht in mindestens zwei unabhängigen Dimensionen clusterbar ist, z. B. Handklasse + Street, Seat + Route oder Preis + Boardstruktur,
- der Fix mehr neue Bedingungen erzeugt als strategische Klarheit bringt,
- ein lokaler Sonderhebel nur einen sehr kleinen Anteil aller Hände betrifft, außer er behebt einen harten Guardrail-Fehler,
- derselbe Leak bereits zwei verworfene Kandidaten erzeugt hat. Verbessere dann zuerst Diagnose, Backtrace, Equity- oder MDF-Auswertung statt weiter an Schwellen zu drehen,
- Core Health stabil ist und die auffälligen Beispiele pokerlogisch erklärbar sind. Dann akzeptiere den Zustand und perfektioniere nicht weiter.

Wenn ein Leak nur durch mehrere lokale Ausnahmen lösbar scheint, baue keinen weiteren Patch. Markiere ihn als Modell-Lücke und plane einen zentraleren Hebel.

Diese Stop-Kriterien sollen kleinteilige Symptom-Patches verhindern, nicht saubere größere Modellhebel. Wenn die Diagnose eine strukturelle Modell-Lücke zeigt, formuliere den größeren Hebel explizit und validiere ihn breiter statt ihn aus Vorsicht zu vermeiden.

## Hypothese vor Code

Vor jeder Code-Änderung kurz festhalten:

- Ziel-Leak
- vermutete Ursache
- betroffene Route / Handklasse / Position / Street
- Runtime-Proxy
- geplanter Hebel
- erwarteter Effekt
- wichtigste Nebenwirkungen
- Falsifikationskriterien

Bei Range-, Call- oder Defense-Tuning zusätzlich als Kandidatenvertrag festhalten:

- welche Hände oder Cluster bewusst häufiger oder seltener gespielt werden sollen
- welche benachbarten Handfamilien geschützt bleiben müssen
- welche Preis-, Positions- und Struktur-Spots geschützt bleiben müssen
- welche Verschiebung den Kandidaten unabhängig von der Zielmetrik falsifiziert

Ein Pass = eine Ursache, ein fokussierter Hebel.

## Gute Hebel

- bestehende Schwelle leicht verschieben
- Ratio oder Cap kontextsensitiv justieren
- kleine Score-Gewichtung ändern
- bestehende Bewertung um einen kontinuierlichen Term ergänzen
- Handklasse sauberer unterscheiden
- vorhandene Barriere nach Route, Position, Street oder Struktur kalibrieren

## Schlechte Hebel

- globale OOP-Mali
- globale suited-Mali
- globale Blind-Defense-Mali
- globale Air-Call-Freigaben
- breite neue Hard Guards
- direkte Equity-Checks
- mehrere Call-/Raise-/Sizing-Änderungen gleichzeitig

## Validation Ladder

Nach Bot-Code-Änderung:

```bash
deno check js/bot.js
```

Bei Range-, Call- oder Defense-Tuning vor den großen Batches zusätzlich einen Counterfactual-Audit
auf der Vergleichsbasis durchführen: Welche geloggten Entscheidungen würden durch den neuen Hebel
kippen, und aus welchen Handfamilien, Preis-, Positions- und Struktur-Spots kommen diese Flips?

Vor dem Batch außerdem die minimale, typische und maximale Wirkung des Hebels auf den betroffenen
Score oder die Barriere ausrechnen. Ein großer möglicher Ausschlag ist als Range-Schnitt zu
validieren, nicht als kleines Feintuning.

Dann staged validieren:

Die Ladder wird pro Kandidat nur so weit durchlaufen, wie das vorherige Gate bestanden ist. Ein
Kandidat erhält jede Stufe höchstens einmal. Nur der final qualifizierte Kandidat erhält den 1000er
Acceptance-Batch.

### 1. Strukturcheck

```bash
deno task engine:batch
```

### 2. Validation-Stabilität

Wenn der Strukturcheck plausibel ist:

```bash
deno task engine:batch:500
```

### 3. Validation-Acceptance

Wenn der 500er stabil ist:

```bash
deno task engine:batch:1000
```

### 4. Equity bei Bedarf

Equity ist kein automatischer Schritt. Ein Equity-Trigger liegt vor, wenn mindestens eines gilt:

- Call- oder Range-Qualität bleibt nach Core-, MDF- und Backtrace-Auswertung ambivalent.
- priced/playable Hände oder andere geschützte Kontrollgruppen verschwinden deutlich.
- High-Equity-Folds oder Low-Equity-Calls sind ein plausibler Teil der Diagnose.
- Die vorhandenen Metriken erzählen widersprüchliche Geschichten über denselben Zielcluster.

Dann zuerst einen kleinen passenden Diagnosebatch aus dem Diagnose-Menü nutzen. Nur wenn der
Kandidat danach weiter qualifiziert, die Frage aber für den Live-Kandidaten materiell offen bleibt,
einen finalen 1000er Equity-Batch ausführen:

```bash
deno task engine:batch -- --runs=1000 --equity-preflop --equity-limit=3000
```

Pro Goal gibt es höchstens einen finalen 1000er Equity-Batch. Ohne dokumentierten Equity-Trigger
entfällt dieser Schritt.

## Validierung strategischer Entscheidungen

Der Core-Batch misst den gespielten Action-Mix, Turnierverlauf und Guardrails im Self-Play. Er
gehört zu jeder Änderung am Spielverhalten. Ein Replay vergleicht die Entscheidungen im
Zielcluster. Ein Matchup-Experiment prüft, ob der Vorteil einer Strategie gegen relevante
Gegnerprofile trägt. Beide Verfahren gelten für Preflop-Ranges, Calls, Bluffs, Value-Bets,
Sizing, Line-Fortsetzungen und Push/Fold.

- Verwende ein Replay, wenn sich die Aktionswahl, Betgröße oder Range im Zielcluster ändert.
- Verwende ein Matchup-Experiment, wenn unterschiedliche Gegnerreaktionen den Nutzen der
  Änderung oder ihre Nebenwirkungen bestimmen können.
- Prüfe einen klar abgegrenzten Regelfall oder eine harte Guardrail mit einem reproduzierbaren
  Szenario und dem Core-Batch. Betrifft der Fix auch normale Strategie-Spots, prüfe diesen
  Effekt mit den entsprechenden Vergleichen.

Wähle die Kennzahl nach dem Ziel. Bei Value-Sizing kann der Chipwert bis Handende im Zielspot
entscheidend sein. Bei Push/Fold im Winner-take-all zählt für die Turnierfreigabe die Siegquote.
Wenn die Änderung beeinflusst, welche Hände einen Spot erreichen, prüfe zusätzlich seine
Häufigkeit und den Chipwert je Hand.

### Vergleich aufsetzen

Die Wahl des Zielspots folgt aus der [Mustersuche](#mustersuche-vor-der-hebelwahl). Die folgenden
Schritte verwenden diesen Befund für den Replay- und Kandidatenvergleich.

1. Vor dem Kandidaten die Baseline, den Zielspot, das Zielprofil und ein Kontrollprofil festlegen.
   Halte fest, ab welchem Gewinn der Effekt relevant ist und welchen Rückgang du im Kontrollprofil
   tolerierst. Plane die Mindestzahl an Turnierpaaren und Zielspots je Variante. Friere außerdem
   Gegnerpool, Vergleichsmetrik und die für die Freigabe reservierten Profile und Seeds ein.
2. Im Replay dieselben Ausgangssituationen vergleichen. Beim Angriff ist der Check die Referenz für
   eine zusätzliche Bet. Bei der Defense bleiben Betgröße und gegnerische Value- und Bluff-Range
   vorgegeben. Bei einer Sizing-Änderung startet der Vergleich vor der Bet. Das Replay misst den
   Chipwert bis zum Handende.
3. Im Experiment je Gegnerfeld die bisherige Strategie und den Kandidaten zuweisen. Der Runner
   baut daraus beide Tische, paart die Turniere und berichtet den Unterschied mit einem
   95-%-Intervall. Die Reads entstehen im Spiel. Vergleiche bei Bedarf getrennt, wie sich frische
   und aufgebaute Reads auswirken.
4. Den Befund auf neuen Seeds und einem Gegnerprofil prüfen, das beim Tuning noch nicht verwendet
   wurde. Bei gemeinsamer Freigabe im selben Feld die Baseline, Angriff, Defense und die Kombination
   vergleichen. Zusätzlich den neuen Angriff gegen die neue Defense spielen lassen. Für den
   Rollout fünf alte und fünf neue Bots jeweils gegen denselben Profil-Sitz vergleichen.

Der Runner rotiert die Rollen und seedet Karten und Bot-Entscheidungen getrennt. Nach abweichenden
Aktionen dürfen sich dieselben Turnierläufe unterschiedlich entwickeln. Replay-Vergleiche halten
den Ausgangsspot direkt fest.

Die Freigabe erfolgt stufenweise. Die Diagnose lokalisiert den Effekt. Die Validierung prüft ihn
gegen Ziel- und Kontrollprofile. Der Holdout prüft die eingefrorene Änderung. Der Rollout prüft
den Tisch in der geplanten Besetzung. Erst danach zählt das Ergebnis zusammen mit dem Core-Batch
und seinen Guardrails als Freigabenachweis. Technische Unterbrechungen und Pot-Abweichungen
blockieren das betroffene Experiment. Der Report weist die betroffenen Paare aus.
[Konfiguration, Kennzahlen und Status](./matchup-experiments.md)

### Gegnerpool

Der Gegnerpool enthält TAG, LAG, Calling Station und Nit. Die Profile unterscheiden sich darin,
welche Hände sie spielen und wie aggressiv sie auf den einzelnen Streets vorgehen.
[PokerStars zu den vier Spielstilen](https://www.pokerstars.com/poker/learn/lesson/other-poker-playing-styles/) ·
[Jonathan Little zu den Merkmalen](https://pokercoaching.com/blog/different-poker-players/)

Für eine gezielte Diagnose variiere einen Parameter, etwa die Bluff-Frequenz bei gleicher
Value-Range und Betgröße. Für die Freigabe den festen Pool mit unveränderten Strategien
verwenden. Auch die Referenz auf den regulären Bot im Gegnerfeld muss für Baseline und Kandidat
dieselbe feste Version verwenden.

#### Spielweise der Profile

Preflop bestimmen Position, effektiver Stack, Betgröße und bisherige Aktionen die Ranges für
Open-Raises, Limps, Calls und Reraises. TAG und LAG öffnen in später Position mehr Hände.
Der LAG setzt häufiger leichte 3-Bets gegen späte Opens ein. Die Calling Station steigt mit
vielen Händen per Limp oder Call ein. Der Nit spielt eine enge Range und verteidigt die Blinds
selektiv. [Preflop-Ranges im Code](../matchupPreflop.js) ·
[Harrington über Turnierspiel und Spielstile](https://forumserver.twoplustwo.com/33/books-publications/harringtons-new-tourney-book-1410913/index2.html) ·
[Jonathan Little über Position und Stacktiefe](https://pokercoaching.com/blog/short-stack-vs-raise-how-to-adjust-your-preflop-strategy-in-mtts/) ·
[PokerStars über Isolation Raises](https://www.pokerstars.com/poker/learn/strategies/taking-advantage-of-poker-players-that-limp-preflop/)

Postflop bewerten die Profile die Hand relativ zum Board, etwa ein privates Paar auf einem
gepaarten Board. Bei Combo Draws zählen gemeinsame Outs einmal. Calls berücksichtigen
Betgröße, Gegnerzahl und wiederholten Druck. Der TAG setzt selektiv für Value und als
Semi-Bluff. Der LAG barrelt häufiger mit Draws und blufft ausgewählte River-Runouts.
Die Calling Station callt auch mit schwächeren Paaren und Draws. Der Nit gibt schwache
Hände früher auf und raist starke Hände selektiv. [Postflop-Regeln im Code](../matchupPostflop.js) ·
[PokerStars zu Continuation Bets](https://www.pokerstars.com/poker/learn/lesson/c-betting/) ·
[Jonathan Little zu Straight Draws](https://pokercoaching.com/blog/open-ended-straight-draw-in-poker/) ·
[Ed Miller zu situationsabhängiger Aggression](https://www.cardplayer.com/poker-news-23577-poker-strategy-with-ed-miller-misplaced-aggression)

#### Profile prüfen und weiterentwickeln

Lege den Zielspot fest und prüfe im Batch, wie oft das Profil Gelegenheit für die relevante
Line hat und wie oft es sie spielt. Untersuche Preflop Position, Stacktiefe und vorausgehende
Aktion. Untersuche Postflop Street, Initiative, Handklasse und Betgröße. Nutze VPIP, PFR und
Aktionsraten je Street als Übersicht. Für den Abgleich mit menschlichen Frequenzen brauchst du
Handverläufe aus vergleichbaren Spots.

Prüfe seltene Lines mit festen Testszenarien. Nutze Replays, um verschiedene Entscheidungen
am selben Ausgangsspot zu vergleichen. Prüfe bei Bedarf mit einer absichtlich geschwächten
Bot-Variante, ob das Profil den eingebauten Fehler im Zielspot reproduzierbar in Chipgewinn
umsetzt. [Matchup-Tests](../matchupBatch.test.js) · [Replay](../matchupReplay.js)

Vertiefe ein Profil, wenn es eine relevante Line trotz genügend Gelegenheiten zu selten oder
zu einfach spielt oder der Kontrolllauf eine bekannte Schwäche kaum sichtbar macht.
Ergänze einen Gegnertyp, wenn dem Pool eine für die Testfrage relevante Spielweise fehlt.

Dokumentiere das Zielverhalten, die Messung und die verwendete Pool-Konfiguration.

### Runner und Auswertung

```bash
deno task engine:matchup scripts/matchupPool.js tmp/matchup-pool.json
deno task engine:matchup scripts/matchupBaseline.js tmp/matchup-river-diagnosis.json
deno task engine:experiment scripts/matchupAudit.js tmp/matchup-audit.json
deno task engine:replay scripts/matchupReplayAudit.js tmp/matchup-replay-audit.json
```

Die Pool-Konfiguration enthält Self-Play als Referenz, einen gemischten Tisch mit fünf
unterschiedlichen Gegnern und eine Variante mit mehr aggressiven Gegnern. Die zweite
Konfiguration enthält die gezielten River-Profile für die Diagnose.
Für einen Kandidaten eine eigene Konfiguration unter `tmp/` mit festen Strategieversionen
anlegen. `strategies` ordnet Namen Funktionen mit der Signatur `(player, state, line) => action` zu.
Batch und Replay leiten `line` aus den ausgeführten Aktionen ab. `flop` und `turn` enthalten
die Sitznummer des letzten Aggressors der jeweiligen abgeschlossenen Street. Ohne Aggressor
steht dort `null`.
`lineups` weist diesen Strategien benannte Sitzrollen zu. Alle Aufstellungen verwenden dieselben
Rollennamen. Die Profile entscheiden anhand öffentlich sichtbarer Informationen und eigener
Karten. Eine optionale Funktion `classifySpot(state, player, role, line)` benennt den Zielspot vor der
Aktion oder gibt `null` zurück.

Der Bericht enthält je Lauf und Rolle gespielte Hände, Turniersiege, Netto-BB, VPIP und PFR.
Für VPIP und PFR die jeweiligen Handzahlen durch die gespielten Hände teilen.
Für markierte Spots enthält er je tatsächlich ausgeführter Aktion die Anzahl und die Netto-BB ab
der Entscheidung. Teile die Summe durch die Anzahl der Spots. Bereits investierte Chips zählen
zum Pot. Wenn sich die Häufigkeit der Spots ändert, zusätzlich die Netto-BB je gespielter Hand
prüfen. Beim Angriff auch den Wert der zusätzlichen Bluffs gegenüber dem Check aus dem Replay
berichten. MDF hilft bei der Diagnose der Frequenzen. Für die Freigabe zählen der vereinbarte
Chipwert-Vergleich und die bestehenden Core-Guardrails.

## Hard Guardrails

Diese Werte dürfen nicht brechen:

- premium preflop folds = 0
- bluff raises with made hand = 0
- postflop all-in low-edge reraises = 0

Diese Bereiche dürfen nicht klar regressieren:

- low-edge reraises
- early large pots und Early-Bust-Cluster
- Showdown / Uncontested-Struktur
- Preflop und Postflop Action-Mix
- SB-HU Action Engine
- BTN-3 Action Engine
- BB-Defense gegen guten Preis
- Value Betting und Value Raising
- priced/playable Calls im Zielcluster

## Acceptance

Akzeptiere einen Kandidaten nur, wenn:

- die Zielursache plausibel verbessert wurde,
- die Zielmetrik gegen die Vergleichsbasis besser ist,
- Core Health stabil bleibt,
- Guardrails sauber bleiben,
- Equity/MDF/Backtrace nicht widersprechen,
- die für den strategischen Eingriff vereinbarten Replay- und Matchup-Kriterien erfüllt sind,
- keine Verbesserung durch Trash-Calls, Spew oder Problemverschiebung entsteht,
- der Bot als Ganzes plausibler spielt.

Ein Core-Batch validiert Core Health, aber noch keine Range Acceptance. Wenn ein dokumentierter
Equity-Trigger vorliegt, darf der Status `accepted` erst nach der erforderlichen Equity-Prüfung
vergeben werden. Ohne Equity-Trigger reichen Core Acceptance und die übrigen passenden Nachweise.

Verwerfe oder überarbeite, wenn:

- die Verbesserung nur lokal und nicht strategisch plausibel ist,
- verwandte Metriken klar schlechter werden,
- gute/priced/playable Hände überproportional verschwinden,
- der Schaden auf eine andere Street, Line oder Handklasse wandert,
- der Hebel nur eine Messzahl sauberer macht.

## Abschlussbericht

Kurz berichten:

- Vergleichsbasis und Pfad
- Diagnose und Ziel-Leak
- Hypothese
- geänderter Hebel
- wichtige Metriken vorher/nachher
- Zielcluster sowie geschützte Kontrollgruppen vorher/nachher
- Counterfactual-Flips nach Handfamilie, Preis, Position und Struktur, soweit relevant
- Equity-Ergebnis, falls genutzt
- Guardrail-Status
- Kandidatenentscheidung: `accepted` oder `rejected`, falls ein Kandidat getestet wurde
- Goal-Abschluss: `accepted` oder `no-qualified-candidate`

Wenn `accepted`:

- nur akzeptierte Änderungen behalten
- fehlgeschlagene Experimente entfernen
- relevante tmp-Batches für Nachvollziehbarkeit stehen lassen
- bei Livegang Versionseintrag und Service-Worker-Version aktualisieren

Wenn `rejected`:

- Kandidaten-Code entfernen
- Fehlschlag kurz erklären
- nächste Diagnosefrage benennen
- bei einer verworfenen qualifizierten Iteration einen kurzen Learning Report in `scripts/docs/bot-tuning-learnings.md` ergänzen

## Learning Reports

Ein Learning Report ist ein Anti-Wiederholungslog für Codex, kein langer Bericht. Schreibe ihn nach jeder verworfenen qualifizierten Iteration, also wenn eine plausible Hypothese mit Staged Validation getestet und danach verworfen wurde.

Halte ihn kurz:

- Datum und Kandidat
- Hypothese
- getesteter Hebel
- wichtigste Validierung
- warum verworfen
- wann diese Route wieder erlaubt ist

Nicht eintragen:

- reine Noise-Sichtungen
- abgebrochene unqualifizierte Ideen
- offensichtliche Syntax-/Implementierungsfehler ohne strategisches Learning
