# Schnittstelle: die publizierten Beiträge

Vertrag für Abnehmer. Erster Abnehmer ist der **Dorfkönig 3.0**.

Konvention: **`wepublish-rest/1`**, Directus-Profil, Weg B (Endpunkt-Erweiterung
`api` im Bundle). Umsetzung: `apps/directus/extensions/app/src/endpoints/api/`.

Der Host ist der **Directus**-Host (`redaktion-admin…`), nicht der des Blogs
(`redaktion.apps.bajour.ch`). Das ist keine Feinheit: unter der Blog-Domain
läuft Next, und `/api/…` gehört dort dessen eigenen Routen — eine Anfrage
dorthin bekommt eine HTML-404-Seite und nie diese Schnittstelle.

## Adresse und Modus

|             |                                                                                        |
| ----------- | -------------------------------------------------------------------------------------- |
| **Adresse** | **`https://redaktion-admin.apps.bajour.ch/api/v1`**                                    |
| Lokal       | `http://localhost:8055/api/v1`                                                         |
| Merkmal     | **keines** (offener Modus, R4a)                                                        |
| Schalter    | `BLOG_API_OFFEN=ja` in der Umgebung von Directus                                       |
| Methoden    | `GET` (R2); dazu EIN `POST`, die Bestätigung des Abnehmers (1.5.0); alles andere `405` |
| Kopfzeile   | jede Antwort trägt `X-Robots-Tag: noindex`                                             |

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

| Pfad                                       | Zweck                                                                        | Bestand |
| ------------------------------------------ | ---------------------------------------------------------------------------- | ------- |
| `GET /api/v1/gesundheit`                   | Trägt der Dienst, ist die Schnittstelle offen                                | nein    |
| `GET /api/v1/beschreibung`                 | Jeder Endpunkt mit Zweck und Parametern                                      | nein    |
| `GET /api/v1/openapi.json`                 | Das maschinenlesbare Schema                                                  | nein    |
| `GET /api/v1/artikel`                      | Die publizierten Beiträge, neueste zuerst                                    | ja      |
| `GET /api/v1/artikel/{id}`                 | Ein Beitrag, gleiche Form wie in der Liste                                   | ja      |
| `GET /api/v1/korrekturen`                  | Beiträge, die zurückgezogen wurden                                           | ja      |
| `GET /api/v1/bilanz`                       | Wie viel auf welchem Tisch liegt, in Zahlen                                  | ja      |
| `GET /api/v1/gemeinden`                    | Die bespielten Gemeinden mit ihren Kennungen                                 | ja      |
| `GET /api/v1/abnehmer/{kennung}`           | Wo ein Abnehmer steht: sein Stand, wann bestätigt, wie viel offen (1.5.0)    | ja      |
| `POST /api/v1/abnehmer/{kennung}/abgeholt` | Der Abnehmer bestätigt, bis wohin er gespeichert hat — mit Schlüssel (1.5.0) | ja      |

Die drei ersten antworten auch bei abgeschalteter Schnittstelle — ein Wächter
muss sehen können, was fehlt.

### Parameter von `/artikel`

| Name       | Form         | Bedeutung                                                                                                       |
| ---------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `gemeinde` | Slug         | z. B. `muenchenstein`. Unbekannt → `404`. Die gültigen Werte nennt `/api/v1/gemeinden`.                         |
| `seit`     | `JJJJ-MM-TT` | Nur ab diesem Tag publiziert. **Einschliesslich, ab 00:00 UTC.** Mit `abnehmer` nur vor der ersten Bestätigung. |
| `abnehmer` | Kennung      | z. B. `dorfkoenig`. Nur Beiträge hinter dem bestätigten Stand, älteste zuerst — siehe „Abholen ohne Doppel".    |
| `grenze`   | 1 … 500      | Vorgabe 100.                                                                                                    |
| `versatz`  | ab 0         | Vorgabe 0. Mit `abnehmer` nicht erlaubt.                                                                        |

Unbekannte Parameter werden ignoriert. Sortierung `publiziert_am` absteigend,
bei gleichem Zeitpunkt `id` absteigend — mit `abnehmer` beides aufsteigend.

### Listenform (R8)

```json
{ "anzahl": 3, "gesamt": 13, "versatz": 0, "grenze": 3, "weitere": true,
  "artikel": [ … ] }
```

Geblättert wird, bis `weitere` false ist (oder `versatz + anzahl >= gesamt`).
Hinter dem Ende bleibt `gesamt` stehen, `anzahl` ist 0 — daran erkennt ein
Abnehmer, dass er zu weit ist. Mit `abnehmer` trägt der Umschlag zusätzlich
einen Block `abholung` (unten).

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
| `termin`        | object \| null | wann der Beitrag zählt und an welchen Tagen er ins Briefing soll — siehe unten (1.4.0)     |
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

### Termin und Auftritte (seit 1.4.0)

Ein optionales Objekt je Beitrag, nach dem Vorschlag des Dorfkönigs vom 21. September 2026. Fehlt es oder ist es `null`, verhält sich alles wie bisher:
der Dorfkönig liest das Datum aus dem Text und bringt den Beitrag einmal, am
Werktag vor dem Termin.

```json
"termin": {
  "ideal": "2026-10-17",
  "ende": "2026-10-17",
  "auftritte": ["2026-09-25", "2026-10-17"]
}
```

| Feld        | Pflicht           | Typ             | Bedeutung                                                                                                                                                                       |
| ----------- | ----------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ideal`     | ja, wenn `termin` | `JJJJ-MM-TT`    | der ideale Tag: der Anmeldeschluss, der erste Tag der Durchführung, der Tag der Sperrung                                                                                        |
| `ende`      | ja                | `JJJJ-MM-TT`    | der letzte Tag, an dem der Beitrag noch Sinn hat; nie vor `ideal`. Wir liefern ihn immer — ohne eigenes Ende ist er gleich `ideal`                                              |
| `auftritte` | nein              | Liste von Tagen | die Lesetage im Briefing, höchstens fünf, jeder auf oder vor `ende`, sortiert, ohne Doppelte. **Fehlt die Liste, gilt die Standardregel** (ein Auftritt am Werktag vor `ideal`) |

Alle Tage sind Kalendertage in der Schweiz, ohne Uhrzeit und ohne Zone.

**Was die Redaktion damit sagt.** Der Termin wird für Beiträge der Rubriken
`gemeinde` und `veranstaltung` vorgeschlagen und von der Redaktion gesetzt; er
erscheint nie im Text. Bei einem Anlass kommt `ideal` aus dessen eigenen
Angaben (Anmeldeschluss vor Datum, sonst der Tag, um den es geht), bei einer
Gemeindemitteilung aus dem Wortlaut („gesperrt ab 2. November"), und ein Tag,
der nicht im Wortlaut steht, wird nicht geliefert. **Ein wichtiger Anlass** —
Dorffest, Gemeindeversammlung, Strassensperrung, Unterbruch der Versorgung —
bekommt mehrere Auftritte: der erste ist **der erste Lesetag nach der
Publikation** (Montag bis Freitag, kein Basler Feiertag), dann der Termin
selbst; eine offen zugängliche Ausstellung, die eine Woche oder länger läuft,
zusätzlich ihren letzten Tag. Der erste Lesetag wird bei der Auslieferung aus
`publiziert_am` gerechnet, nicht beim Schreiben — ein Beitrag liegt oft Tage
auf dem Tisch, bevor er hinausgeht. Ein Anlass, der nicht als wichtig gilt,
bekommt keine Liste, und der Dorfkönig bringt ihn wie bisher am Werktag davor.

**Was sich ändern kann.** Die Redaktion ändert Termin, Ende, Auftritte und die
Einstufung als wichtig auch nach der Publikation. `GET /api/v1/artikel/{id}`
liefert immer den aktuellen Stand; der tägliche Abgleich des Dorfkönigs ist
damit gedeckt. Ein zurückgezogener Beitrag erscheint weiter unter
`/korrekturen` und verliert damit seine Auftritte.

**Antworten auf die drei Fragen des Dorfkönigs.** Erstens: wir nennen die
Lesetage selbst, kein Kürzel — explizite Tage sind ehrlicher, und die
Redaktion sieht auf der Karte genau, was hinausgeht. Zweitens: `?seit=`
filtert auf `publiziert_am`, die Publikation, nicht auf die letzte Änderung.
Drittens: jede Zeile der Schnittstelle ist ein Beitrag für genau eine
Gemeinde; ein Thema, das mehrere Gemeinden betrifft, sind mehrere Beiträge,
und jeder trägt seinen eigenen `termin`.

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

## Abholen ohne Doppel (seit 1.5.0)

Der Dorfkönig erzeugte Mehrfacheinträge (gemessen am 23. September 2026).
Der Grund liegt in der Abfrage: `?seit=` ist auf den **Tag** einschliesslich,
ein um 09:00 publizierter Beitrag kommt bei jedem Aufruf desselben Tages
wieder, und wer sich merken muss, was er schon hat, vergisst es irgendwann.
Seit 1.5.0 merkt sich die Schnittstelle das selbst — je Abnehmer, unter
seiner Kennung.

**Der Ablauf, drei Schritte, immer dieselben:**

1. `GET /api/v1/artikel?abnehmer=dorfkoenig&grenze=100` — nur Beiträge
   **hinter** dem bestätigten Stand, **älteste zuerst**. Der Umschlag trägt
   zusätzlich:

   ```json
   "abholung": {
     "abnehmer": "dorfkoenig",
     "bisher": "2026-09-22T14:03:11.412Z|3f9c…",
     "stand":  "2026-09-23T07:41:02.118Z|8a10…"
   }
   ```

   `bisher` ist der Stand vor diesem Aufruf (null beim ersten Kontakt),
   `stand` der Stand des **letzten Beitrags dieser Seite** (null, wenn die
   Seite leer ist).

2. Die Beiträge speichern.
3. `POST /api/v1/abnehmer/dorfkoenig/abgeholt` mit der Kopfzeile
   `X-Abnehmer-Key: <Schlüssel>` und dem Körper
   `{"stand": "<genau der Wert aus abholung.stand>"}`. Antwort:

   ```json
   {
     "abnehmer": "dorfkoenig",
     "stand": "2026-09-23T07:41:02.118Z|8a10…",
     "abgeholt_bis": "2026-09-23T07:41:02.118Z",
     "abgeholt_am": "2026-09-23T09:00:04.512Z",
     "offen": 0,
     "vorher": "2026-09-22T14:03:11.412Z|3f9c…"
   }
   ```

   `offen` sagt, wie viele Beiträge noch hinter dem neuen Stand liegen.

Solange `weitere` true ist: zurück zu 1. Eine Seite, die nicht bestätigt
wurde, kommt beim nächsten Aufruf **unverändert wieder** — das ist die
Garantie gegen Verlust. Die Bestätigung ist die Garantie gegen Doppel.

**Was der Stand ist.** `<publiziert_am>|<id>` des letzten Beitrags der
Seite: lesbar, damit ein Mensch weiss, welcher es war — aber **nie selbst
gebaut und nie die eigene Uhr**. Ein Beitrag, der zwischen Abruf und
Bestätigung publiziert wird, fiele sonst durch. Die Liste beginnt strikt
**nach dem Zeitpunkt** des Stands. Beiträge, die denselben Zeitpunkt teilen,
werden nie über zwei Seiten verteilt: eine Seite kann darum ein, zwei
Beiträge **kürzer** als `grenze` sein (die Gruppe kommt ganz auf der
nächsten) oder in einem seltenen Fall **länger** (eine Gruppe, die grösser als
`grenze` ist, kommt ganz). `anzahl` sagt, was kam; `weitere` bleibt wahr.

**Regeln.**

- `gemeinde` und `versatz` sind mit `abnehmer` nicht erlaubt (`400`): der
  Stand gilt für alle Gemeinden, geblättert wird über die Bestätigung.
- `seit` ist mit `abnehmer` nur erlaubt, solange **kein** Stand bestätigt ist —
  der Einstieg. Danach `400`; den Parameter weglassen.
- Ein **älterer** Stand setzt zurück und liefert erneut. Das ist gewollt: der
  einzige Weg, einen Verlust auf der Abnehmerseite zu heilen. `vorher` zeigt
  den Schritt.
- `GET /api/v1/abnehmer/dorfkoenig` zeigt jederzeit Stand, Zeitpunkt der
  Bestätigung und `offen`. Ohne Bestätigung: alles null, `offen` = alle
  publizierten Beiträge. Ohne Schlüssel lesbar wie alles andere.
- Der Schlüssel (`BLOG_API_ABNEHMER_KEY`) kommt von der Redaktion. Fehlt er in
  deren Umgebung, antwortet die Bestätigung `503 nicht_konfiguriert`; stimmt
  er nicht, `401 nicht_berechtigt`. Nicht als `Authorization` schicken — die
  Kopfzeile gehört Directus.
- Ein zurückgezogener und wieder publizierter Beitrag behält sein
  `publiziert_am` und kommt darum **nicht** ein zweites Mal — er war schon da.
  `/korrekturen` meldet den Rückzug, `/artikel/{id}` das Wiedererscheinen.
- `/artikel/{id}` und `/korrekturen` sind unverändert. Das tägliche Nachlesen
  eines Beitrags (Termin, Text) läuft weiter darüber.

**Umstellung.** Einmal
`GET /api/v1/artikel?abnehmer=dorfkoenig&seit=<Tag, ab dem noch nichts
gespeichert ist>`, speichern, bestätigen. Ab dann ohne `seit`. Die alte
Abfrage mit `?seit=` funktioniert weiter — nur ohne Gedächtnis.

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

| `rubrik`        | Woher der Beitrag kommt                                               | `quelle_name`                                                                                                   | `quelle_url`                                                                                           |
| --------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `statistik`     | Datensatz von data.bl.ch / statistik.bl.ch                            | „Statistisches Amt Basel-Landschaft"                                                                            | der Webartikel des Amtes, sonst die Datensatzseite                                                     |
| `statistik`     | Südanflug-Quote des EuroAirport (ILS-33-Nutzungsstatistik)            | „EuroAirport"                                                                                                   | das Monats-PDF der Statistik                                                                           |
| `statistik`     | Abstimmungsresultat einer Gemeinde (eine Vorlage, ein Abstimmungstag) | „Kanton Basel-Landschaft"                                                                                       | die amtliche Publikation des Kantons zu dieser Vorlage                                                 |
| `sport`         | Spielresultat eines Vereins                                           | „Match-Center"                                                                                                  | **null** — es gibt keine stabile Adresse für ein einzelnes Spiel (die Tagesseite des Verbands rotiert) |
| `entsorgung`    | Abfuhrkalender der Gemeinde                                           | „Abfuhrkalender ‹Gemeinde› ‹Jahr›"                                                                              | die PDF-Adresse der Registrierung, sonst null                                                          |
| `amtsblatt`     | Amtsblattportal (kantonal / SHAB)                                     | das publizierende Amt                                                                                           | das amtliche PDF                                                                                       |
| `beschaffung`   | öffentliche Beschaffung auf simap.ch                                  | „simap.ch"                                                                                                      | die Projektseite                                                                                       |
| `gemeinde`      | Mitteilung auf der offiziellen Website der Gemeinde                   | „Gemeinde ‹Name›"                                                                                               | die Unterseite, auf der die Mitteilung steht                                                           |
| `veranstaltung` | Anlass aus einem Veranstaltungskalender einer Gemeinde                | der Name des Kalenders — heute „Veranstaltungskalender der Gemeinde ‹Name›", später eine Plattform oder ein Ort | die Seite des Anlasses                                                                                 |
| `presseschau`   | Wochenblatt-Beitrag                                                   | der Name des Blattes                                                                                            | die Seite im PDF bzw. im issuu-Reader                                                                  |
| `sendung`       | Regionaljournal / punkt6                                              | der Sendungsname                                                                                                | Deeplink mit Zeitmarke (`#t=` bzw. `?t=`)                                                              |
| `null`          | kommt heute nicht vor — ehrlicher als eine geratene Rubrik            | null                                                                                                            | null                                                                                                   |

`quelle_url: null` ist eine echte Antwort, keine Lücke: besser keine Adresse als
eine erfundene.

**Veranstaltungen sind seit dem 20. September 2026 eine eigene Rubrik.** Bis
dahin kamen sie als `gemeinde` durch; jetzt ist `veranstaltung` der zehnte
Wert der Rubrik, und ein Abnehmer, der ihn nicht kennt, sieht einen Beitrag
mit einer unbekannten Rubrik — kein Bruch der Form, aber ein neuer Wert. Der
Grund für den Bruch der bisherigen Zusage: die Redaktion liest je Gemeinde
nicht mehr nur die Kalenderseite der Gemeinde, sondern eine LISTE von
Kalendern (die eigene Website heute, Plattformen wie Crossiety und
Veranstaltungsorte wie das Z7 in Pratteln danach), und ein Konzert aus dem Z7
ist keine „Gemeinde ‹Name›"-Quelle. `quelle_name` nennt darum den Kalender,
`quelle_url` die Seite des Anlasses selbst, nie die Liste.

Was gleich bleibt: der Termin steht ABSOLUT im Text („am Freitag, 25.
September 2026, von 13 bis 18 Uhr im Kultur- und Sportzentrum"), weil die
Fünf-Jahre-Regel auch für Termine gilt. Ein Beitrag, der ein laufendes
Angebot in Erinnerung ruft (die Redaktion nennt das ein Dauerangebot: der
Jass-Nachmittag jeden Freitag, einmal im halben Jahr für Neuzugezogene),
trägt eine Zeile „Stand: ‹Datum›, laut ‹Kalender›." vor der Quellenzeile —
das ist, was ihn im Archiv wahr hält. Strukturierte Felder für Termin, Zeit
und Ort (`termin_am`, `termin_bis`, `ort`) wurden weiterhin NICHT
erfunden: kein Abnehmer hat danach gefragt. Die Werte liegen in der
`datengrundlage` des Beitrags bereit; wer sie braucht, meldet sich, dann
kommen sie mit einer Versionszahl.

**`statistik` steht dreimal in der Tabelle, und das ist Absicht.** Seit dem 17. September 2026 kommt eine zweite Art Statistik-Beitrag dazu: die
Südanflug-Quote des EuroAirport, wie viele Landungen in einem Monat über die
Piste 33 und damit über den Süden gingen. Sie bekommt **keine eigene Rubrik** —
ein Abnehmer, der die acht Werte kennt, müsste sonst einen neunten lernen, und
eine neue Rubrik ist ein Entscheid seiner Seite, nicht ein Nebeneffekt unseres
Baus. Wer die beiden auseinanderhalten will, liest `quelle_name`: „EuroAirport"
gegen „Statistisches Amt Basel-Landschaft".

Zwei Dinge, die ein Abnehmer dieser Beiträge wissen sollte. **Die Quote gilt
für den Flughafen, nicht für die Gemeinde** — der EuroAirport erhebt sie nicht
je Gemeinde, es gibt keine Zahl für eine einzelne, und der Text sagt darum „X
Prozent aller Landungen erfolgten über den Süden, also über ‹Gemeinde›". Und
**die Zahlen bleiben dauerhaft provisorisch**: der Flughafen korrigiert
einzelne Monate nachträglich, der Text sagt das, und wenn eine Zahl sich später
bewegt, erscheint der Beitrag im Zweifel unter `/api/v1/korrekturen` — sobald
eine Redaktorin ihn zurückzieht. Automatisch zurückgezogen wird nichts.

**Und seit dem 18. September 2026 ein drittes Mal: das Abstimmungsresultat.**
Der Kanton veröffentlicht je Vorlage und Gemeinde das amtliche Ergebnis; daraus
entsteht ein Beitrag je Gemeinde und Vorlage. Dieselbe Überlegung wie beim
EuroAirport: **keine eigene Rubrik**, weil ein Abnehmer sonst einen zehnten Wert
lernen müsste, und das ist sein Entscheid und nicht unser Nebenprodukt. Wer sie
auseinanderhalten will, liest `quelle_name`: „Kanton Basel-Landschaft".

Drei Dinge, die ein Abnehmer dieser Beiträge wissen sollte. **Initiative,
Gegenvorschlag und Stichfrage sind EIN Beitrag**, nicht drei: der Datensatz
trägt sie unter einer gemeinsamen Kennung, und drei Meldungen über dieselbe
Frage liest niemand. **Eine Stichfrage steht nur dann im Text, wenn der Kanton
beide Vorlagen angenommen hat** — sonst sind ihre Zahlen bedeutungslos, und sie
werden gar nicht erst geschrieben. Und **ein Beitrag entsteht erst, wenn die
Gemeinde an diesem Tag vollständig ausgezählt ist**: es gibt keine
Zwischenstände in diesem Kanal, weder als Beitrag noch als Feld.

## Bilanz

`GET /api/v1/bilanz` sagt, wie viel auf welchem Tisch liegt und wie lange schon.
**Nur Mengen und Tage** — kein Titel, kein Lead, kein Text, kein Name. Der Weg
ist für einen Wächter gedacht, der die Frage beantworten soll, die kein Beitrag
beantwortet: staut es sich, und wo.

Gezählt werden die Beiträge, nicht die Vorschläge auf den Sichtungstischen. Jeder
Tisch entscheidet selbst, was dort «offen» heisst, und diese Regeln hier
nachzubauen hiesse, eine zweite Wahrheit zu führen. Was alle Tische teilen, ist
der Beitrag, den sie hervorbringen.

| Feld           | Typ     | Bedeutung                                                     |
| -------------- | ------- | ------------------------------------------------------------- |
| `stand`        | string  | ISO 8601 in UTC, der Zeitpunkt der Messung                    |
| `fenster_tage` | integer | wie weit die Wochenzahlen zurückreichen (Parameter `fenster`) |
| `medium`       | string  | wie beim Beitrag                                              |
| `gesamt`       | Objekt  | dieselben Felder wie eine Tischzeile, über alle Tische        |
| `tische[]`     | Liste   | je Tisch eine Zeile, immer alle neun                          |

Je Tisch:

| Feld                        | Typ             | Bedeutung                                                                                                           |
| --------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `tisch`                     | enum            | `statistik`, `sport`, `presseschau`, `amtsblatt`, `gemeindeseite`, `veranstaltung`, `sendung`, `entsorgung`, `ohne` |
| `offen`                     | integer         | wartet auf einen Menschen (`entwurf`, `in_pruefung`)                                                                |
| `freigegeben`               | integer         | unterschrieben, wartet auf den Zeitlauf                                                                             |
| `aeltester_tage`            | integer \| null | Alter des ältesten wartenden Beitrags in ganzen Tagen; `null`, wenn keiner wartet                                   |
| `publiziert_im_fenster`     | integer         | im Fenster publiziert                                                                                               |
| `freigegeben_im_fenster`    | integer         | im Fenster unterschrieben                                                                                           |
| `zurueckgezogen_im_fenster` | integer         | im Fenster zurückgezogen                                                                                            |

**Ein Tisch ohne Arbeit fällt nicht heraus**, er steht mit Nullen da: «kommt
nicht vor» liest sich wie «gibt es nicht» und nicht wie «hat nichts zu tun».

**Verworfene Beiträge kommen nicht vor.** `verworfen` trägt keinen eigenen
Zeitstempel, und ein Fenster über `date_updated` nennte jedes spätere Speichern
einen Entscheid. Lieber keine Zahl als eine, die etwas anderes misst als ihr Name.

`bilanz` hängt hinter demselben Schalter wie die Beiträge. Unveröffentlichte
Arbeit ist nicht weniger privat als veröffentlichte; wer nur wissen will, ob der
Dienst trägt, fragt `/api/v1/gesundheit`.

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

| Status | `code`                       | Wann                                                                                                                                                               |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400    | `ungueltige_eingabe`         | Parameter fehlt, unlesbar oder ausserhalb des Erlaubten; ein Stand, der keiner ist; `abnehmer` mit `gemeinde`, `versatz` oder (nach der ersten Bestätigung) `seit` |
| 401    | `nicht_berechtigt`           | nur auf der Bestätigung: `X-Abnehmer-Key` fehlt oder stimmt nicht                                                                                                  |
| 404    | `nicht_gefunden`             | unbekannter Pfad, unbekannte Gemeinde, unbekannte, unpublizierte oder krumme Beitrags-Kennung                                                                      |
| 405    | `methode_nicht_erlaubt`      | eine andere Methode als die des Pfads; die Meldung nennt die erlaubte                                                                                              |
| 500    | `interner_fehler`            | die Anwendung ist gestolpert; die Meldung nennt den Fehlertyp, nie einen Stacktrace                                                                                |
| 503    | `schnittstelle_abgeschaltet` | `BLOG_API_OFFEN` ist nicht gesetzt                                                                                                                                 |
| 503    | `nicht_konfiguriert`         | nur auf der Bestätigung: `BLOG_API_ABNEHMER_KEY` ist bei der Redaktion nicht gesetzt                                                                               |

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
3. **Ein `POST` auf einer lesenden Schnittstelle** (R2): die Bestätigung des
   Abnehmers. Sie ändert keinen Beitrag, nur, was demselben Abnehmer als
   Nächstes angeboten wird — und sie braucht deshalb einen Schlüssel, wo alles
   Lesende keinen braucht. Die Alternative, dass sich jeder Abnehmer selbst
   merkt, was er schon hat, ist die, die Doppel erzeugt hat.

## Abnahme

```bash
A=https://redaktion-admin.apps.bajour.ch/api/v1
curl -s $A/gesundheit | python3 -m json.tool          # bereit: true, merkmal: "keines"
curl -s $A/gemeinden | python3 -m json.tool           # die gueltigen Kennungen
curl -s "$A/artikel?gemeinde=muenchenstein&seit=2026-08-01&grenze=5" | python3 -m json.tool
curl -s "$A/artikel?grenze=501"                       # 400 ungueltige_eingabe
curl -s $A/quatsch                                    # 404 im eigenen Umschlag, nie HTML
curl -s "$A/artikel?abnehmer=dorfkoenig&grenze=3"     # aelteste zuerst, mit abholung.stand
curl -s -X POST "$A/abnehmer/dorfkoenig/abgeholt" -H "X-Abnehmer-Key: $KEY" \
  -H 'Content-Type: application/json' -d '{"stand":"<abholung.stand>"}'   # offen, vorher
curl -s $A/abnehmer/dorfkoenig                        # der Stand, jederzeit
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
Weg `/korrekturen`. Version 1.2.0 am 17. September 2026: der Weg `/bilanz`. Neue
Felder und neue Wege, kein Bruch — wer sie nicht liest, merkt nichts.
Am 18. September 2026 geprüft und unverändert: die Veranstaltungen der
Gemeinden kamen als Rubrik `gemeinde` durch dieselbe Tür. Version 1.3.0 am 20. September 2026: Rubrik `veranstaltung` mit dem Kalender als
`quelle_name`, ein neunter Tisch `veranstaltung` in der Bilanz — ein neuer
Wert je Enum, keine neue Form. Version 1.4.0 am 22. September 2026: das Feld
`termin` je Beitrag (ideal, ende, auftritte), nach dem Vorschlag des Dorfkönigs
vom 21. September — optional, rückwärtskompatibel; wer es nicht liest, merkt
nichts. Die Versionsnummer in `/v1/beschreibung` und `/v1/openapi.json` sprang
dabei von 1.2.0 auf 1.4.0: 1.3.0 war im Vertrag dokumentiert, aber im Code nie
gestempelt. Version 1.5.0 am 23. September 2026: der Stand je Abnehmer
(`?abnehmer=`, `abholung` im Umschlag, `GET /abnehmer/{kennung}`,
`POST /abnehmer/{kennung}/abgeholt` mit Schlüssel) gegen die Mehrfacheinträge
des Dorfkönigs; die Liste ohne `abnehmer` ist unverändert, nur die Sortierung
hat bei gleichem Zeitpunkt jetzt die `id` als zweiten Schlüssel._
