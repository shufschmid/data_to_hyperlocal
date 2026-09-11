# Anleitung für Sokrates: die Regionaljournal-Schnittstelle

Stand: 11. September 2026. Eigenständig — für diese Anbindung braucht es
keinen Zugriff auf unser Repository und keine Rückfrage bei uns.

## Worum es geht

Sokrates formuliert die «Frage des Tages». Dafür braucht Sokrates die
aktuelle Sendung des SRF-Regionaljournals Basel/Baselland — **ungeprüft und
schnell**, nicht erst nachdem eine Redaktorin sie angeschaut hat.

Genau das liefert diese Schnittstelle. Sie ist bewusst eine **andere Tür** als
die Blog-API, über die der Dorfkönig die publizierten Beiträge liest: dort
steht nur, was die Redaktion freigegeben hat. Hier steht die Sendung selbst,
so wie sie aus dem Transkript kommt.

Was eine Sendung mitbringt:

- **Abschnitte** — die Sendung in ihre Beiträge zerlegt, jeder mit Titel,
  Text und Zeitmarke.
- **Das ganze Transkript** — Absatz für Absatz, mit Zeitmarken. Weil eine gute
  Frage an einer Stelle hängen kann, die kein Beitrag für sich beansprucht.
- Den Link auf die **Audiodatei** (MP3, öffentlich).

## Adresse und Schlüssel

Basis: `https://redaktion-admin.apps.bajour.ch`

Jeder Aufruf auf dem Inhaltspfad trägt den Schlüssel in einer eigenen
Kopfzeile:

```
X-Sokrates-Key: <der Schluessel>
```

**Nicht `Authorization: Bearer …`.** Diese Kopfzeile gehört unserem
Backend (Directus): es prüft sie selbst, bevor unser Code überhaupt läuft, und
weist einen fremden Schlüssel dort mit `401 INVALID_CREDENTIALS` ab. Der
Schlüssel muss also in `X-Sokrates-Key` stehen, sonst kommt er nie an.

Den Schlüssel bekommt Sokrates von uns. Er gehört in die Konfiguration auf
eurer Seite, nicht in Code und nicht in ein Repository.

## Die zwei Endpunkte

### `GET /sokrates/gesundheit`

Ohne Schlüssel aufrufbar, liefert keine Inhalte. Sagt nur, ob die Tür
konfiguriert ist:

```json
{ "dienst": "sokrates", "status": "ok" }
```

`"status": "nicht konfiguriert"` heisst: bei uns fehlt der Schlüssel. Dann
hilft kein Wiederholen, sondern ein Anruf.

### `GET /sokrates/sendungen`

Der Inhaltspfad. Parameter, beide optional:

| Parameter | Bedeutung                                        | Vorgabe |
| --------- | ------------------------------------------------ | ------- |
| `ab`      | nur Sendungen ab diesem Sendedatum, `JJJJ-MM-TT` | keine   |
| `limit`   | wie viele Sendungen, 1 bis 10                    | 3       |

Sortiert: neuste Sendung zuerst; bei gleichem Sendedatum die zuletzt
eingetroffene Ausgabe zuerst.

```bash
curl -H "X-Sokrates-Key: $SOKRATES_KEY" \
  "https://redaktion-admin.apps.bajour.ch/sokrates/sendungen?ab=2026-09-11&limit=3"
```

## Die Antwort

Gekürztes, echtes Beispiel:

```json
{
  "stand": "2026-09-11T11:59:15.491Z",
  "sendungen": [
    {
      "id": "82311aea-9adc-4991-b438-a4bdd18c08a2",
      "datum": "2026-09-09",
      "ausgabe": "Morgen",
      "titel": "Stimmrechtsalter 16 erneut im Basler Grossen Rat",
      "lead": "Der Basler Grosse Rat diskutiert erneut über die Frage, ob …",
      "audio_url": "https://download-media.srf.ch/world/audio/…mp3",
      "eingetroffen": "2026-09-11T01:03:32.884Z",
      "abschnitte": [
        {
          "titel": "Stimmrechtsalter 16 erneut im Basler Grossen Rat",
          "text": "Der Basler Grosse Rat diskutiert erneut …",
          "zeitmarke_sekunden": null,
          "nur_zusammenfassung": false
        },
        {
          "titel": "Zwei Demonstrationen in der Basler Innenstadt",
          "text": "Zwei Demonstrationen in der Basler Innenstadt …",
          "zeitmarke_sekunden": 312,
          "nur_zusammenfassung": true
        }
      ],
      "transkript": [
        { "zeitmarke": "00:00:00", "sekunden": 0, "text": "Das Regionaljournal …" },
        { "zeitmarke": "00:01:58", "sekunden": 118, "text": "Die 16- und 17-Jährigen …" }
      ]
    }
  ]
}
```

Feld für Feld:

| Feld           | Bedeutung                                                                        |
| -------------- | -------------------------------------------------------------------------------- |
| `id`           | stabil über die Lebensdauer der Sendung — der Schlüssel für «kenne ich schon?»   |
| `datum`        | Sendedatum, `JJJJ-MM-TT`                                                         |
| `ausgabe`      | `Morgen`, `Mittag`, `Abend` — oder `null`, solange nicht aufgelöst               |
| `titel`/`lead` | Titel und Anriss des Hauptbeitrags                                               |
| `audio_url`    | öffentliches MP3 bei SRF, `null` wenn die Auflösung scheiterte                   |
| `eingetroffen` | wann die Sendung bei uns entstand (UTC) — steigt bei einer Nachbearbeitung nicht |
| `abschnitte`   | die Sendung in Beiträgen, siehe unten                                            |
| `transkript`   | das ganze Skript, Absatz für Absatz                                              |

### Was die Abschnitte bedeuten

Eine Radiosendung hat eine Form, und die Abschnitte bilden sie ab:

- **Der erste Abschnitt ist der Hauptbeitrag** und enthält alles, was kein
  anderes Thema für sich beansprucht: den Anriss am Anfang («… und: temporäre
  Kunst in Bottmingen»), den eigentlichen Hauptbeitrag — und die Geschichten,
  die die Sendung nie unter «Ausserdem» aufgeführt hat. Erfahrungsgemäss steckt
  dort einiges vom Besten.
- **Jedes weitere Thema bekommt seine eigene Passage** aus dem Transkript, ab
  der Stelle, wo es wirklich behandelt wird — nicht ab der blossen Erwähnung im
  Anriss. Eine Gemeinde wird in einer Sendung typischerweise dreimal genannt
  (Anriss, Beitrag, Rückblick); der lange Abschnitt ist die Geschichte.
  Seine eigene Passage oder gar keine: fallen zwei Themen auf dieselbe Stelle,
  bekommt sie das erste, und das zweite ist als `nur_zusammenfassung`
  gekennzeichnet. Zwei Abschnitte tragen also nie denselben Text.
- `zeitmarke_sekunden` ist der Einstiegspunkt in Sekunden ab Sendungsbeginn —
  passend zur `audio_url`. `null` heisst: keine Stelle gefunden.
- **`nur_zusammenfassung: true` ist eine Warnung und muss beachtet werden.**
  Dann ist `text` NICHT der Wortlaut, sondern nur Titel plus die
  zwei, drei Sätze Kurzfassung der Sendung. Eine Frage, die sich auf Details
  stützt, darf sich nicht auf so einen Abschnitt stützen — das Transkript
  kann sie auch nicht ergänzen, die Passage war schlicht nicht auffindbar.

Wer den vollen Wortlaut will, nimmt `transkript`: das ist immer die ganze
Sendung, ungekürzt, unabhängig von der Zerlegung in Abschnitte.

## Zeitplan — was wann bereit ist

- **~14.32 Uhr** trifft das Transkript per Mail bei uns ein.
- **14.35 Uhr** holt und verarbeitet unser Lauf es automatisch. Publiziert wird
  dabei nichts; es entsteht die Sendung, die diese Schnittstelle ausliefert.
- **14.42 und 14.49 Uhr** laufen Wiederholungen, falls das Mail später kam.
  Sie kosten nichts und legen nichts doppelt an.
- Abends um 20.30 läuft derselbe Lauf nochmals für alles, was tagsüber liegen
  blieb.

**Empfohlenes Vorgehen:** ab 14.36 Uhr `?ab=<heute>` abfragen, im Minutentakt,
bis eine `id` auftaucht, die Sokrates noch nicht kennt — längstens bis etwa
15.00 Uhr. Danach reicht ein Aufruf pro Stunde. Ein Abruf ist billig, aber
bitte kein Dauerfeuer im Sekundentakt.

Wenn bis 15.00 Uhr nichts Neues kommt, ist mit hoher Wahrscheinlichkeit das
Mail ausgeblieben — das ist ein Fall für einen Anruf bei uns, nicht für
schnelleres Nachfragen.

## Fehler

| Code  | Heisst                                                              | Zu tun                                                |
| ----- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| `200` | alles gut                                                           | —                                                     |
| `400` | Parameter falsch (Datum kein `JJJJ-MM-TT`, `limit` ausserhalb 1–10) | Aufruf korrigieren; das Feld `fehler` nennt den Grund |
| `401` | Schlüssel fehlt oder ist falsch                                     | Konfiguration prüfen — nicht wiederholen              |
| `404` | Route unbekannt                                                     | Adresse prüfen                                        |
| `500` | bei uns ging etwas schief                                           | später erneut versuchen                               |
| `503` | bei uns ist kein Schlüssel gesetzt                                  | bei uns melden — Wiederholen hilft nicht              |

Fehler antworten als `{"fehler": "…"}` (Klartext auf Deutsch), ausser dem
`404`, der von unserem Backend selbst kommt.

## Drei Dinge, die Sokrates wissen muss

1. **Der Inhalt ist ungeprüft.** Niemand aus der Redaktion hat die Sendung
   angeschaut, bevor sie hier steht. Das ist der ganze Zweck — Sokrates
   bekommt sie deshalb Stunden früher als jede Meldung. Umgekehrt heisst es:
   nichts davon ist redigiert, geprüft oder freigegeben. Es ist
   Arbeitsmaterial für eine Frage, keine Publikationsvorlage.
2. **Das Transkript ist maschinell erzeugt.** Namen, Ortsbezeichnungen und
   Zahlen können falsch geschrieben oder verhört sein. Eine Frage, die auf
   einer exakten Zahl oder einem Eigennamen steht, gehört gegen eine zweite
   Quelle geprüft — oder anders gestellt.
3. **Der Text gehört SRF.** Er ist Arbeitsgrundlage, keine Publikation.
   Wörtliches Zitieren ohne Quellenangabe geht nicht; eine daraus formulierte
   Frage in eigenen Worten sehr wohl.

Eine Sendung kann nachträglich noch einmal verarbeitet werden (wenn etwa die
Audio-Auflösung erst später gelingt). Die `id` bleibt dabei dieselbe, der
Inhalt kann sich ergänzen. Wer eine Sendung zwischenspeichert, darf sie also
später ruhig noch einmal lesen — sie wird nicht zu einer zweiten.

## Was diese Schnittstelle nicht liefert

- **Keine punkt6-Sendungen.** Nur das Regionaljournal Basel/Baselland.
- **Keine Meldungen und keine Artikel.** Die stehen, sobald publiziert, in der
  Blog-API unter `/api/v1/…` — eine andere Tür mit einem anderen Vertrag
  (`apps/directus/SCHNITTSTELLE.md`).
- **Kein Schreiben.** Die Schnittstelle ist ausschliesslich lesend; Sokrates
  kann bei uns nichts anlegen, ändern oder auslösen.
