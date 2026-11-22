# Buschtelefon: Sichtbarkeit der Facebook-Gruppen und abgelaufene Anmeldung

Stand: 22. November 2026. Gemessen am Produktionsstand der Redaktion
(letzte Freigabe des Buschtelefons: 21. November 2026, 11:55 Uhr, `folge` 339).
Bezug: `apps/directus/BUSCHTELEFON_SCHNITTSTELLE.md`, Format
`buschtelefon-redaktion/2`.

## Worum es geht

Zwei Fehler machen den Facebook-Teil des Buschtelefon-Tischs zurzeit
unbrauchbar. Beide entstehen im Buschtelefon und lassen sich nur dort beheben;
die Redaktion liest Facebook nie selbst.

1. **Alle elf Facebook-Gruppen kommen mit Sichtbarkeit `unbekannt` an**, auch
   öffentliche. Der Tisch behandelt `unbekannt` vertragsgemäss wie
   geschlossen. Folge: Jede Meldung aus Facebook verlinkt nur die Gruppe statt
   den Beitrag, und jeder Fund trägt eine Warnung.
2. **Seit dem 17. November 2026 wird keine Facebook-Gruppe mehr gelesen**
   («Anmeldung abgelaufen»). Seit dem 15. November ist kein neuer
   Facebook-Beitrag mehr geliefert worden.

## Was zu tun ist

| Nr. | Aufgabe                                                                                       | Wo           |
| --- | --------------------------------------------------------------------------------------------- | ------------ |
| 1   | Sichtbarkeit jeder Gruppe bestimmen und als `oeffentlich` oder `geschlossen` liefern          | Buschtelefon |
| 2   | Die bereits gelieferten, noch beobachteten Funde mit der richtigen Sichtbarkeit neu freigeben | Buschtelefon |
| 3   | Facebook-Konto neu anmelden                                                                   | Buschtelefon |
| 4   | Dafür sorgen, dass eine abgelaufene Anmeldung am ersten Tag auffällt                          | Buschtelefon |

Auf der Seite der Redaktion ist dafür nichts umzubauen: Sobald die
Sichtbarkeit richtig geliefert wird, verlinken die Meldungen von selbst den
Beitrag (siehe «Was danach auf dem Tisch passiert»).

## Fehler 1: Sichtbarkeit `unbekannt`

### Befund

- `/v2/quellen` liefert für alle elf Quellen der Art `gruppe` das Feld
  `sichtbarkeit: "unbekannt"`.
- Alle 104 gelieferten Facebook-Funde tragen `quelle_sichtbarkeit:
"unbekannt"`. Das gilt auch für die 102 Funde vom 12. November, als das
  Lesen noch funktionierte. Der Fehler hängt also nicht an der abgelaufenen
  Anmeldung.
- Die Instagram-Quellen kommen richtig als `oeffentlich`.
- Mindestens eine Gruppe ist nachweislich öffentlich: «Du bisch vo Aesch BL,
  wenn du..» (`fb-gruppe:622296567819515`). Der Beitrag
  `https://www.facebook.com/groups/622296567819515/posts/28772843142338147`
  lässt sich ohne Beitritt öffnen.

### Was der Vertrag verlangt

- Abschnitt 3.5: `sichtbarkeit` ist `oeffentlich`, `geschlossen` oder
  `unbekannt` und wird **bei jedem Lesen neu bestimmt**.
- Abschnitt 4.2: `quelle_sichtbarkeit` am Fund ist der Stand zum Zeitpunkt der
  Freigabe.
- Abschnitt 7, Punkt 7: `sichtbarkeit` wird **an der Quelle gepflegt**.

`unbekannt` ist als Ausnahme gedacht, wenn das Bestimmen einmal scheitert. Als
Dauerwert für alle Gruppen hebelt es die Regel der Redaktion aus: Bei einer
öffentlichen Gruppe verlinkt die Meldung den Beitrag, bei einer geschlossenen
nur die Gruppe.

### Behebung

Die Sichtbarkeit ist eine Eigenschaft der Gruppe, die Facebook selbst
ausweist («Öffentliche Gruppe» / «Private Gruppe» im Kopf und auf der
Info-Seite der Gruppe). Zwei Wege, einzeln oder zusammen:

- **Beim Lesen bestimmen.** Beim Sammellauf die Angabe der Gruppenseite
  auslesen. Als Gegenprobe taugt ein Abruf der Gruppe ohne Anmeldung: Sind
  Beiträge sichtbar, ist die Gruppe öffentlich.
- **An der Quelle pflegen.** Die Sichtbarkeit je Gruppe einmal von Hand
  eintragen und beim Lesen nur noch überprüfen. Der Vertrag erlaubt das
  ausdrücklich (Abschnitt 7, Punkt 7). Bei elf Gruppen ist das der schnellste
  Weg.

`unbekannt` soll danach nur noch erscheinen, wenn die Bestimmung in einem
einzelnen Lauf wirklich scheitert. Sinnvoll ist, in diesem Fall den zuletzt
bekannten Wert der Quelle zu behalten statt auf `unbekannt` zurückzufallen.

### Bereits gelieferte Funde nachziehen

Die Redaktion übernimmt eine geänderte Sichtbarkeit nur, wenn der Fund mit
einer neuen `folge` kommt. Nach Abschnitt 3.1 gehört `quelle_sichtbarkeit` zur
Änderungsart `herkunft` und löst eine neue `folge` aus.

Bitte deshalb die Funde der elf Gruppen, die noch aktiv sind, einmal mit
`aenderung: ["herkunft"]` und dem richtigen Wert neu freigeben. Ohne diesen
Schritt bleiben die 104 vorhandenen Funde auf `unbekannt`, auch wenn die
Quelle selbst schon richtig steht.

### Die elf Gruppen

Die Spalte «Sichtbarkeit» ist auszufüllen; bekannt ist bisher nur Aesch.

| Kennung                      | Name                                            | Sichtbarkeit |
| ---------------------------- | ----------------------------------------------- | ------------ |
| `fb-gruppe:622296567819515`  | Du bisch vo Aesch BL, wenn du..                 | öffentlich   |
| `fb-gruppe:186467821526995`  | Du kommst aus Allschwil wenn...                 |              |
| `fb-gruppe:222184897987345`  | Du weisch, dass de vo Arlesheim bisch, wenn.... |              |
| `fb-gruppe:1067594350016601` | Du bisch vo Binnige wenn..                      |              |
| `fb-gruppe:593128957442872`  | Du bisch vo Bottmigge wenn ....                 |              |
| `fb-gruppe:1454622208088344` | Du bisch e richtige Münchesteiner wenn du...    |              |
| `fb-gruppe:285471636073534`  | Du bisch vo Muttenz wenn de...                  |              |
| `fb-gruppe:1596744020394393` | Du bisch fo Prattele                            |              |
| `fb-gruppe:656764641048237`  | Du bisch vo Rynach (BL) wenn.....               |              |
| `fb-gruppe:2665218557113476` | Du weisch, dass Rieche läbbt...                 |              |
| `fb-gruppe:228260574890980`  | Gärngschee - Basel hilft                        |              |

## Fehler 2: Anmeldung abgelaufen

### Befund

- Alle elf Gruppen: `fehler_seit: 2026-11-17T10:00:05+01:00`,
  `letzter_fehler: "Anmeldung abgelaufen"`, `stand: "nicht_versucht"`.
- Zuletzt vollständig gelesen: je nach Gruppe am 12. oder am 15. November
  (am 15. November unter anderem Allschwil, Münchenstein und Reinach).
- Gelieferte Facebook-Funde: 102 am 12. November, 2 am 15. November, seither
  keiner.
- Die Freigabe vom 21. November führt alle elf unter `quellen_offen` mit
  `grund: "fehler"`. Die Meldung an die Redaktion funktioniert also; es hat
  nur fünf Tage lang niemand darauf reagiert.

### Behebung

- **Sofort:** Das Facebook-Konto des Buschtelefons neu anmelden und einen
  Sammellauf auslösen. Beiträge, die beim ersten Sehen höchstens 14 Tage alt
  sind, werden noch geliefert (Abschnitt 4.8); was älter ist, zählt als
  `n_zu_alt`. Je länger es dauert, desto mehr geht verloren.
- **Dauerhaft:** Eine abgelaufene Anmeldung betrifft immer alle Gruppen
  zugleich und ist kein Fehler einer einzelnen Quelle. Sie sollte im
  Buschtelefon am selben Tag eine Benachrichtigung an eine Person auslösen.
  Der Tisch der Redaktion zeigt den Ausfall zwar an («11 Quellen nicht
  vollständig gelesen»), aber dort kann ihn niemand beheben.

## Was danach auf dem Tisch passiert

- Die Quellenliste der Redaktion übernimmt die neue Sichtbarkeit beim nächsten
  Abruf (täglich 12 Uhr).
- Ein noch **unentschiedener** Fund, der mit neuer `folge` kommt, wird
  ersetzt und neu gesichtet. Die Warnung «Sichtbarkeit der Gruppe unbekannt»
  verschwindet, und eine Meldung daraus verlinkt bei einer öffentlichen Gruppe
  den Beitrag.
- Ein bereits **entschiedener** Fund bleibt, wie er beim Entscheid war. Das
  betrifft zurzeit sechs Facebook-Funde (fünf abgelehnt, einer übernommen und
  publiziert).
- Offene Funde verfallen 14 Tage nach ihrer Freigabe. Die 102 Funde vom 12. November verfallen am 26. November. Kommen sie vorher mit neuer `folge`,
  bleiben sie mit der richtigen Sichtbarkeit auf dem Tisch.

## Daneben gemessen

Zwei weitere Auffälligkeiten an den Facebook-Funden. Sie sind nicht der Anlass
dieses Dokuments, mindern aber den Wert der Funde:

- **Datum unbekannt bei 84 von 104 Funden** (`datum_genauigkeit: unbekannt`).
  Die Quellenzeile einer Meldung kann dann keinen Tag nennen, und die Sichtung
  kann nicht einschätzen, wie aktuell ein Beitrag ist.
- **Kommentarstand unbekannt bei 79 von 104 Funden**, `n_kommentare` ist bei
  allen 104 `null`. Bei 25 weiteren sind die Kommentare nur teilweise gelesen.

## Prüfen, ob es behoben ist

- [ ] `/v2/quellen` zeigt für keine der elf Gruppen mehr `unbekannt`.
- [ ] Die Aescher Gruppe steht auf `oeffentlich`.
- [ ] Der Fund `fb:622296567819515_28772843142338147` («Oranges Velo zwischen
      Aesch und Duggigen») kommt mit neuer `folge`,
      `aenderung: ["herkunft"]` und `quelle_sichtbarkeit: "oeffentlich"`.
- [ ] Alle elf Gruppen zeigen `stand: "gelesen"`, `fehler_seit: null` und ein
      `zuletzt_vollstaendig_gelesen_am` vom Tag der Freigabe.
- [ ] `freigabe.quellen_offen` ist leer.
- [ ] Auf dem Tisch der Redaktion steht keine Zeile «Quellen nicht vollständig
      gelesen» mehr.
