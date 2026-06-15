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
2. Vergleichsbasis festlegen.
3. Auffällige Metrik finden, aber nicht sofort tunen.
4. Ursache lokalisieren: Arrival, Spot Decision, Line, Sizing, Range, Stackdruck oder Artefakt.
5. Bei Bedarf Equity-/MDF-/Backtrace-Diagnose nutzen.
6. Eine konkrete Hypothese formulieren.
7. Einen fokussierten Hebel in `js/bot.js` ändern.
8. Staged Validation laufen lassen.
9. Akzeptieren, verwerfen oder Diagnose aktualisieren.

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

## Diagnose-Menü

Wähle die Diagnose nach dem Leak. Nicht jeder Leak braucht alle Werkzeuge.

### Core-Struktur

```bash
deno task engine:batch
```

### Diagnose-Stabilität

```bash
deno task engine:batch:500
```

### Diagnose-Acceptance

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

Dann staged validieren:

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

### 4. Equity-Acceptance

Wenn der Kandidat equity-relevant ist oder die Summary ambivalent bleibt:

```bash
deno task engine:batch -- --runs=1000 --equity-preflop --equity-limit=3000
```

Bei kleinen, klar abgegrenzten Feintunings darf ein kleiner Zwischenbatch genutzt werden, aber ein Live-Kandidat braucht eine belastbare Acceptance.

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
- keine Verbesserung durch Trash-Calls, Spew oder Problemverschiebung entsteht,
- der Bot als Ganzes plausibler spielt.

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
- Equity-Ergebnis, falls genutzt
- Guardrail-Status
- Entscheidung: `accepted`, `rejected` oder `no-qualified-candidate`

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
