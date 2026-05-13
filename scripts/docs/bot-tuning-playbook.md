# Bot Tuning Playbook

## Zweck

Dieses Dokument fuehrt groessere Bot-Tuning-Iterationen. Es ist kein zweiter North Star. Die strategischen Leitplanken stehen in `js/bot.js`; dieses Playbook soll helfen, bei einer Iteration schnell die richtige Diagnose, den kleinsten sinnvollen Hebel und eine belastbare Validierung zu waehlen.

Lies vor jeder Bot-Tuning-Iteration auch `scripts/docs/bot-tuning-learnings.md`. Dort stehen akzeptierte und verworfene Routen, die nicht ohne neue Evidenz wiederholt werden sollen.

## Grundsatz

Tune nicht die Metrik. Tune die Ursache.

Der Bot bleibt heuristisch. Equity, MDF und Batch-Metriken sind Diagnose- und Kalibrierungsschichten, keine Runtime-Entscheidungsmodelle.

### Direkt verboten

- `equityPct` oder `equityRank` in `js/bot.js` als Entscheidungskriterium nutzen.
- Logs, Analyse oder Metrikdefinitionen aendern, nur damit ein Kandidat besser aussieht.
- MDF oder Overfold durch offensichtliche Trash-Calls reparieren.
- Globale Tightness oder globale Loose-ness ohne Root-Cause-Beleg einfuehren.
- Mehrere unabhaengige Leaks in einem Pass loesen.

## Arbeitsbereich

### Normaler Tuning-Zielort

- `js/bot.js`

### Erlaubt, wenn es zur Iteration gehoert

- temporaere Analysen und Reports in `tmp/`
- Batch-Ausgaben in `tmp/`
- `js/version.js` und Service-Worker-Version, wenn ein akzeptierter Kandidat live gehen soll
- Analyse-Erweiterungen nur mit ausdruecklicher Zustimmung und nur minimal

### Nicht ohne ausdrueckliche Zustimmung

- Engine-Logik
- Testlogik
- Logging-Formate
- bestehende Metrikdefinitionen
- UI-/Copy-Aenderungen

## Iteration in Kurzform

1. `scripts/docs/bot-tuning-learnings.md` lesen.
2. Vergleichsbasis festlegen.
3. Auffaellige Metrik finden, aber nicht sofort tunen.
4. Ursache lokalisieren: Arrival, Spot Decision, Line, Sizing, Range, Stackdruck oder Artefakt.
5. Bei Bedarf Equity-/MDF-/Backtrace-Diagnose nutzen.
6. Eine konkrete Hypothese formulieren.
7. Einen fokussierten Hebel in `js/bot.js` aendern.
8. Staged Validation laufen lassen.
9. Akzeptieren, verwerfen oder Diagnose aktualisieren.

## Baseline Policy

Nutze die letzte akzeptierte 1000er Baseline, solange sie noch zur Bot-Version und zur Fragestellung passt.

Erzeuge eine frische 1000er Core-Baseline, wenn:

- eine neue groessere Tuning-Kampagne beginnt,
- der letzte akzeptierte Stand unklar ist,
- seit der letzten Baseline mehrere Bot-Aenderungen passiert sind,
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

## Diagnose-Menue

Waehle die Diagnose nach dem Leak. Nicht jeder Leak braucht alle Werkzeuge.

### Core-Struktur

```bash
deno task engine:batch
```

### Stabilitaet

```bash
deno task engine:batch:500
```

### Acceptance

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

### Groesserer Equity-Check

Bei wichtigen oder ambivalenten Kandidaten:

```bash
deno task engine:batch -- --runs=1000 --equity-preflop --equity-limit=3000
```

### Speedmode

- Wenn lokale Browser-Automation verfuegbar ist, nach Bot-Logik-Aenderungen staged Speedmode nutzen.
- Wenn Speedmode blockiert ist, den Blocker klar nennen und Engine-Batches verwenden.

## Root-Cause-Fragen

Bevor Code geaendert wird, beantworte kurz:

### 1. Was ist sichtbar schlecht?

- Welche Metrik?
- Wie gross ist die Sample Size?
- Auf welcher Street, Route, Position oder Handklasse?

### 2. Wo entsteht es wahrscheinlich?

- **Arrival Quality:** Kommt die Range schon schlecht im Spot an?
- **Spot Decision:** Ist die konkrete Entscheidung falsch?
- **Line / Sequence:** Fuehrt eine fruehere Line in schlechte Spaetspots?
- **Sizing / Pot Geometry:** Erzeugen Bets oder Calls schlechte SPR/Pot-Odds?
- **Range Composition:** Ist die Range zu trash-heavy, capped oder value-arm?
- **Table Dynamics:** HU/MW, Position, Blind-Kontext, Stackdruck, Gegnerread?
- **Artifact / Noise:** Ist die Metrik erklaerbar oder zu klein?

### 3. Was waere der kleinste Runtime-Proxy?

- Route / spotKey
- Handfamilie / Handklasse
- Position / Blind-Kontext
- HU/MW
- Pot-Odds-Bucket
- `flatScore` / `defendScore` / playability / domination
- `preflopRaiseCount` / `raiseLevel`
- PairClass / DrawFlag / LiftType / Texture

## Equity richtig verwenden

Equity ist besonders nuetzlich bei:

- Call-Qualitaet
- High-Equity-Folds
- Low-Equity-Calls
- Low-Equity-Raises
- Preflop-Arrival
- Blind-Defense
- MDF-/Overfold-Widerspruechen
- trash-heavy spaeteren Ranges

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
- spaetere Arrival-Klasse

Wichtig:

- Einzelbeispiele sind Hinweise, keine Wahrheit.
- Negative Equity-Margin ist kein automatischer Fold.
- Positive Equity-Margin ist kein automatischer Call.
- Position, Realisierung, Stackdruck, Handklasse und Exploitability bleiben entscheidend.

## MDF / Overfold / Range Defense

Bei MDF- oder Overfold-Leaks zuerst klaeren:

### 1. Gute Range, falsche Entscheidung

- Genuegend defendable Haende vorhanden.
- Diese folden trotz Preis, Position oder Handqualitaet zu oft.
- Hebel: konkrete Postflop-Defendability oder Call-Barriere.

### 2. Schlechte Range, schlechtes Arrival

- Viele schlechte passive Preflop-Routen oder trash-heavy Ankunft.
- Spaeteres Lockern wuerde nur Trash-Calls erzeugen.
- Hebel: upstream Entry, Call, Limp oder Defense.

### 3. Gute Haende, schlechte Line

- Plausible Haende kommen an, werden aber durch Check/Call/Barrel-Abbruch/Sizing schlecht gefuehrt.
- Hebel: Line-Fortsetzung oder Pot-Geometrie.

Preflop-Tightening ist kein gueltiger MDF-Fix, wenn der Backtrace zeigt, dass der Overfold breit ueber viele Familien verteilt ist und vor allem aus Air, weak draws, Overcards oder Blocker-Klassifikation entsteht.

## Early Busts und kurze Turniere

Kurze Turniere sind in Winner-take-all nicht automatisch schlecht.

Early Busts sind nur ein Leak-Kandidat, wenn mehrere Signale zusammenkommen:

- schwache oder dominierte Handklasse
- schlechte Equity/Pot-Odds-Marge
- schlechte Position oder zweiter Blind
- falsche Zone oder unnoetiger Stackdruck
- wiederholtes Muster in ausreichend Sample

Starke Haende, Push-Fold-Druck und echte Cooler sind keine Failures.

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

Hohe BTN-3 combined Blind-Defense ist nicht automatisch schlecht, weil zwei Blinds verteidigen koennen. SB-Defense und zweite Blind-Entries brauchen aber mehr Disziplin als BB-Closes mit gutem Preis.

## Candidate Gate

Ein Kandidat ist qualifiziert, wenn:

- die Sample Size reicht,
- die Ursache strategisch plausibel ist,
- der Hebel in `js/bot.js` durch Runtime-Signale abbildbar ist,
- Equity/MDF/Backtrace die Hypothese stuetzt oder nicht widerspricht,
- priced/playable Haende im selben Cluster geschuetzt bleiben,
- Core-Action-Engines nicht austrocknen,
- keine harte Guardrail gefaehrdet wird.

Ein Kandidat ist nicht qualifiziert, wenn:

- er nur eine auffaellige Zahl optimiert,
- der Effekt wahrscheinlich Noise ist,
- er direkt Equity in Runtime-Logik braucht,
- er breite neue Hard Guards erfordert,
- er eine Zielmetrik durch Problemverschiebung verbessert,
- er gute Calls oder Value-Aggression ueberproportional entfernt.

## Hypothese vor Code

Vor jeder Code-Aenderung kurz festhalten:

- Ziel-Leak
- vermutete Ursache
- betroffene Route / Handklasse / Position / Street
- Runtime-Proxy
- geplanter Hebel
- erwarteter Effekt
- wichtigste Nebenwirkungen
- Falsifikationskriterien

Ein Pass = eine Ursache, ein fokussierter Hebel.

## Gute Hebel

- bestehende Schwelle leicht verschieben
- Ratio oder Cap kontextsensitiv justieren
- kleine Score-Gewichtung aendern
- bestehende Bewertung um einen kontinuierlichen Term ergaenzen
- Handklasse sauberer unterscheiden
- vorhandene Barriere nach Route, Position, Street oder Struktur kalibrieren

## Schlechte Hebel

- globale OOP-Mali
- globale suited-Mali
- globale Blind-Defense-Mali
- globale Air-Call-Freigaben
- breite neue Hard Guards
- direkte Equity-Checks
- mehrere Call-/Raise-/Sizing-Aenderungen gleichzeitig

## Validation Ladder

Nach Bot-Code-Aenderung:

```bash
deno check js/bot.js
```

Dann staged validieren:

### 1. Strukturcheck

```bash
deno task engine:batch
```

### 2. Stabilitaet

Wenn der Strukturcheck plausibel ist:

```bash
deno task engine:batch:500
```

### 3. Acceptance

Wenn der 500er stabil ist:

```bash
deno task engine:batch:1000
```

### 4. Equity-Acceptance

Wenn der Kandidat equity-relevant ist oder die Summary ambivalent bleibt:

```bash
deno task engine:batch -- --runs=1000 --equity-preflop --equity-limit=3000
```

Bei kleinen, klar abgegrenzten Feintunings darf ein kleiner Zwischenbatch genutzt werden, aber ein Live-Kandidat braucht eine belastbare Acceptance.

## Hard Guardrails

Diese Werte duerfen nicht brechen:

- premium preflop folds = 0
- bluff raises with made hand = 0
- postflop all-in low-edge reraises = 0

Diese Bereiche duerfen nicht klar regressieren:

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
- keine Verbesserung durch Trash-Calls, Spew oder Problemverschiebung entsteht,
- der Bot als Ganzes plausibler spielt.

Verwerfe oder ueberarbeite, wenn:

- die Verbesserung nur lokal und nicht strategisch plausibel ist,
- verwandte Metriken klar schlechter werden,
- gute/priced/playable Haende ueberproportional verschwinden,
- der Schaden auf eine andere Street, Line oder Handklasse wandert,
- der Hebel nur eine Messzahl sauberer macht.

## Abschlussbericht

Kurz berichten:

- Vergleichsbasis und Pfad
- Diagnose und Ziel-Leak
- Hypothese
- geaenderter Hebel
- wichtige Metriken vorher/nachher
- Equity-Ergebnis, falls genutzt
- Guardrail-Status
- Entscheidung: `accepted`, `rejected` oder `no-qualified-candidate`

Wenn `accepted`:

- nur akzeptierte Aenderungen behalten
- fehlgeschlagene Experimente entfernen
- relevante tmp-Batches fuer Nachvollziehbarkeit stehen lassen
- bei Livegang Versionseintrag und Service-Worker-Version aktualisieren

Wenn `rejected`:

- Kandidaten-Code entfernen
- Fehlschlag kurz erklaeren
- naechste Diagnosefrage benennen
- bei einer verworfenen qualifizierten Iteration einen kurzen Learning Report in `scripts/docs/bot-tuning-learnings.md` ergaenzen

## Learning Reports

Ein Learning Report ist ein Anti-Wiederholungslog fuer Codex, kein langer Bericht. Schreibe ihn nach jeder verworfenen qualifizierten Iteration, also wenn eine plausible Hypothese mit Staged Validation getestet und danach verworfen wurde.

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
