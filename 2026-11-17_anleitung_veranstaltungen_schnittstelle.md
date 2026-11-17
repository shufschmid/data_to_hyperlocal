# Anleitung: die Veranstaltungs-Schnittstelle der Redaktion

Stand: 17. November 2026. Eigenständig — für diese Anbindung braucht es
keinen Zugriff auf unser Repository und keine Rückfrage bei uns.

## Worum es geht

Die Redaktion sammelt jeden Tag die Veranstaltungen der Gemeinden, über die
sie berichtet: aus den offiziellen Veranstaltungskalendern der Gemeinden,
aus den Terminen von Blutspende SRK und aus den Vorschauen der lokalen
Wochenblätter. Diese Schnittstelle gibt euch **alle kommenden Anlässe**, und
zwar **sobald sie gesammelt sind**: ohne Prüfung durch die Redaktion und ohne
auf eine Publikation zu warten.

Das unterscheidet sie von der Blog-API (`/api/v1/…`), über die der Dorfkönig
publizierte und geprüfte Beiträge liest. **Hier ist nichts geprüft.** Darum ist
die Tür mit einem Schlüssel geschützt, und darum gelten die Regeln unter
«Was ihr wissen müsst».

Was ein Anlass mitbringt: Titel, Gemeinde, Tag(e), Zeit, Ort, eine kurze
Zeile Text und **immer den Link zur Ursprungsquelle**.

## Adresse und Schlüssel

Basis: `https://redaktion-admin.apps.bajour.ch`

Jeder Aufruf des Inhaltspfads trägt den Schlüssel in einer eigenen Kopfzeile:

```
X-Veranstaltungen-Key: <der Schluessel>
```

**Nicht `Authorization: Bearer …`.** Diese Kopfzeile gehört unserem Backend
(Directus). Es prüft sie selbst, bevor unser Code läuft, und weist einen
fremden Schlüssel dort mit `401 INVALID_CREDENTIALS` ab. Der Schlüssel muss in
`X-Veranstaltungen-Key` stehen, sonst kommt er nie an.

Den Schlüssel bekommt ihr von uns. Er gehört in die Konfiguration eurer
Anwendung (eine Umgebungsvariable auf dem Server), nicht in Code, nicht in ein
Repository und **nie in den Browser**: Holt die Daten serverseitig ab und
liefert euren Besucherinnen nur, was ihr daraus macht.

## Die zwei Wege

### `GET /veranstaltungen/v1/gesundheit`

Ohne Schlüssel aufrufbar, liefert keine Inhalte. Sagt nur, ob die Tür
eingerichtet ist:

```json
{ "dienst": "veranstaltungen", "format": "redaktion-veranstaltungen/1", "status": "ok" }
```

`"status": "nicht_konfiguriert"` heisst: Bei uns fehlt der Schlüssel. Dann hilft
kein Wiederholen, sondern eine Nachricht an uns.

### `GET /veranstaltungen/v1/anlaesse`

Der Inhaltspfad. Ein Parameter, optional:

| Parameter  | Bedeutung                                           | Vorgabe |
| ---------- | --------------------------------------------------- | ------- |
| `gemeinde` | nur die Anlässe einer Gemeinde, als Kennung (s. u.) | alle    |

Die Gemeinde-Kennungen: `aesch`, `allschwil`, `arlesheim`, `binningen`,
`bottmingen`, `muenchenstein`, `muttenz`, `pratteln`, `reinach`, `riehen`.
Eine unbekannte Kennung wird mit 400 abgewiesen, nie still übergangen; die
Fehlermeldung nennt die gültigen.

```bash
curl -H "X-Veranstaltungen-Key: $VERANSTALTUNGEN_KEY" \
  "https://redaktion-admin.apps.bajour.ch/veranstaltungen/v1/anlaesse"
```

Es gibt kein Blättern: Jede Antwort ist der **ganze Stand**, alle Anlässe von
heute bis in 60 Tagen. Gemessen am 17. November 2026 waren das 369 Anlässe und
gut 300 KB.

Das Beispiel unten ist ein echter Eintrag vom 17. November 2026.

## Die Antwort

```json
{
  "format": "redaktion-veranstaltungen/1",
  "stand": "2026-11-17T15:02:11.000Z",
  "fenster": { "von": "2026-11-17", "bis": "2027-01-16" },
  "anzahl": 369,
  "zusammengefuehrt": 15,
  "hinweise": [
    "Kalender «Veranstaltungskalender der Gemeinde Riehen» nur teilweise gelesen: 2026-12-12: Seite antwortete mit 500. Anlässe dieser Tage bleiben im zuletzt gelesenen Stand."
  ],
  "anlaesse": [
    {
      "kennung": "kalender:e86e1f61-42ac-464b-a37c-144d9ca1b69b",
      "herkunft": "kalender",
      "gemeinde": { "name": "Bottmingen", "slug": "bottmingen", "bfs": 2767 },
      "titel": "Jassturnier",
      "termine": ["2026-11-22"],
      "von": "2026-11-22",
      "bis": null,
      "zeit": "20:00–22:00",
      "lokalitaet": "Burggartenkeller",
      "adresse": "Schlossgasse 11",
      "ort": "Bottmingen",
      "ort_ausserhalb": false,
      "veranstalter": "Verein Burggartenkeller",
      "art": "einmalig",
      "status": "findet_statt",
      "status_hinweis": null,
      "text": "Sonntag, 22. November 2026, 20:00–22:00, Burggartenkeller, Bottmingen.",
      "text_herkunft": "eckdaten",
      "quelle": {
        "art": "gemeinde",
        "name": "Veranstaltungskalender der Gemeinde Bottmingen",
        "url": "https://www.bottmingen.ch/de/veranstaltungen/detail/detail.php?i=12990"
      },
      "weitere_quellen": [
        {
          "art": "wochenblatt",
          "kennung": "wochenblatt:c45c2b12-5303-4f0b-b4d1-a73b53b3f967",
          "name": "BiBo (Birsigtal-Bote) Nr. 46",
          "titel": "Das Jassturnier kommt zurück in den Burggartenkeller!",
          "url": "https://files.localpoint.ch/pdf/bib/2026/2026-11-12-426cb467-229a-4394-9d7a-deb18b31d621.pdf#page=3"
        }
      ]
    }
  ]
}
```

### Der Kopf

| Feld               | Bedeutung                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`           | `redaktion-veranstaltungen/1`. Ändert sich nur bei einem Bruch; neue Felder sind kein Bruch                                                   |
| `stand`            | wann diese Antwort gebaut wurde                                                                                                               |
| `fenster`          | erster und letzter Tag, für den Anlässe geliefert werden (Schweizer Zeit)                                                                     |
| `anzahl`           | Länge von `anlaesse`                                                                                                                          |
| `zusammengefuehrt` | wie viele Einträge als `weitere_quellen` in einem anderen aufgegangen sind                                                                    |
| `hinweise`         | was beim Sammeln nicht ganz geklappt hat, in Sätzen: ein Kalender war nicht lesbar, ein Tag fehlte. Zum Anzeigen im Admin, nicht für Besucher |

### Ein Anlass, Feld für Feld

| Feld              | Bedeutung                                                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kennung`         | **stabil**, eindeutig, euer Schlüssel. Beginnt mit `kalender:` oder `wochenblatt:`                                                                                                                       |
| `herkunft`        | `kalender` (strukturiert, aus einem Kalender) oder `wochenblatt` (aus einer Vorschau in einer Zeitung, siehe unten)                                                                                      |
| `gemeinde`        | Name, Kennung (`slug`) und BFS-Nummer                                                                                                                                                                    |
| `titel`           | wie die Quelle ihn schreibt                                                                                                                                                                              |
| `termine`         | die kommenden Tage im Fenster, aufsteigend (`YYYY-MM-DD`). **Kann leer sein**: bei einer laufenden Ausstellung oder einer Serie, von der der Kalender nur Anfang und Ende nennt. Dann gelten `von`/`bis` |
| `von`, `bis`      | erster und letzter Tag, wie die Quelle sie nennt. `von` kann in der Vergangenheit liegen (eine Ausstellung läuft schon). `bis` ist `null` bei einem einzelnen Tag                                        |
| `zeit`            | Freitext wie `17:00` oder `11:50–13:00`, gilt für alle Termine; `null` wenn unbekannt                                                                                                                    |
| `lokalitaet`      | der Ort im Ort: «Gemeindesaal», «Burggartenkeller»                                                                                                                                                       |
| `adresse`, `ort`  | Strasse (selten gesetzt) und Ortschaft                                                                                                                                                                   |
| `ort_ausserhalb`  | `true`, wenn der Anlass zur Gemeinde gehört, aber anderswo stattfindet (der Binninger Suppentag in Bottmingen)                                                                                           |
| `veranstalter`    | wenn bekannt                                                                                                                                                                                             |
| `art`             | `einmalig`, `laufend` (Ausstellung, offen über eine Spanne), `woechentlich`, `monatlich`, `seltener`, `unbekannt`. Zum Filtern: Wer nur Besonderes zeigen will, lässt `woechentlich` weg                 |
| `status`          | `findet_statt`, `abgesagt` oder `verschoben`, wie die Quelle es sagt. **Zeigt eine Absage an**, statt den Eintrag still zu löschen                                                                       |
| `status_hinweis`  | der Grund in einem Satz, bei `abgesagt`/`verschoben`. Steht auch bei `findet_statt`, wenn einer Serie ein erwarteter Termin fehlt; das ist ein Hinweis, keine Absage                                     |
| `text`            | eine kurze Zeile für die Anzeige                                                                                                                                                                         |
| `text_herkunft`   | `eckdaten`: von unserem Code aus Tag, Zeit und Ort gebaut, nichts erfunden. `zusammenfassung_ki`: maschinelle Zusammenfassung des Zeitungsartikels (nur bei `herkunft: wochenblatt`). `null`: kein Text  |
| `quelle`          | woher der Anlass stammt: `art` (`gemeinde`, `organisation`, `plattform`, `ort`, `wochenblatt`), `name` und `url`. **Verlinkt diese URL** bei jedem Anlass                                                |
| `weitere_quellen` | dieselbe Veranstaltung aus einer anderen Quelle (siehe «Doubletten»), je mit `kennung`, `titel`, `name`, `url`                                                                                           |

### Einträge aus einem Wochenblatt

Erscheint ein Anlass nur in einer Zeitungsvorschau und in keinem Kalender, kommt
er mit `herkunft: "wochenblatt"`:

- `termine` hat genau einen Tag. Hat der Anlass mehrere, ist es der letzte.
- `zeit`, `lokalitaet`, `ort`, `veranstalter` sind `null`. Die Zeitung liefert
  sie nicht strukturiert; sie stehen, wenn überhaupt, in `text`.
- `text` ist eine maschinelle Zusammenfassung des Artikels.
- `quelle.url` führt direkt auf die Seite der Ausgabe (ein PDF mit `#page=N`
  oder ein Leser bei issuu).
- `art` ist `unbekannt`.

## So holt ihr ab

1. **Ruft regelmässig ab**: stündlich reicht. Neu kommt bei uns zweimal am
   Tag etwas hinzu: um 9 Uhr die Wochenblätter, um 13 Uhr die Kalender.
2. **Ersetzt euren Stand durch die Antwort.** Schreibt auf `kennung`:
   Neues anlegen, Bestehendes überschreiben, und **was in der Antwort fehlt,
   entfernen.** Es ist vorbei, vom Kalender gestrichen oder in einem anderen
   Eintrag aufgegangen.
3. **Bei einem Fehler behaltet ihr den alten Stand.** Kommt etwas anderes als
   200 zurück oder bricht die Verbindung ab, löscht nichts. Erst eine neue
   200-Antwort ersetzt den Stand.
4. **Eine Kennung kann in `weitere_quellen` wandern.** Hattet ihr gestern
   `wochenblatt:9a1e…` als eigenen Eintrag und taucht er heute in
   `weitere_quellen` eines Kalender-Anlasses auf, ist es derselbe Anlass. Wer
   eine eigene Seite pro Anlass hat, kann darauf umleiten.

## Doubletten

Steht derselbe Anlass im Kalender der Gemeinde **und** in einer
Zeitungsvorschau, liefern wir ihn **einmal**: den Eintrag aus dem Kalender, die
Zeitung als `weitere_quelle`. Dasselbe gilt zwischen zwei Kalendern. Vorrang
hat der Gemeindekalender, dann eine Organisation (Blutspende), dann eine
Plattform oder ein Veranstaltungsort, dann das Wochenblatt.

Als dieselbe Veranstaltung gilt, was in **derselben Gemeinde** an **einem
gemeinsamen Tag** stattfindet und **einen ähnlichen Titel** hat: mindestens zwei
gemeinsame bedeutungstragende Wörter, oder das einzige Wort des kürzeren
Titels. Weil Zeitungen eigene Titel setzen («Das Jassturnier kommt zurück»
statt «Jassturnier»), zählt beim Wochenblatt auch die Zusammenfassung.

Die Regel arbeitet ohne KI und ist **bewusst vorsichtig**: Was sie nicht
erkennt, kommt doppelt, jeder Eintrag mit seiner Quelle. Am 17. November 2026
hat sie 15 Paare zusammengeführt. Seht ihr eine Doublette, die durchrutscht,
sagt es uns mit beiden Kennungen.

## Fehler

Fehler kommen immer in dieser Form; `code` ist stabil, `meldung` kann sich
ändern:

```json
{
  "fehler": {
    "code": "nicht_berechtigt",
    "meldung": "Der Schluessel in X-Veranstaltungen-Key fehlt oder stimmt nicht."
  }
}
```

| Status | `code`               | Heisst                           | Zu tun                                         |
| ------ | -------------------- | -------------------------------- | ---------------------------------------------- |
| 200    | –                    | der ganze Stand                  | übernehmen                                     |
| 400    | `ungueltige_eingabe` | unbekannte Gemeinde              | Kennung prüfen, die Meldung nennt die gültigen |
| 401    | `nicht_berechtigt`   | Schlüssel fehlt oder falsch      | Kopfzeile und Konfiguration prüfen             |
| 404    | `nicht_gefunden`     | Weg gibt es nicht                | Adresse prüfen                                 |
| 500    | `interner_fehler`    | bei uns ging etwas schief        | alten Stand behalten, später erneut            |
| 503    | `nicht_konfiguriert` | die Tür ist bei uns abgeschaltet | alten Stand behalten, uns Bescheid geben       |

## Was ihr wissen müsst

1. **Nichts davon ist geprüft.** Ein Kalender kann sich irren, eine Zeitung
   kann ein Datum falsch drucken, eine Zusammenfassung kann danebenliegen.
   Schreibt auf eurer Seite sichtbar dazu, woher ein Anlass stammt, und
   **verlinkt immer `quelle.url`**: Dort steht die verbindliche Angabe.
2. **Zeigt den Status.** Ein abgesagter Anlass bleibt mit `status: abgesagt`
   in der Liste, bis sein Tag vorbei ist. Das ist für Besucher wertvoller als
   ein stilles Verschwinden.
3. **Eine Zusammenfassung ist kein Zitat.** Ein `text` mit `text_herkunft:
zusammenfassung_ki` ist maschinell aus einem Zeitungsartikel gemacht. Gebt
   ihn nicht als Text der Zeitung aus.
4. **Der Text der Quellen gehört den Quellen.** Wir liefern bewusst nur
   Eckdaten und eine Zeile. Beschreibungen, Bilder und Dokumente holt ihr
   nicht bei uns, sondern verlinkt sie.
5. **Haltet die Seite aus den Suchmaschinen heraus, wenn ihr die Rohdaten
   zeigt.** Unsere Antworten tragen `X-Robots-Tag: noindex`.

## Abnahme

```bash
BASIS=https://redaktion-admin.apps.bajour.ch

# 1. Die Tür ist eingerichtet
curl -s "$BASIS/veranstaltungen/v1/gesundheit"
# → {"dienst":"veranstaltungen","format":"redaktion-veranstaltungen/1","status":"ok"}

# 2. Ohne Schlüssel: 401
curl -s -o /dev/null -w "%{http_code}\n" "$BASIS/veranstaltungen/v1/anlaesse"

# 3. Mit Schlüssel: der Stand
curl -s -H "X-Veranstaltungen-Key: $VERANSTALTUNGEN_KEY" \
  "$BASIS/veranstaltungen/v1/anlaesse" | jq '{anzahl, zusammengefuehrt, hinweise}'

# 4. Eine Gemeinde
curl -s -H "X-Veranstaltungen-Key: $VERANSTALTUNGEN_KEY" \
  "$BASIS/veranstaltungen/v1/anlaesse?gemeinde=reinach" | jq '.anlaesse[0]'
```
