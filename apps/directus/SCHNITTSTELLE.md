# Schnittstelle: die publizierten Beiträge

Vertrag für Abnehmer. Erster Abnehmer ist der **Dorfkönig 3.0**.

Konvention: **`wepublish-rest/1`**, Directus-Profil, Weg B (Endpunkt-Erweiterung
`api` im Bundle). Umsetzung: `apps/directus/extensions/app/src/endpoints/api/`.

## Adresse und Modus

|           |                                                                                 |
| --------- | ------------------------------------------------------------------------------- |
| Adresse   | `<DIRECTUS_PUBLIC_URL>/api/v1` — der **Directus**-Host, nicht der des Frontends |
| Lokal     | `http://localhost:8055/api/v1`                                                  |
| Merkmal   | **keines** (offener Modus, R4a)                                                 |
| Schalter  | `BLOG_API_OFFEN=ja` in der Umgebung von Directus                                |
| Methoden  | nur `GET` (R2); alles andere `405`                                              |
| Kopfzeile | jede Antwort trägt `X-Robots-Tag: noindex`                                      |

Warum ohne Schlüssel: Alles, was diese Schnittstelle liefert, steht ohnehin
öffentlich im Blog — ein Schlüssel schützte nichts. Der Schalter ist trotzdem
**ausdrücklich**: ohne ihn antworten die Inhaltspfade `503`
`schnittstelle_abgeschaltet`, und die Gesundheit sagt `bereit: false` mit
`offen: false`. Eine Schnittstelle, die ohne Absicht offen ist, ist es zu
unrecht.

**Abweichung von R4a, plattformbedingt:** Ein _ungültiges_ Bearer-Merkmal weist
**Directus selbst** mit `401` und in seiner eigenen Fehlerform ab, bevor diese
Erweiterung gefragt wird — dieselbe Pipeline, die jeden Endpunkt vorschaltet
(auch den bestehenden `/redaktion/blog`). Aus einer Erweiterung ist das nicht zu
heilen. Ein _gültiges_ Merkmal wird dagegen wirklich ignoriert: gemessen kommt
Byte für Byte dieselbe Antwort wie ohne. **Empfehlung für Abnehmer: keinen
`Authorization`-Kopf mitschicken.**

## Endpunkte

| Pfad                       | Zweck                                         | Bestand |
| -------------------------- | --------------------------------------------- | ------- |
| `GET /api/v1/gesundheit`   | Trägt der Dienst, ist die Schnittstelle offen | nein    |
| `GET /api/v1/beschreibung` | Jeder Endpunkt mit Zweck und Parametern       | nein    |
| `GET /api/v1/openapi.json` | Das maschinenlesbare Schema                   | nein    |
| `GET /api/v1/artikel`      | Die publizierten Beiträge, neueste zuerst     | ja      |
| `GET /api/v1/artikel/{id}` | Ein Beitrag, gleiche Form wie in der Liste    | ja      |
| `GET /api/v1/gemeinden`    | Die bespielten Gemeinden mit ihren Kennungen  | ja      |

Die drei ersten antworten auch bei abgeschalteter Schnittstelle — ein Wächter
muss sehen können, was fehlt.

### Parameter von `/artikel`

| Name       | Form         | Bedeutung                                                                               |
| ---------- | ------------ | --------------------------------------------------------------------------------------- |
| `gemeinde` | Slug         | z. B. `muenchenstein`. Unbekannt → `404`. Die gültigen Werte nennt `/api/v1/gemeinden`. |
| `seit`     | `JJJJ-MM-TT` | Nur ab diesem Tag publiziert. **Einschliesslich, ab 00:00 UTC.**                        |
| `grenze`   | 1 … 500      | Vorgabe 100.                                                                            |
| `versatz`  | ab 0         | Vorgabe 0.                                                                              |

Unbekannte Parameter werden ignoriert. Sortierung immer `publiziert_am`
absteigend.

### Listenform (R8)

```json
{ "anzahl": 3, "gesamt": 13, "versatz": 0, "grenze": 3, "weitere": true,
  "artikel": [ … ] }
```

Geblättert wird, bis `weitere` false ist (oder `versatz + anzahl >= gesamt`).
Hinter dem Ende bleibt `gesamt` stehen, `anzahl` ist 0 — daran erkennt ein
Abnehmer, dass er zu weit ist.

## Ein Beitrag

| Feld            | Typ            | Bedeutung                                                                                  |
| --------------- | -------------- | ------------------------------------------------------------------------------------------ |
| `id`            | uuid           | stabile Kennung                                                                            |
| `gemeinde`      | string         | Slug: Kleinbuchstaben, ASCII, Umlaute ausgeschrieben (`muenchenstein`)                     |
| `gemeinde_name` | string         | „Münchenstein"                                                                             |
| `bfs_nummer`    | number         | die amtliche Gemeindenummer — die eigentliche Identität                                    |
| `rubrik`        | enum \| null   | siehe unten                                                                                |
| `titel`         | string \| null |                                                                                            |
| `lead`          | string \| null | Anreisser, einzeln verwendbar                                                              |
| `text`          | string \| null | Fliesstext, Absätze durch **Leerzeile** getrennt                                           |
| `publiziert_am` | string         | ISO 8601 **in UTC**                                                                        |
| `erscheint_am`  | string \| null | `JJJJ-MM-TT`, nur bei Entsorgungserinnerungen: der Newsletter-Tag                          |
| `perle`         | boolean        | nur bei Presseschau je true: von der Chefredaktion als überregional interessant markiert   |
| `quelle_name`   | string \| null | Name der Direktquelle                                                                      |
| `quelle_url`    | string \| null | Adresse der Direktquelle, oder `null`                                                      |
| `sport`         | object \| null | nur bei `rubrik: "sport"`: `sportart, wettbewerb, heim, gast, tore_heim, tore_gast, datum` |

**Zum `text`:** Klartext mit einer Ausnahme — er kann **höchstens einen**
HTML-Anker der Form `<a href="https://…">…</a>` enthalten (nur bei
Statistik-Beiträgen, und die Adresse ist geprüft). Ausserdem kann am Ende eine
Zeile `Quelle: …` mit einer nackten URL stehen. Wer HTML nicht will, entfernt
diesen einen Tag; die Adresse steht ohnehin in `quelle_url`.

**Nicht geliefert** wird `datengrundlage` — das Arbeitsmaterial der Redaktion
(bei einem Statistik-Beitrag bis zu sechzig Rohzeilen des Datensatzes). Ebenso
nichts Unfertiges: der Filter ist fest auf `status = publiziert` verdrahtet.

### Rubrik und Quelle je Art

| `rubrik`      | Woher der Beitrag kommt                                    | `quelle_name`                        | `quelle_url`                                                                                           |
| ------------- | ---------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `statistik`   | Datensatz von data.bl.ch / statistik.bl.ch                 | „Statistisches Amt Basel-Landschaft" | der Webartikel des Amtes, sonst die Datensatzseite                                                     |
| `sport`       | Spielresultat eines Vereins                                | „Match-Center"                       | **null** — es gibt keine stabile Adresse für ein einzelnes Spiel (die Tagesseite des Verbands rotiert) |
| `entsorgung`  | Abfuhrkalender der Gemeinde                                | „Abfuhrkalender ‹Gemeinde› ‹Jahr›"   | die PDF-Adresse der Registrierung, sonst null                                                          |
| `amtsblatt`   | Amtsblattportal (kantonal / SHAB)                          | das publizierende Amt                | das amtliche PDF                                                                                       |
| `beschaffung` | öffentliche Beschaffung auf simap.ch                       | „simap.ch"                           | die Projektseite                                                                                       |
| `presseschau` | Wochenblatt-Beitrag                                        | der Name des Blattes                 | die Seite im PDF bzw. im issuu-Reader                                                                  |
| `sendung`     | Regionaljournal / punkt6                                   | der Sendungsname                     | Deeplink mit Zeitmarke (`#t=` bzw. `?t=`)                                                              |
| `null`        | kommt heute nicht vor — ehrlicher als eine geratene Rubrik | null                                 | null                                                                                                   |

`quelle_url: null` ist eine echte Antwort, keine Lücke: besser keine Adresse als
eine erfundene.

## Fehler

Jede Antwort ausser 2xx ist:

```json
{
  "fehler": {
    "code": "nicht_gefunden",
    "meldung": "Es gibt keinen publizierten Beitrag mit dieser Kennung."
  }
}
```

`code` ist stabiles ASCII zum Verzweigen, `meldung` ist deutsche Prosa und darf
sich ändern.

| Status | `code`                       | Wann                                                                                          |
| ------ | ---------------------------- | --------------------------------------------------------------------------------------------- |
| 400    | `ungueltige_eingabe`         | Parameter fehlt, unlesbar oder ausserhalb des Erlaubten                                       |
| 404    | `nicht_gefunden`             | unbekannter Pfad, unbekannte Gemeinde, unbekannte, unpublizierte oder krumme Beitrags-Kennung |
| 405    | `methode_nicht_erlaubt`      | alles ausser GET                                                                              |
| 500    | `interner_fehler`            | die Anwendung ist gestolpert; die Meldung nennt den Fehlertyp, nie einen Stacktrace           |
| 503    | `schnittstelle_abgeschaltet` | `BLOG_API_OFFEN` ist nicht gesetzt                                                            |

**Eine Ausnahme:** `/gesundheit` antwortet auch im Fehlerfall (503) mit ihrem
eigenen Körper statt mit diesem Umschlag — R3 verlangt denselben Körper, damit
ein Wächter die Einzelheiten sieht.

Nicht publiziert und nicht vorhanden geben dieselbe Antwort. Das ist hier keine
Verschleierung: was nicht publiziert ist, existiert für diese Schnittstelle
nicht.

## Abweichungen von der Konvention, mit Begründung

1. **Kein `QUERY_LIMIT_MAX`** (die Bauanleitung schlägt es vor). Die Werkstatt
   fragt ihre eigenen GraphQL-Dokumente mit `limit: -1` ab; ein globales
   Directus-Limit würde sie still kappen. Directus' eigene Tür `/items` ist ohne
   Token nicht erreichbar (die Public-Policy hat keine Rechte), und diese
   Schnittstelle erzwingt ihre `grenze` selbst.
2. **Ungültiges Merkmal → 401** statt ignoriert, siehe oben. Plattformverhalten.

## Abnahme

```bash
A=http://localhost:8055/api/v1
curl -s $A/gesundheit | python3 -m json.tool          # bereit: true, merkmal: "keines"
curl -s $A/gemeinden | python3 -m json.tool           # die gueltigen Kennungen
curl -s "$A/artikel?gemeinde=muenchenstein&seit=2026-08-01&grenze=5" | python3 -m json.tool
curl -s "$A/artikel?grenze=501"                       # 400 ungueltige_eingabe
curl -s $A/quatsch                                    # 404 im eigenen Umschlag, nie HTML
```

## Feldzuordnung für den Dorfkönig

Die Bauanleitung nennt Zielfelder; hier stehen unsere daneben. Pflicht für den
Dorfkönig sind `gemeinde`, `titel` und `text`.

| Ziel (Anleitung) | Bei uns                                                      |
| ---------------- | ------------------------------------------------------------ |
| `id`             | `id`                                                         |
| `gemeinde`       | `gemeinde` (Slug, fertig geliefert)                          |
| `gemeinde_name`  | `gemeinde_name`                                              |
| `datum`          | `publiziert_am` (bei Erinnerungen zusätzlich `erscheint_am`) |
| `titel`          | `titel`                                                      |
| `lead`           | `lead`                                                       |
| `text`           | `text` (Absätze durch Leerzeile; höchstens ein `<a>`)        |
| `quelle_name`    | `quelle_name`                                                |
| `quelle_url`     | `quelle_url`                                                 |
| `rubrik`         | `rubrik`                                                     |
| `publiziert_am`  | `publiziert_am`                                              |
| `kanonische_url` | — gibt es nicht: der Blog hat keine Einzelseiten je Beitrag  |
| `status`         | — nicht nötig: es kommt ausschliesslich Publiziertes         |

_Angelegt am 3. September 2026._
