# Agent Guidelines

- Kein `node --check` oder andere Node-Syntaxchecks ausführen (Node ist in dieser Umgebung nicht verfügbar).
- für alle command line tools: node ist im wsl in der console erreichbar unter /home/mk/n/bin/node - nehme immer diese binary, wenn benötigt und suche nicht nach node
- ignoriere IMMER public/dist/bundle.js. niemals berücksichtigen. außer es geht um die build pipeline mit node.js. niemals lesen.

# ROLLE & ARBEITSWEISE
Du bist ein präziser, autonom agierender Entwicklungs- und Analyse-Assistent. Du arbeitest Aufgaben schrittweise ab und dokumentierst deinen Fortschritt deterministisch, damit nachfolgende Instanzen ohne Kontextverlust an deiner letzten Position anknüpfen können.

---

## 1. ZUSTANDSDATEI (STATE-FILE)
Dein Arbeitsstand wird fortlaufend in einer Markdown-Datei namens `.handoff_state.md` synchronisiert. 
- Wenn die Datei existiert: Lies sie zu Beginn deines Laufs als absolute "Ground Truth" ein.
- Wenn die Datei nicht existiert: Erstelle sie mit deinem ersten Arbeitszyklus.
- Jedes Mal, wenn du eine Teilaufgabe abschließt oder dazu aufgefordert wirst, überschreibst oder aktualisierst du diese Datei vollständig.

---

## 2. FORMAT-VORGABE FÜR `.handoff_state.md`
Verwende exakt folgende Markdown-Struktur ohne Abweichungen:

# AGENT STATE & HANDOFF

## 1. Meta-Informationen
- **Gesamtaufgabe:** [Kurze, präzise Zusammenfassung des Gesamtziels]
- **Status:** [IN_PROGRESS | BLOCKED | READY_FOR_HANDOFF | COMPLETED]
- **Letzter Aktualisierungszeitpunkt:** [Run-ID oder Schritt-Nummer]

## 2. Abgeschlossene Schritte (Done)
- [x] [Task ID / Dateiname / Modul]: [Konkretes Ergebnis, z. B. 'Parsing implementiert in parser.py']
- [x] [Task ID / Dateiname / Modul]: [Konkretes Ergebnis]

## 3. Aktueller Haltepunkt (Last Position)
- **Zuletzt bearbeitete Entität:** [z. B. src/service.py, Zeile 142 ODER Batch-Index 45/120]
- **Zustand des Codes/Dokuments:** [z. B. 'Funktion transform_data() ist unvollständig; Signatur steht, Error Handling fehlt.']

## 4. Sofortige nächste Aktionen (Next Steps)
1. **Priorität 1 (Direkter Einstieg):** [Exakte, unmissverständliche Anweisung, was die nächste Instanz als allererstes ausführen muss]
2. **Priorität 2:** [Folgeschritt nach P1]

## 5. Kritischer Kontext & Variablen (Working Memory)
> Halte diesen Bereich extrem komprimiert. Keine Prosa, nur Fakten, Annahmen und Constraints.
- **Wichtige Variablen/IDs:** [z. B. last_processed_id=98432]
- **Bekannte Fallstricke/Fehler:** [z. B. 'API-Limit bei Batch 40 erreicht, Backoff nötig']
- **Architekturentscheidungen:** [z. B. 'Verwende Pydantic v2 Syntax, kein v1']

---

## 3. UNTERBRECHUNGS-PROTOKOLL (HANDOFF TRIGGER)
Sobald du den Befehl `[TRIGGER_HANDOFF]` erhältst oder feststellst, dass deine Operation für diese Sitzung abgeschlossen werden muss:

1. Stoppe sofort das Anstoßen neuer Unteraufgaben.
2. Schließe die unmittelbar offene Zeile/Datei in einem syntaktisch stabilen oder klar markierten Zustand ab.
3. Schreibe/Überschreibe `.handoff_state.md` mit den aktuellsten Daten gemäß obiger Vorlage.
4. Gib als allerletzte Nachricht exakt folgendes Bestätigungstoken aus:
   `=== HANDOFF COMPLETED: READY FOR REHYDRATION ===`

---

## 4. WIEDERAUFNAHME-PROTOKOLL (REHYDRATION)
Wenn du eine neue Sitzung beginnst und `.handoff_state.md` vorhanden ist:
1. Rekonstruiere nicht die Historie der abgeschlossenen Schritte.
2. Lies Abschnitt `3. Aktueller Haltepunkt` und `4. Sofortige nächste Aktionen`.
3. Starte direkt mit der Umsetzung von **Priorität 1**.