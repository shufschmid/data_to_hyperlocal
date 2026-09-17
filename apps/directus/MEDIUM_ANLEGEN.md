# Ein zweites Medium anlegen

Die Redaktion ist **eine Instanz je Haus**. Es gibt keinen Mandantenbegriff und
keine Mandantenspalte: ein zweites Medium ist ein zweiter Stack mit eigener
Datenbank, eigenem Directus und eigener Adresse. Diese Anleitung sagt, was
dabei zu tun ist, was Konfiguration ist, was Registrierung, und was ohne Kanton
Basel-Landschaft still bleibt.

Stand: 17. September 2026. Jede Aussage hier ist gegen den Code geprueft, nicht
aus dem Gedaechtnis geschrieben; wo eine Zahl steht, ist sie gemessen.

---

## 1. Was ein zweites Medium wirklich kostet

Von den neun Feeds sind **acht kantonsunabhaengig gebaut** — das war zu
bestaetigen und ist bestaetigt:

| Feed            | Woran er haengt                                                            | Kantonal? |
| --------------- | -------------------------------------------------------------------------- | --------- |
| Amtsblatt       | `amtsblattportal.ch` — alle Kantone und der Bund an einer Tuer             | nein      |
| Beschaffung     | `www.simap.ch` — Bund und alle Kantone                                     | nein      |
| Gemeindeseiten  | Fingerabdruck der CMS-Familie im HTML, nie ein Hostname                    | nein      |
| Wochenblaetter  | Plattform (WordPress, lokalzeitungen.ch, issuu, Localpoint), nie ein Blatt | nein      |
| Sport           | nationale Verbaende (Fussball, Swiss Volley, Handball)                     | nein      |
| Entsorgung      | ein registrierter Kalender je Gemeinde                                     | nein      |
| Regionaljournal | ein IMAP-Postfach plus die SRGSSR-Audio-API                                | nein      |
| punkt6          | `telebasel.ch` — regional, aber nicht kantonal gebunden                    | nein      |
| **Statistik**   | ein Opendatasoft-Portal je Kanton plus die Agenda des Amtes                | **ja**    |

Die Statistik ist der eine Feed, der einen Kanton kennt. Seit dem 17. September 2026 steht der Kanton nicht mehr im Code, sondern in der Zeile
der Quelle (Abschnitt 4).

**Zusaetzlich kantonal, aber nicht als Feed:** die Planlesung am
Amtsblatt-Tisch. Nur Baselland legt die Planblaetter als einfache Bilder auf
(`bgauflage.bl.ch`); Basel-Stadt und Solothurn halten sie hinter Betrachtern,
die wir nicht lesen. Die Zeile zeigt den Link dann und liest ihn nicht
(`Unterlage.lesbar`). Fuer ein Medium ausserhalb von Baselland heisst das:
Amtsblatt-Meldungen ja, Planbefunde nein.

---

## 2. Directus-Einstellungen

- **Projektname und Logo:** Directus-Admin → Einstellungen → Allgemein. Rein
  kosmetisch; nichts im Code liest sie.
- **Admin-Konto:** `ADMIN_EMAIL` und `ADMIN_PASSWORD` vor dem ersten Start
  aendern. Die Vorlage liefert `admin@wepublish.ch` / `admin123`, und zwei
  Instanzen, die das behalten, akzeptieren gegenseitig ihre Logins.
- **`KEY` und `SECRET`:** je Instanz frisch erzeugen. Zwei Stacks mit demselben
  `SECRET` nehmen gegenseitig ihre Token an; zwei mit verschiedenen weisen sie
  mit `403 INVALID_TOKEN` ab. Beides ist der Fehler, den niemand suchen will.
- **Dienstnamen in `docker-compose.yml`:** das Praefix `redaktion-` muss auf dem
  Deploy-Host eindeutig bleiben, nicht nur in der Datei. Zwei Stacks, die den
  Alias `directus` veroeffentlichen, teilen sich auf einer PaaS ein Docker-Netz
  und beantworten gegenseitig die Haelfte der Anfragen. Das ist im August 2026
  genau so passiert; der Kopf der compose-Datei erzaehlt es ganz.
- **Schema:** kommt aus `apps/directus/schema/` ueber `schema:load` beim Start
  (`RUN_SCHEMA_SYNC=true`). Nichts davon ist je von Hand nachzubauen.

---

## 3. Die Variablen, und was sie fuer ein zweites Haus bedeuten

Alle liegen in der `.env` neben `docker-compose.yml`; die Beispieldatei ist
`.env.example` in der Repo-Wurzel, die Backend-Fassung
`apps/directus/.env.example`. Das Front hat keine eingecheckte Beispieldatei,
seine Variablen stehen ebenfalls in der Wurzel-`.env.example` und im Abschnitt
Environment von `apps/front/CLAUDE.md`.

| Variable                    | Bedeutung fuer ein zweites Medium                                                                                                                                          | Leer heisst                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `REDAKTION_MEDIUM`          | Die Kennung des Hauses (ASCII, snake_case, etwa `bajour`). Der Dorfkoenig liest mehrere Redaktionen und muss wissen, wer spricht; sie steht an jedem Artikel der Tuer.     | `unbenannt`, die Tuer bleibt offen                                     |
| `BLOG_API_OFFEN`            | `ja` schaltet `/api/v1/…` ein — die Tuer, durch die der Dorfkoenig liest. Ausdruecklicher Schalter, nie ein Rueckfall.                                                     | Inhaltspfade antworten 503, `gesundheit` sagt welchen der zwei Gruende |
| `ANTHROPIC_API_KEY`         | Jeder Modellaufruf. Ohne ihn laufen die Abrufe, und jede Meldung, die geschrieben werden soll, scheitert laut.                                                             | AI-Funktionen antworten mit Fehler                                     |
| `AGENDA_KONTAKT`            | Das gelesene Postfach im User-Agent, mit dem wir fremde Seiten abrufen. **Vor dem ersten Lauf auf das eigene Haus umstellen** — sonst erreicht ein Seitenbetreiber Bajour. | Vorgabe `it@bajour.ch`, also falsch fuer jedes andere Haus             |
| `CRAWLER_URL`/`CRAWLER_KEY` | Die zweite Tuer (we.publish-Crawler) fuer Seiten, die einen direkten Abruf abweisen, und die einzige Tuer fuer die Sportquellen.                                           | Sport bleibt still, die zweite Tuer bleibt zu, der Rest merkt nichts   |
| `ZETTELKASTEN_URL`/`_TOKEN` | Die Vorgeschichte am Amtsblatt-Tisch. Deckt heute beide Basel seit 2018.                                                                                                   | Der Tisch sagt „nicht angeschlossen"                                   |
| `ZETTELKASTEN_MANDANT`      | Wer beim Zettelkasten fragt.                                                                                                                                               | —                                                                      |
| `SOKRATES_API_KEY`          | Die geschuetzte Tuer `/sokrates/sendungen`. Nur noetig, wo ein Sokrates existiert.                                                                                         | 503                                                                    |
| `EDITOR_EINBETTUNG`         | Die Urspruenge, die diesen Arbeitsplatz in einen iframe nehmen duerfen — der Editor des eigenen Mediums. Nur https, nur Schema und Host.                                   | `X-Frame-Options: SAMEORIGIN`, keine Einbettung                        |
| `IMAP_*`, `PUNKT6_*`        | Das Postfach, in das SMD die Transkripte liefert. **Der Betreff-Filter ist Pflicht**: ein leerer hat einmal 14 fremde Mails zu fehlschlagenden Dossiers gemacht.           | Die zwei Sendungs-Reiter bleiben leer und sagen es                     |
| `SRGSSR_*`                  | Loest je Beitrag die Audio-Datei auf. Je Beitrag optional gelesen.                                                                                                         | `resolution_error` je Beitrag, nie ein Absturz                         |
| `REDAKTION_TOKEN_TTL_TAGE`  | Lebensdauer eines Freigabe-Links.                                                                                                                                          | Vorgabe 14                                                             |

**`ODS_PORTALE` gibt es bewusst nicht.** Welche Statistik-Portale gelesen
werden, sind Zeilen in `quellen` und keine Umgebungsvariable — siehe den
naechsten Abschnitt und den Grund dort.

---

## 4. Die Statistik: ein Portal ist eine Zeile

`datensaetze.quelle` zeigt auf eine Zeile in `quellen`, und die traegt alles,
was der Feed ueber ihr Portal wissen muss:

| Feld            | Was drinsteht                                                                          |
| --------------- | -------------------------------------------------------------------------------------- |
| `typ`           | `ods` (Opendatasoft), `statbl` (das Tabellenportal BL), `agenda`, `amtsblatt`, `simap` |
| `basis_url`     | Die nackte Adresse des Portals, ohne abschliessenden Schraegstrich                     |
| `konfiguration` | `{ "amt": "…", "bezirke": ["…"] }` — siehe unten                                       |
| `aktiv`         | Ob der taegliche Lauf sie ueberhaupt anfasst                                           |

`konfiguration` traegt zwei Angaben:

- **`amt`** — der Name, den ein Artikel als Quelle nennt und den die Tuer als
  `quelle_name` ausliefert. Ohne Angabe faellt der Code auf „Statistisches Amt
  Basel-Landschaft" zurueck; fuer ein anderes Haus ist das falsch, also
  ausfuellen.
- **`bezirke`** — die Werte aus `gemeinden.bezirk`, ueber die dieses Portal
  Zahlen fuehrt. Die Gemeinden-Karte sagt damit je Gemeinde, welches Portal sie
  bedient, und wo keines zustaendig ist, sagt sie das statt eine Redaktorin auf
  Meldungen warten zu lassen, die nicht kommen koennen. **Leer heisst „deckt
  nichts ab"** — Schweigen einer Quelle ist keine Zusage.

**Eine Falle:** `gemeinden.bezirk` ist freier Text. Die Baselbieter Zeilen
tragen ihren Bezirk (`Arlesheim`, `Laufen`, `Liestal`, `Sissach`,
`Waldenburg`), Riehen traegt `Basel-Stadt`, und eine ausserkantonale Gemeinde
wird laut Formular mit Kuerzel erfasst (`Dorneck (SO)`). Die `bezirke` eines
Portals muessen genau so geschrieben sein, wie sie an der Gemeinde stehen.

**Warum eine Zeile und keine Variable:** ein Datensatz weiss ueber seine
`quelle` schon, von welchem Portal er kommt, und der taegliche Katalogabgleich
laeuft ohnehin Quelle fuer Quelle (`operations/quellen-pruefen`). Eine Liste von
Hosts in der Umgebung waere eine zweite Wahrheit ueber dieselbe Sache, und die
beiden wuerden an dem Tag widersprechen, an dem es darauf ankommt.

### Ein Portal registrieren

1. Pruefen, ob es ueberhaupt Opendatasoft ist: `GET
https://<host>/api/explore/v2.1/catalog/datasets?limit=5` muss `total_count`
   und `results` liefern.
2. Im Directus-Admin eine Zeile in `quellen` anlegen: `typ: ods`, `basis_url`,
   `konfiguration` mit `amt` und `bezirke`, `aktiv: true`.
3. Die Option **„Katalogseiten je Quelle"** im Flow „Quellen taeglich pruefen"
   pruefen. Sie steht auf 2, also 200 Datensaetze je Quelle — genug fuer
   `data.bl.ch` mit 188, zu wenig fuer `data.bs.ch` mit 361. Reicht sie nicht,
   sagt der Lauf es seit dem 17. September 2026 in seinen Hinweisen, statt
   still 161 Datensaetze zu uebergehen.
4. Am naechsten Lauf steht der Katalog im Reiter „statistik.bl".

### Wenn das Portal seine Gemeindespalte nicht annotiert

Die automatische Erkennung (`detectMunicipalityFields`) kennt zwei Wege: die
Beschreibung eines Feldes traegt das Baselbieter Konzept `DV_KT_BEZ_GDE_SNAP`,
oder das Feld heisst `bfs_gemeindenummer`, `gemeindenummer`, `bfs_nr` oder
`bfs_nummer`. Trifft keiner, traegt eine Redaktorin die Spalte in
`datensaetze.gemeindefeld` nach, und `matchMunicipalities` verbindet sie ueber
den Namen mit der BFS-Nummer.

Das ist nicht theoretisch: auf `data.bs.ch` sind die Feldbeschreibungen leer,
und die Spalte `gemeinde` fuehrt den **kantonseigenen Code** (Basel 10, Riehen
20, Bettingen 30), nicht die BFS-Nummer. Die richtige Antwort dort heisst
`gemeindename`. Wer stattdessen `gemeinde` eintraegt, bekommt keine falschen
Artikel, sondern gar keine: die Codes landen unter „unbekannte Gemeinden".

---

## 5. Die Gemeinden

Heute seedet die Migration `20260824A-stammdaten.mts` die 86 Baselbieter plus
Riehen, alle mit `aktiv: false`; eine Redaktorin schaltet ein, was das Haus
bespielt.

Fuer ein Medium in einem anderen Kanton gibt es zwei Wege:

1. **Von Hand, ueber das Formular.** „Gemeinden" → „Gemeinde hinzufuegen" →
   ausserkantonal neu erfassen: Name, BFS-Nummer, Bezirk. Die BFS-Nummer ist
   Pflicht, auch fuer eine Gemeinde, deren Zahlen nie kommen — sie ist die
   Identitaet, ueber die jeder spaetere Join laeuft. Fuer ein Haus mit einer
   Handvoll Gemeinden ist das der ganze Aufwand.
2. **Als Datei je Kanton — Vorschlag, nicht gebaut.** Eine Migration nach dem
   Muster von `20260824A` mit dem BFS-Verzeichnis des Kantons, insert-only.
   Wer das baut, beachte: die Liste ist nicht nur Auswahl, sondern auch das
   Verzeichnis, gegen das die Portal-Erkennung prueft (eine Seite gilt als
   Gemeindetabelle, wenn sie mindestens **20** unserer Gemeindenamen nennt,
   `MIN_GEMEINDEN`). Eine ausgeduennte Liste laesst die Erkennung still
   versiegen.

---

## 6. Die Registrierungen je Tisch

Kein Code, aber ohne sie bleibt der jeweilige Tisch leer. Alles im Arbeitsplatz,
nicht im Directus-Admin, ausser wo anders vermerkt.

| Tisch          | Was registriert wird                                 | Wo                                                                                      | Fehlt es, heisst das                                                             |
| -------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Entsorgung     | ein Abfuhrkalender je Gemeinde und Jahr              | „Entsorgung" → „Abfuhrkalender erfassen"; eine PDF je Zone                              | keine Erinnerungen                                                               |
| Sport          | die Vereine einer Gemeinde                           | „Gemeinden" → die Karte → „Verein erfassen"                                             | keine Spielberichte; ohne Konnektor zur `quelle` bleibt ein Verein still erfasst |
| Wochenblaetter | ein Blatt mit seiner Archiv-Adresse                  | „Wochenblaetter" → „Wochenblatt erfassen"; Zuordnung zu weiteren Gemeinden in der Karte | keine Presseschau                                                                |
| Gemeindeseiten | `gemeinden.news_url`                                 | „Gemeinden" → die Karte → Abschnitt „Gemeindeseite"                                     | keine Mitteilungen dieser Gemeinde                                               |
| Amtsblatt      | `gemeinden.plz`                                      | „Gemeinden" → die Karte → Abschnitt „Amtsblatt"                                         | Handelsregister, Konkurse und Betreibungen bleiben **still**, nicht leer         |
| Beschaffung    | `gemeinden.simap_vergabestellen`                     | Directus-Admin (JSON)                                                                   | nur, was ANDERE in der Gemeinde ausschreiben; nicht, was sie selbst ausschreibt  |
| statistik.bl   | `quellen` (Abschnitt 4) und der Auftrag je Datensatz | Directus-Admin bzw. „statistik.bl" → „Auftrag …"                                        | keine Statistik-Artikel                                                          |

Zwei davon sind gemessen tueckisch und darum hier wiederholt:

- **Die PLZ fehlen still.** Das Amtsblattportal indexiert die eine Haelfte
  seiner Publikationen ueber den ORT (die BFS-Nummer) und die andere ueber die
  ADRESSE (die PLZ), und die beiden Mengen ueberschneiden sich nicht: fuer
  Pratteln im August 2026 waren das 14 Zeilen gegen 65, ohne eine gemeinsame.
  Ohne PLZ sieht das aus wie „es wurde nichts publiziert".
- **Die simap-Vergabestellen muss ein Mensch pruefen.** Das oeffentliche
  Verzeichnis nennt keinen Kanton, die Namenssuche liefert „Gemeinde Aesch LU"
  und zwei Reinach AG. Jede uuid wird gegen die PLZ ihrer tatsaechlichen
  Publikationen verifiziert, sonst landen die Ausschreibungen eines fremden
  Kantons spurlos auf diesem Tisch.

---

## 7. Was ohne Kanton Basel-Landschaft still bleibt

Diese drei Dinge sind an Baselland gebunden und werden es bleiben, bis jemand
einen Adapter fuer den neuen Kanton baut. **Alle drei sind still, nicht kaputt:**

| Was                              | Warum                                                                                              | Was der Arbeitsplatz sagt                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Die Publikationsagenda           | `www.baselland.ch` ist der Kalender EINES Amtes. Ein anderer Kanton hat einen anderen oder keinen. | Die Zeile in `quellen` auf `aktiv: false` stellen, sonst meldet der Lauf taeglich einen Fehler |
| `statistik.bl.ch` (Typ `statbl`) | Ein HTML-Parser fuer die Excel-Ausgabe genau dieses Portals                                        | dito                                                                                           |
| Die Planlesung                   | Nur BL legt die Planblaetter als Bilder auf (`bgauflage.bl.ch`)                                    | Die Zeile zeigt den Link und liest ihn nicht (`Unterlage.lesbar`)                              |

Und was die Karte sagt: eine Gemeinde, deren Bezirk kein registriertes Portal
fuehrt, traegt im Abschnitt „Statistik" den Hinweis „Kein registriertes
Statistikportal fuehrt den Bezirk …". Amtsblatt, Sport, Abfuhrkalender und
Presseschau laufen fuer sie normal weiter — das steht dort ausdruecklich, weil
Schweigen sonst wie ein Defekt aussieht.

---

## 8. Die Reihenfolge

1. `.env` aus `.env.example`, `KEY`, `SECRET`, `ADMIN_*`, `DB_PASSWORD`,
   `AGENDA_KONTAKT` und `REDAKTION_MEDIUM` setzen.
2. `docker compose up --build`. Schema und Migrationen laufen beim Start.
3. Gemeinden erfassen und aktiv schalten (Abschnitt 5).
4. Die drei Baselbieter Quellen auf `aktiv: false` stellen, falls das Haus nicht
   in Baselland liegt (Abschnitt 7).
5. Das Statistik-Portal des eigenen Kantons registrieren (Abschnitt 4) — oder
   den Feed still lassen.
6. Die Tische registrieren (Abschnitt 6).
7. `BLOG_API_OFFEN=ja`, wenn ein Dorfkoenig lesen soll; der Vertrag steht in
   [SCHNITTSTELLE.md](SCHNITTSTELLE.md).

---

## 9. Was offen ist

- **Die Anleitung ist nicht an einer zweiten Instanz durchgespielt.** Sie ist
  gegen den Code geprueft, Zeile fuer Zeile, aber niemand hat mit ihr ein
  zweites Haus aufgesetzt. Die Messgroesse des Plans („die Anleitung ist an
  einer lokalen Zweitinstanz einmal durchgespielt") steht noch aus.
- **Der Import der Gemeinden je Kanton ist ein Vorschlag, kein Bau.**
- **Ob der eigene Kanton ueberhaupt ein Opendatasoft-Portal fuehrt, ist zu
  pruefen, nicht anzunehmen.** Fuer Basel-Stadt ist es am 17. September 2026
  geprueft und bejaht (Abschnitt 4). Fuer Bern ist es weder geprueft noch
  behauptet; faellt die Pruefung negativ aus, braucht dieser Kanton einen
  eigenen Adapter unter `shared/`, und der ist eine eigene Erkundung.
