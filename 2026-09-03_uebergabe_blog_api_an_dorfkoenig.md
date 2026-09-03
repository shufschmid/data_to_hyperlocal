# Übergabe: die Blog-API der Redaktion (Bajour) an den Dorfkönig 3.0

Stand: 3. September 2026, live geprüft. Eigenständig — für diese Anbindung
braucht es keinen Zugriff auf unser Repository und keine Rückfrage bei uns.

Gebaut nach der Konvention **`wepublish-rest/1`**, Weg B (Endpunkt-Erweiterung
in Directus). Der Dorfkönig liest diese Form bereits; ein eigener Leser für die
Directus-Form ist **nicht** nötig.

---

## 1. Die Adresse

```
https://redaktion-admin.apps.bajour.ch/api/v1
```

**Kein Schlüssel.** Offener Modus nach R4a: alles, was hier herauskommt, steht
ohnehin öffentlich im Blog. Bitte **keinen `Authorization`-Kopf mitschicken** —
ein gültiges Merkmal würde ignoriert, ein ungültiges weist Directus selbst mit
`401` und in seiner eigenen Fehlerform ab, bevor diese Schnittstelle gefragt
wird. Das ist Plattformverhalten und aus einer Erweiterung nicht zu heilen.

> **Nicht verwechseln:** Der Host ist der **Directus**-Host
> (`redaktion-admin…`), nicht der des Blogs (`redaktion.apps.bajour.ch`). Unter
> der Blog-Domain läuft Next, dort gehört `/api/…` dessen eigenen Routen — eine
> Anfrage dorthin bekommt eine HTML-404-Seite und nie diese Schnittstelle.

Jede Antwort trägt `X-Robots-Tag: noindex`. Nur `GET`; alles andere `405`.

---

## 2. Die sechs Wege

| Pfad                       | Zweck                                         |
| -------------------------- | --------------------------------------------- |
| `GET /api/v1/gesundheit`   | Trägt der Dienst, ist die Schnittstelle offen |
| `GET /api/v1/beschreibung` | Jeder Endpunkt mit Zweck und Parametern       |
| `GET /api/v1/openapi.json` | Das maschinenlesbare Schema (OpenAPI 3.0.3)   |
| `GET /api/v1/artikel`      | Die publizierten Beiträge, neueste zuerst     |
| `GET /api/v1/artikel/{id}` | Ein Beitrag, gleiche Form wie in der Liste    |
| `GET /api/v1/gemeinden`    | Die bespielten Gemeinden mit ihren Kennungen  |

Die ersten drei antworten auch dann, wenn die Schnittstelle abgeschaltet ist —
ein Wächter muss sehen können, was fehlt. Sie liefern nie Bestand.

### Gesundheit

```json
{
  "dienst": "redaktion",
  "version": "1.0.0",
  "api": "v1",
  "konvention": "wepublish-rest/1",
  "zeit": "2026-09-03T11:17:27.164Z",
  "bereit": true,
  "merkmal": "keines",
  "datenbank": true,
  "offen": true
}
```

`bereit: false` heisst: nicht ausliefernd. Die zwei Einzelbools sagen, welcher
der beiden Gründe es ist — `datenbank: false` (kaputt) oder `offen: false`
(bewusst abgeschaltet, dann antworten die Inhaltspfade `503`).

### Parameter von `/artikel`

| Name       | Form         | Bedeutung                                                        |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `gemeinde` | Slug         | z. B. `muenchenstein`. Unbekannt → `404`.                        |
| `seit`     | `JJJJ-MM-TT` | Nur ab diesem Tag publiziert. **Einschliesslich, ab 00:00 UTC.** |
| `grenze`   | 1 … 500      | Vorgabe 100.                                                     |
| `versatz`  | ab 0         | Vorgabe 0.                                                       |

Unbekannte Parameter werden ignoriert. Sortierung immer `publiziert_am`
absteigend.

### Die Gemeinde-Kennungen

`GET /api/v1/gemeinden` nennt sie — heute sieben:

```
aesch · arlesheim · binningen · bottmingen · muenchenstein · pratteln · riehen
```

Das Redaktionsgebiet wächst; **die Liste abfragen, nicht hartkodieren.** Der
Slug ist kleingeschrieben, ASCII, Umlaute ausgeschrieben (`Münchenstein` →
`muenchenstein`). Jeder Beitrag trägt zusätzlich `bfs_nummer` — die amtliche
Gemeindenummer und die eigentliche Identität, falls ihr stabil verknüpfen wollt.

---

## 3. Blättern

Eine Liste antwortet immer so:

```json
{ "anzahl": 1, "gesamt": 10, "versatz": 0, "grenze": 1, "weitere": true,
  "artikel": [ … ] }
```

Blättern, bis `weitere` false ist (gleichbedeutend mit
`versatz + anzahl >= gesamt`). Hinter dem Ende ist `anzahl: 0`, `weitere: false`,
und `gesamt` bleibt stehen — daran merkt man, dass man zu weit ist.

---

## 4. Ein Beitrag, Feld für Feld

| Feld            | Typ            | Bedeutung                                                                                  |
| --------------- | -------------- | ------------------------------------------------------------------------------------------ |
| `id`            | uuid           | stabile Kennung                                                                            |
| `gemeinde`      | string         | der Slug                                                                                   |
| `gemeinde_name` | string         | „Münchenstein"                                                                             |
| `bfs_nummer`    | number         | amtliche Gemeindenummer                                                                    |
| `rubrik`        | enum \| null   | woher der Beitrag kommt, siehe unten                                                       |
| `titel`         | string \| null |                                                                                            |
| `lead`          | string \| null | Anreisser, einzeln verwendbar                                                              |
| `text`          | string \| null | Fliesstext, Absätze durch **Leerzeile** getrennt                                           |
| `publiziert_am` | string         | ISO 8601 **in UTC**                                                                        |
| `erscheint_am`  | string \| null | `JJJJ-MM-TT` — nur bei Entsorgungserinnerungen: der Newsletter-Tag, auf den sie gehört     |
| `perle`         | boolean        | nur bei `presseschau` je true: von der Chefredaktion als überregional interessant markiert |
| `quelle_name`   | string \| null | Name der Direktquelle                                                                      |
| `quelle_url`    | string \| null | Adresse der Direktquelle, oder `null`                                                      |
| `sport`         | object \| null | nur bei `rubrik: "sport"`                                                                  |

**Pflichtfelder für euch** (`gemeinde`, `titel`, `text`) sind immer gefüllt.

**Zum `text`:** Klartext mit einer Ausnahme — er kann **höchstens einen**
HTML-Anker der Form `<a href="https://…">…</a>` enthalten (nur bei
Statistik-Beiträgen; die Adresse ist geprüft). Ausserdem kann am Ende eine Zeile
`Quelle: …` mit einer nackten URL stehen. Wer kein HTML will, entfernt diesen
einen Tag — die Adresse steht ohnehin in `quelle_url`.

**Was nicht kommt:** nichts Unfertiges (der Filter ist fest auf „publiziert"
verdrahtet, Entwürfe verlassen das Haus nie) und keine Arbeitsmaterialien. Es
gibt auch **kein `kanonische_url`**: der Blog hat keine Einzelseite je Beitrag.

### Die Rubriken und ihre Quellen

Heute im Bestand (72 Beiträge): presseschau 32 · sport 16 · statistik 12 ·
sendung 7 · entsorgung 4 · amtsblatt 1.

| `rubrik`      | Woher                                      | `quelle_name`                        | `quelle_url`                             |
| ------------- | ------------------------------------------ | ------------------------------------ | ---------------------------------------- |
| `statistik`   | Datensatz des Kantons                      | „Statistisches Amt Basel-Landschaft" | Webartikel des Amtes oder Datensatzseite |
| `sport`       | Spielresultat eines Vereins                | „Match-Center"                       | **`null`**                               |
| `entsorgung`  | Abfuhrkalender der Gemeinde                | „Abfuhrkalender ‹Gemeinde› ‹Jahr›"   | PDF der Gemeinde, sonst `null`           |
| `amtsblatt`   | Amtsblattportal (kantonal/SHAB)            | das publizierende Amt                | amtliches PDF                            |
| `beschaffung` | öffentliche Beschaffung auf simap.ch       | „simap.ch"                           | Projektseite                             |
| `presseschau` | Beitrag eines Wochenblatts                 | Name des Blattes                     | Seite im PDF bzw. issuu-Reader           |
| `sendung`     | Regionaljournal (SRF) / punkt6 (Telebasel) | Sendungsname                         | Deeplink mit Zeitmarke                   |

`quelle_url: null` ist eine **echte Antwort**, keine Lücke: Für ein einzelnes
Fussballspiel gibt es keine stabile öffentliche Adresse (die Tagesseite des
Verbands rotiert), und ein als Datei hinterlegter Abfuhrkalender hat keine.
Besser keine Adresse als eine erfundene.

---

## 5. Zwei echte Antworten

`GET /api/v1/artikel?gemeinde=muenchenstein&grenze=1`

```json
{
  "anzahl": 1,
  "gesamt": 10,
  "versatz": 0,
  "grenze": 1,
  "weitere": true,
  "artikel": [
    {
      "id": "550f8b5e-919e-42cf-aa3c-f4dd31b1d3f7",
      "gemeinde": "muenchenstein",
      "gemeinde_name": "Münchenstein",
      "bfs_nummer": 2769,
      "rubrik": "sendung",
      "titel": "Münchenstein erhält Tempo 30 auf Teil der Hauptstrasse",
      "lead": "Der Kanton Baselland hat einem Antrag der Gemeinde Münchenstein für Tempo 30 auf der Hauptstrasse teilweise zugestimmt.",
      "text": "Wie Telebasel in der Sendung punkt6 berichtete, bewilligte der Kanton Baselland den Antrag von Münchenstein, auf der Kantonsstrasse Tempo 30 einzuführ …",
      "publiziert_am": "2026-09-03T09:51:06.447Z",
      "erscheint_am": null,
      "perle": false,
      "quelle_name": "punkt6",
      "quelle_url": "https://telebasel.ch/sendungen/punkt6/239600?t=277",
      "sport": null
    }
  ]
}
```

Ein Spielbericht, die einzige Rubrik mit Unterobjekt:

```json
{
  "id": "df507eb4-13df-4170-b588-cecaaebd8821",
  "gemeinde": "aesch",
  "gemeinde_name": "Aesch",
  "bfs_nummer": 2761,
  "rubrik": "sport",
  "titel": "FC Aesch unterliegt FC Srbija 1968 deutlich mit 0:4",
  "lead": "Die 3.-Liga-Mannschaft des FC Aesch hat am 30. August 2026 im Löhrenacker gegen den FC Srbija 1968 mit 0:4 verloren.",
  "text": "Der FC Aesch trat in der Meisterschaft der 3. Liga, Gruppe 2, im heimischen Löhrenacker ge …",
  "publiziert_am": "2026-08-31T12:32:46.563Z",
  "erscheint_am": null,
  "perle": false,
  "quelle_name": "Match-Center",
  "quelle_url": null,
  "sport": {
    "sportart": "Fussball",
    "wettbewerb": "Meisterschaft - 3. Liga / Gruppe 2",
    "heim": "FC Aesch",
    "gast": "FC Srbija 1968",
    "tore_heim": 0,
    "tore_gast": 4,
    "datum": "2026-08-30T11:00:00.000Z"
  }
}
```

---

## 6. Fehler

Jede Antwort ausser 2xx trägt genau diesen Umschlag:

```json
{
  "fehler": { "code": "nicht_gefunden", "meldung": "Es gibt keinen publizierten Beitrag mit dieser Kennung." }
}
```

`code` ist stabiles ASCII zum Verzweigen, `meldung` ist deutsche Prosa und darf
sich ändern.

| Status | `code`                       | Wann                                                                                  |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------- |
| 400    | `ungueltige_eingabe`         | Parameter unlesbar oder ausserhalb des Erlaubten                                      |
| 404    | `nicht_gefunden`             | unbekannter Pfad, unbekannte Gemeinde, unbekannte oder unpublizierte Beitrags-Kennung |
| 405    | `methode_nicht_erlaubt`      | alles ausser GET                                                                      |
| 500    | `interner_fehler`            | die Anwendung ist gestolpert (nennt den Fehlertyp, nie einen Stacktrace)              |
| 503    | `schnittstelle_abgeschaltet` | die Schnittstelle ist bewusst zu                                                      |

**Zwei Eigenheiten, die eine Anbindung wissen muss:**

1. **`/gesundheit` ist die Ausnahme:** Sie antwortet auch im Fehlerfall (503)
   mit ihrem eigenen Körper statt mit diesem Umschlag — sonst könnte ein Wächter
   nicht sehen, was fehlt.
2. **Nicht publiziert und nicht vorhanden geben dieselbe Antwort** (`404`). Was
   nicht publiziert ist, existiert für diese Schnittstelle nicht.

---

## 7. Was auf eurer Seite zu tun ist

Von den drei Punkten der Anbindungs-Anleitung entfallen zwei Drittel, weil diese
Schnittstelle die Konventions-Form liefert:

1. **Mehrere Quellen** — ihr liest heute genau eine.
2. **Eine Quelle ohne Schlüssel** — diese hier braucht keinen.
3. ~~Ein Leser für die Directus-Form mit Feldabbildung~~ — **nicht nötig.**
   `gemeinde` (Slug), `rubrik` und `quelle_name`/`quelle_url` kommen fertig
   gerechnet; nichts ist abzuleiten und nichts aus Texten zu parsen.

Empfohlener Abholrhythmus: wie geplant zweimal täglich je Gemeinde mit einem
Fenster von drei Tagen, blättern bis `weitere: false`. Bei ~70 Beiträgen im
Gesamtbestand und einer Vorgabegrenze von 100 ist das eine Anfrage je Gemeinde
und Lauf.

### Feldzuordnung auf euer Ziel

| Ziel (Anbindungs-Anleitung) | Bei uns                                                               |
| --------------------------- | --------------------------------------------------------------------- |
| `id`                        | `id`                                                                  |
| `gemeinde`                  | `gemeinde` (Slug, fertig)                                             |
| `gemeinde_name`             | `gemeinde_name`                                                       |
| `datum`                     | `publiziert_am` (bei Erinnerungen zusätzlich `erscheint_am` beachten) |
| `titel`                     | `titel`                                                               |
| `lead`                      | `lead`                                                                |
| `text`                      | `text`                                                                |
| `quelle_name`               | `quelle_name`                                                         |
| `quelle_url`                | `quelle_url`                                                          |
| `rubrik`                    | `rubrik`                                                              |
| `publiziert_am`             | `publiziert_am`                                                       |
| `kanonische_url`            | — existiert nicht (kein Einzelseiten-Blog)                            |
| `status`                    | — nicht nötig (es kommt nur Publiziertes)                             |

---

## 8. Abnahme

```bash
A=https://redaktion-admin.apps.bajour.ch/api/v1
curl -s $A/gesundheit  | python3 -m json.tool     # bereit: true, merkmal: "keines"
curl -s $A/gemeinden   | python3 -m json.tool     # die gueltigen Kennungen
curl -s "$A/artikel?gemeinde=muenchenstein&seit=2026-08-01&grenze=5" | python3 -m json.tool
curl -s "$A/artikel?grenze=501"                   # 400 ungueltige_eingabe
curl -s $A/quatsch                                # 404 im eigenen Umschlag, nie HTML
```

Am 3. September 2026 gegen die Live-Instanz durchlaufen: 72 publizierte Beiträge
über 7 Gemeinden, alle sechs Rubriken vertreten, alle Fehlerfälle in der
erwarteten Form.

---

## 9. Wenn etwas nicht stimmt

- **Alles antwortet `503 schnittstelle_abgeschaltet`:** Die Schnittstelle ist
  abgeschaltet (`BLOG_API_OFFEN` in der Directus-Umgebung). `/gesundheit` sagt
  `offen: false`. → bei uns melden.
- **`404` auf jedem Pfad, auch `/gesundheit`:** Der Container ist nicht
  erreichbar (Deploy läuft) — es antwortet der Reverse-Proxy, nicht Directus.
  Nach ein paar Minuten erneut versuchen.
- **HTML statt JSON:** Ihr fragt die Blog-Domain statt des Directus-Hosts, siehe
  Abschnitt 1.
- **`401 INVALID_CREDENTIALS`:** Ein `Authorization`-Kopf ist mitgeschickt
  worden. Weglassen.

Der Vertrag wird bei uns unter `apps/directus/SCHNITTSTELLE.md` gepflegt und ist
mit diesem Dokument inhaltsgleich. Eine formbrechende Änderung würde `/api/v2/`
und `wepublish-rest/2` bekommen; neue Felder in einer Antwort sind kein Bruch.
