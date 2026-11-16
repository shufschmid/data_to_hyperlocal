# Buschtelefon → Redaktion: Mängelliste zur Lieferung

Stand: 16. November 2026, gemessen an der rohen Antwort der Tür
(`GET /api/redaktion/v2/funde` ohne `nach`, `GET /api/redaktion/v2/quellen`,
Format `buschtelefon-redaktion/2`, Freigabe vom 16.11.2026, 11:55) und
abgeglichen mit den Zeilen, die die Redaktion daraus gespeichert hat. Beides
stimmt bei allen Funden überein: Was unten fehlt, fehlt in der Lieferung.

Die Abschnittsnummern verweisen auf den Vertrag,
[BUSCHTELEFON_SCHNITTSTELLE.md](BUSCHTELEFON_SCHNITTSTELLE.md).

## Das Wichtigste zuerst

Die Redaktion will Beiträge so bekommen, dass sie ohne Blick auf das Original
verständlich sind. Dazu fehlen drei Dinge, in dieser Reihenfolge:

1. **Text in Bildern wird gelesen und als Text übergeben.** Heute kommt zu
   keinem einzigen Fund ein Bild an.
2. **Erst danach wird entschieden, ob ein Beitrag genug Inhalt trägt, um
   geliefert zu werden.** Die Reihenfolge ist: Beitrag lesen → Bilder lesen →
   Kommentare lesen → Regel 1.1 anwenden. Der gelesene Bildtext zählt dabei
   wie eigener Text.
3. **Die Kommentare kommen vollständig und im Wortlaut.** Heute kommt
   höchstens eine Vorschau, die Hälfte davon ohne Text.

## Was geliefert wird

175 Funde: 104 aus Facebook-Gruppen, 71 aus Instagram-Hashtags (28 Reels,
43 Beiträge). 173 wurden am 12.11. freigegeben, 2 am 15.11.

| Feld                      | Facebook (104)                          | Instagram (71)                 |
| ------------------------- | --------------------------------------- | ------------------------------ |
| `bilder`                  | bei allen `[]`                          | bei allen `[]`                 |
| `n_bilder`                | bei allen `null`                        | bei allen `null`               |
| `n_kommentare`            | bei allen `null`                        | 52× 0, 19× 1 bis 8             |
| gelieferte Kommentare     | 263, je Beitrag 0 bis 6                 | 0                              |
| Kommentare mit `text: ""` | 127 von 263                             | –                              |
| `kommentare_stand`        | 79× `unbekannt`, 25× `teilweise`        | 71× `unbekannt`                |
| `kommentare_geprueft_am`  | 5.11. bis 15.11., bei 84 vor dem 12.11. | 9.11. und 10.11.               |
| `autor_vorname`           | bei allen `null`                        | bei allen `null`               |
| `autor_art`               | bei allen `unbekannt`                   | bei allen `unbekannt`          |
| `veroeffentlicht_am`      | bei 84 `null`                           | gesetzt                        |
| `quelle_sichtbarkeit`     | bei allen `unbekannt`                   | `oeffentlich`                  |
| `verlinkt`                | bei allen `[]`                          | 7 Links, alle `nicht_versucht` |
| `geteilt`                 | bei allen `null`                        | bei allen `null`               |

## Die Mängel

### M1 — Bilder fehlen ganz (4.5, 1.1) — blockierend

**Befund.** Alle 175 Funde tragen `bilder: []` und `n_bilder: null`, auch
Reels und Bildbeiträge auf Instagram, die ohne Bild nicht existieren. Es gibt
keinen Eintrag mit irgendeinem `text_status` und kein Feld ausserhalb des
Vertrags, das Bildtext trüge.

**Folge.** Ein Beitrag, dessen Inhalt auf dem Flyer oder im Screenshot steht,
kommt als ein paar Wörter oder Hashtags an. Die Sichtung der Redaktion
benotet ihn als belanglos: 75 der 104 Facebook-Funde bekamen die tiefste
Note.

**Verlangt.**

- Jedes Bild eines Beitrags steht in `bilder`, mit seinem `text_status`.
  `n_bilder` ist die Zahl der Bilder am Beitrag; `null` nur, wenn die
  Plattform sie wirklich nicht zeigt.
- Enthält ein Bild Text (Flyer, Plakat, Screenshot, Text-Kachel, Tafel,
  Schild), wird er gelesen und in `bilder[].text` übergeben, vollständig und
  in Lesereihenfolge. `text_status` ist dann `gelesen`.
- Bei einem Reel oder Video gilt dasselbe für das Vorschaubild und für
  eingeblendeten Text, soweit er ohne Abspielen lesbar ist.
- `nicht_versucht` ist die Ausnahme für einen Ausfall, nicht der
  Normalzustand. Ein Fund, bei dem das Lesen ausfiel, wird im nächsten Lauf
  nachgelesen und mit höherer `folge` und `aenderung: ["bilder"]` neu
  geliefert (3.1).

### M2 — Aussortiert wird, bevor die Bilder gelesen sind (1.1) — blockierend

**Befund.** Regel 1.1 setzt gelesene Bilder voraus (Bedingung 2). Ohne
Bildlesen läuft sie ins Leere: Geliefert werden Beiträge aus Hashtags und
einem Punkt, während `/quellen` bei allen 20 Quellen `n_aussortiert: 0`
meldet.

**Verlangt.** Die feste Reihenfolge je Beitrag:

1. Eigenen Text lesen.
2. Alle Bilder lesen (M1).
3. Kommentare vollständig lesen (M3).
4. Erst jetzt Regel 1.1 anwenden. Gelesener Bildtext zählt wie eigener Text:
   Ein Beitrag ohne eigenen Text, dessen Flyer vierzig Wörter trägt, wird
   geliefert; ein Foto ohne Text mit drei «süss!» darunter nicht.
5. Was aussortiert wird, zählt in `n_aussortiert` seiner Quelle.

Die Regel bleibt eine Regel des Codes über Wörter, Bilder, Links und
Kommentare, kein Urteil eines Modells über Relevanz. Ob etwas wichtig ist,
entscheidet weiterhin die Redaktion.

**Vorschlag zur Verschärfung von 1.1, Bedingung 2.** Heute zählt ein Bild mit
`nicht_versucht` als möglicher Inhalt und bringt den Beitrag durch. Solange
das Lesen der Normalfall nicht ist, wird damit jeder Bildbeitrag geliefert.
Neu: Ein Beitrag, der nur wegen eines ungelesenen Bildes Inhalt haben
könnte, wird erst geliefert, wenn das Bild gelesen ist oder der zweite
Leseversuch gescheitert ist; dann mit `nicht_lesbar`.

### M3 — Kommentare sind eine Vorschau, keine Lieferung (4.7) — blockierend

**Befund Facebook.**

- Nie mehr als 6 Kommentare je Beitrag; das sieht nach der Vorschau im Feed
  aus, nicht nach dem aufgeklappten Beitrag.
- 127 von 263 Kommentaren tragen `text: ""`.
- Genau die 84 Kommentare mit Datum sind leer; ein Kommentar mit Wortlaut
  trägt nie ein Datum. Es werden offenbar zwei verschiedene Elemente gelesen
  und nicht zusammengeführt.
- `kennung_art` ist immer `abgeleitet`, `autor_vorname` immer `null`, kein
  Kommentar trägt ein Bild.
- `n_kommentare` ist immer `null`, `kommentare_stand` nie `vollstaendig`,
  `kommentare_fehlend` immer `null`.

**Befund Instagram.** `n_kommentare` nennt bei 19 Beiträgen 1 bis 8
Kommentare, geliefert wird kein einziger.

**Verlangt.**

- Der Beitrag wird einzeln geöffnet, «Alle Kommentare» gewählt und jede
  Antwortkette aufgeklappt. Geliefert wird jeder sichtbare Kommentar im
  Wortlaut, mit `antwort_auf`, Datum und Vorname.
- Ein Kommentar ohne Wortlaut wird nicht geliefert, ausser er trägt ein Bild
  mit gelesenem Text oder einen Link. Ein reines GIF oder ein Sticker ist
  kein Kommentar.
- `n_kommentare` ist der Zähler der Plattform, `kommentare_stand` sagt die
  Wahrheit: `vollstaendig` nur, wenn alle gelesen sind; sonst `teilweise` mit
  `kommentare_fehlend` als Zahl.
- Bilder in Kommentaren werden gelesen wie Bilder am Beitrag.

### M4 — Kein Fund wurde je nachgeliefert (3.1, 4.8)

**Befund.** Alle 175 Funde tragen `aenderung: ["neu"]`, `geaendert_am` ist
der Tag der ersten Freigabe, die höchste `folge` ist 175. Bei 82 der 104
Facebook-Funde liegt `kommentare_geprueft_am` drei bis sieben Tage **vor**
der ersten Freigabe. Kein Beitrag wurde also nach seiner Lieferung noch
einmal angesehen.

**Verlangt.** Die Weiterbeobachtung nach 4.8: Solange `beobachtet_bis` nicht
erreicht ist, werden Kommentare in jedem Lauf neu gelesen, und jede Änderung
kommt mit höherer `folge`.

**Wichtig für die Nachbesserung.** Die Redaktion übernimmt eine Änderung nur
mit höherer `folge`. Werden Bildtexte und Kommentare an den bestehenden 175
Funden nachgetragen, ohne dass ihre `folge` steigt, kommt davon nichts an.
Und es eilt: Offene Funde verfallen bei der Redaktion nach 14 Tagen, die vom
12.11. also mit dem Abruf vom **26.11.2026**. Danach wird eine Nachlieferung
zu diesen Funden für immer ignoriert.

### M5 — Der Sammellauf läuft nicht durch (2, 3.2, 3.5)

**Befund.**

- Freigaben mit Inhalt gab es am 12.11. und am 15.11. (2 Funde). Am 13., 14. und 16.11. kam nichts Neues.
- Am 15.11. standen 8 von 11 Facebook-Gruppen in `quellen_offen` mit
  `lauf_nicht_fertig`, am 16.11. alle 11.
- Am 16.11. melden alle 20 Quellen `stand: nicht_versucht`, mit
  `n_beitraege_gesehen: null`, `fehler_seit: null` und leerem
  `letzter_fehler`.
- `freigabe.sammellauf_begonnen_am` und `sammellauf_beendet_am` sind `null`.

**Verlangt.**

- Der Lauf startet täglich und wird fertig; sonst sagt die Tür, weshalb.
  Eine Quelle, die mehrere Tage nicht gelesen wurde, trägt `fehler_seit` und
  `letzter_fehler`.
- `sammellauf_begonnen_am` und `sammellauf_beendet_am` sind gesetzt, sobald
  ein Lauf stattfand.
- Die 9 Instagram-Hashtags stehen nicht in `quellen_offen`, obwohl sie nicht
  gelesen wurden: Jede nicht fertig gelesene Quelle gehört dorthin.

### M6 — Angaben zum Beitrag fehlen (4.2, 4.3, 4.6)

| Feld                  | Befund                                  | Verlangt                                                                                                 |
| --------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `quelle_sichtbarkeit` | alle 11 Facebook-Gruppen `unbekannt`    | `oeffentlich` oder `geschlossen`. Bei `unbekannt` verlinkt die Redaktion nie den Beitrag, nur die Gruppe |
| `autor_vorname`       | bei allen 175 `null`                    | der Vorname, wo die Plattform einen Namen zeigt                                                          |
| `autor_art`           | bei allen 175 `unbekannt`               | `person`, `seite` oder `organisation`                                                                    |
| `veroeffentlicht_am`  | bei 84 von 104 Facebook-Funden `null`   | der Zeitpunkt, mindestens der Tag mit `datum_genauigkeit`                                                |
| `verlinkt`            | Facebook nie; Instagram 7× ohne `titel` | Links aus Facebook-Beiträgen samt Titel der Vorschau                                                     |
| `geteilt`             | bei allen `null`                        | der geteilte Beitrag samt Text und Bildern, wo einer geteilt wird                                        |

## Lücken im Vertrag, die wir schliessen wollen

Die heutige Lieferung ist formal gültig, obwohl sie den Zweck verfehlt. Vier
Präzisierungen, die wir in den Vertrag aufnehmen, sobald ihr sie bestätigt:

1. `bilder: []` zusammen mit `n_bilder: null` ist nur zulässig, wenn die
   Plattform die Bilder des Beitrags nachweislich nicht zeigt; bei Instagram
   nie.
2. Ein sichtbarer Kommentar mit leerem `text`, ohne Bild und ohne Link, ist
   ungültig.
3. `kommentare_stand: unbekannt` ist nur in der ersten Freigabe eines Funds
   zulässig, danach `vollstaendig` oder `teilweise` mit Zahl.
4. Regel 1.1 wird nach dem Bildlesen angewandt, und Bedingung 2 wird wie in
   M2 verschärft.

## Woran wir die Nachbesserung messen

Die Redaktion fragt die Tür nach eurer Meldung erneut ab und prüft:

- [ ] Jeder Instagram-Fund trägt mindestens einen Eintrag in `bilder`.
- [ ] Mindestens ein Facebook-Fund trägt ein Bild mit `text_status: gelesen`
      und dem Text des Flyers in `bilder[].text`.
- [ ] Kein gelieferter Kommentar hat leeren Text ohne Bild und Link.
- [ ] Mindestens ein Fund trägt mehr als 6 Kommentare, und mindestens einer
      `kommentare_stand: vollstaendig`.
- [ ] Instagram-Funde mit `n_kommentare` grösser als 0 tragen Kommentare.
- [ ] `n_aussortiert` ist bei mindestens einer Quelle grösser als 0.
- [ ] Mindestens ein Fund kommt mit `aenderung` ungleich `["neu"]`.
- [ ] Die bestehenden 175 Funde kommen mit höherer `folge` neu, vor dem
      26.11.2026.
- [ ] `sammellauf_beendet_am` ist gesetzt, `quellen_offen` an einem normalen
      Tag leer.
- [ ] Keine Facebook-Gruppe trägt `quelle_sichtbarkeit: unbekannt`.
