# Schnittstelle: die publizierten Beiträge

Vertrag für Abnehmer. Erster Abnehmer ist der **Dorfkönig 3.0**.

Konvention: **`wepublish-rest/1`**, Directus-Profil, Weg B (Endpunkt-Erweiterung
`api` im Bundle). Umsetzung: `apps/directus/extensions/app/src/endpoints/api/`.

Der Host ist der **Directus**-Host (`redaktion-admin…`), nicht der des Blogs
(`redaktion.apps.bajour.ch`). Das ist keine Feinheit: unter der Blog-Domain
läuft Next, und `/api/…` gehört dort dessen eigenen Routen — eine Anfrage
dorthin bekommt eine HTML-404-Seite und nie diese Schnittstelle.

## Adresse und Modus

|             |                                                     |
| ----------- | --------------------------------------------------- |
| **Adresse** | **`https://redaktion-admin.apps.bajour.ch/api/v1`** |
| Lokal       | `http://localhost:8055/api/v1`                      |
| Merkmal     | **keines** (offener Modus, R4a)                     |
| Schalter    | `BLOG_API_OFFEN=ja` in der Umgebung von Directus    |
| Methoden    | nur `GET` (R2); alles andere `405`                  |
| Kopfzeile   | jede Antwort trägt `X-Robots-Tag: noindex`          |

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
| `GET /api/v1/korrekturen`  | Beiträge, die zurückgezogen wurden            | ja      |
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
| `medium`        | string         | die Kennung des Hauses, das spricht (`bajour`); ohne Konfiguration `unbenannt`             |
| `pruefsiegel`   | object         | was geprüft wurde, wer unterschrieb, woher die Fakten kommen — siehe unten                 |

**Zum `text`:** Klartext mit einer Ausnahme — er kann **höchstens einen**
HTML-Anker der Form `<a href="https://…">…</a>` enthalten (nur bei
Statistik-Beiträgen, und die Adresse ist geprüft). Ausserdem können am Ende eine
Zeile `Quelle: …` und — bei Gemeindemitteilungen — Zeilen `Dokument: …` mit einer
nackten URL stehen. Wer HTML nicht will, entfernt
diesen einen Tag; die Adresse steht ohnehin in `quelle_url`.

**Nicht geliefert** wird `datengrundlage` — das Arbeitsmaterial der Redaktion
(bei einem Statistik-Beitrag bis zu sechzig Rohzeilen des Datensatzes). Ebenso
nichts Unfertiges: der Filter ist fest auf `status = publiziert` verdrahtet.

### Das Prüfsiegel

Jeder Beitrag trägt es. Es wird **gerechnet**, nicht gesetzt: jeder Bestandteil
liegt ohnehin in der Zeile, und ein gespeichertes Siegel wäre eine zweite Kopie,
die in dem Moment veraltet, in dem eine Überarbeitung den Text neu schreibt.

| Feld                   | Typ            | Bedeutung                                                                         |
| ---------------------- | -------------- | --------------------------------------------------------------------------------- |
| `pruefungen.zeitbezug` | string[]       | relative Zeitangaben, die im Text stehen geblieben sind                           |
| `pruefungen.zahlen`    | string[]       | Zahlen und Prozentangaben, die in den übergebenen Fakten nicht stehen             |
| `pruefungen.weitere`   | string[]       | alles andere: fehlende Quellenzeile, wörtliche Übernahme, Name einer Privatperson |
| `bestanden`            | boolean        | true, wenn keine der drei Listen etwas enthält                                    |
| `gegenpruefung`        | enum           | `ja`, `nein`, `unklar` — oder `keine`, wenn keine angefordert wurde               |
| `freigabe`             | enum           | `redaktion`, `freigegeben_dann_zeitlauf` oder `unbekannt`                         |
| `freigegeben_am`       | string \| null | ISO 8601 in UTC                                                                   |
| `publiziert_am`        | string \| null | ISO 8601 in UTC, dasselbe wie oben                                                |
| `herkunft`             | object         | `rubrik`, `quelle_name`, `quelle_url` — dieselbe Rechnung wie beim Beitrag        |

**Die Warnungen sind deutsche Prosa für die Redaktorin.** Sie gehen unverändert
hinaus. Ein Abnehmer **zeigt** sie; er parst sie nicht und liest keine Zahl aus
ihnen heraus. Ein Tisch, der eine neue Warnung erfindet, landet unter `weitere` —
sichtbar und unsortiert, nie stillschweigend verschwunden.

**Zu `freigabe`:** Beide Stufen sind eine Unterschrift. `redaktion` heisst, eine
Person am Tisch hat publiziert; `freigegeben_dann_zeitlauf` heisst, eine Person
hat freigegeben und der Zeitlauf hat später ausgespielt — so entsteht jede
Entsorgungserinnerung, die Wochen im Voraus freigegeben und am Vortag um zwölf
publiziert wird. `unbekannt` gilt für die Beiträge, die publiziert wurden, bevor
es diese Markierung gab (bis zum 15. September 2026), und ist ehrlicher als eine
erfundene Stufe.

Das Siegel trägt **keinen Text** des Beitrags und kein Arbeitsmaterial — nur
Warnungslisten, drei Zeitpunkte und die Herkunft, die der Beitrag ohnehin nennt.

## Korrekturen

`GET /api/v1/korrekturen` nennt die Beiträge, die publiziert **waren** und es
nicht mehr sind, neueste zuerst. Ohne diesen Weg erfährt ein Abnehmer, der einen
Beitrag am Morgen geholt und ausgespielt hat, nichts: der Beitrag verschwindet
aus `/artikel`, und `/artikel/{id}` antwortet `404` wie bei einer Kennung, die es
nie gab.

| Feld                | Typ            | Bedeutung                                                     |
| ------------------- | -------------- | ------------------------------------------------------------- |
| `id`                | uuid           | dieselbe Kennung, unter der der Beitrag geholt wurde          |
| `gemeinde`          | string \| null | Slug                                                          |
| `titel`             | string \| null | damit ein Mensch die Meldung wiedererkennt                    |
| `publiziert_am`     | string \| null | ISO 8601 in UTC                                               |
| `zurueckgezogen_am` | string         | ISO 8601 in UTC, Sortierschlüssel                             |
| `status`            | enum           | `entwurf` (zurück auf den Tisch) oder `verworfen` (verworfen) |
| `medium`            | string         | wie beim Beitrag                                              |

**Kein `text` und kein `lead`:** Was zurückgezogen ist, verlässt das Haus kein
zweites Mal, auch nicht als Beleg seiner selbst. Die Abfrage liest die Felder
gar nicht erst.

**`status` ist keine Nebensache.** `entwurf` heisst, der Beitrag liegt wieder
auf dem Tisch und kann überarbeitet zurückkommen — dann trägt er dieselbe `id`;
`verworfen` heisst, er kommt nicht wieder.

Parameter: `seit` (`JJJJ-MM-TT`, einschliesslich, ab 00:00 UTC, gemessen am
**Zeitpunkt des Rückzugs**), `grenze`, `versatz`. Listenform wie überall (R8),
der Sachname ist `korrekturen`. **Keinen Gemeindefilter** — wer einen Beitrag
ausgespielt hat, muss davon erfahren, worum auch immer es ging.

**Altbestand:** Rückzüge, die vor dem 15. September 2026 geschahen, tragen kein
`zurueckgezogen_am` und erscheinen hier nicht. Ein Datum dafür zu erfinden wäre
schlimmer als die Lücke.

### Rubrik und Quelle je Art

| `rubrik`      | Woher der Beitrag kommt                                    | `quelle_name`                        | `quelle_url`                                                                                           |
| ------------- | ---------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `statistik`   | Datensatz von data.bl.ch / statistik.bl.ch                 | „Statistisches Amt Basel-Landschaft" | der Webartikel des Amtes, sonst die Datensatzseite                                                     |
| `sport`       | Spielresultat eines Vereins                                | „Match-Center"                       | **null** — es gibt keine stabile Adresse für ein einzelnes Spiel (die Tagesseite des Verbands rotiert) |
| `entsorgung`  | Abfuhrkalender der Gemeinde                                | „Abfuhrkalender ‹Gemeinde› ‹Jahr›"   | die PDF-Adresse der Registrierung, sonst null                                                          |
| `amtsblatt`   | Amtsblattportal (kantonal / SHAB)                          | das publizierende Amt                | das amtliche PDF                                                                                       |
| `beschaffung` | öffentliche Beschaffung auf simap.ch                       | „simap.ch"                           | die Projektseite                                                                                       |
| `gemeinde`    | Mitteilung auf der offiziellen Website der Gemeinde        | „Gemeinde ‹Name›"                    | die Unterseite, auf der die Mitteilung steht                                                           |
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
A=https://redaktion-admin.apps.bajour.ch/api/v1
curl -s $A/gesundheit | python3 -m json.tool          # bereit: true, merkmal: "keines"
curl -s $A/gemeinden | python3 -m json.tool           # die gueltigen Kennungen
curl -s "$A/artikel?gemeinde=muenchenstein&seit=2026-08-01&grenze=5" | python3 -m json.tool
curl -s "$A/artikel?grenze=501"                       # 400 ungueltige_eingabe
curl -s $A/quatsch                                    # 404 im eigenen Umschlag, nie HTML
```

Gegen die Live-Instanz durchlaufen am 3. September 2026: 72 publizierte
Beiträge über 7 Gemeinden, alle Fehlerfälle in der erwarteten Form.

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

Ein Rückzug ist kein Feld, sondern ein eigener Weg: `/api/v1/korrekturen`.

_Angelegt am 3. September 2026. Rubrik `gemeinde` ergänzt am 14. September 2026.
Version 1.1.0 am 15. September 2026: `medium` und `pruefsiegel` je Beitrag, der
Weg `/korrekturen`. Neue Felder, kein Bruch — wer sie nicht liest, merkt nichts._
