# Buschtelefon → Redaktion: Vertrag und Umsetzungshinweise

**Stand: Fassung 5 vom 11. November 2026** (nach einer Gegenprüfung aus vier
Blickwinkeln: Protokoll, Personendaten, Passung zur Redaktion, Sicht der
Buschtelefon-Entwicklung, und einer Durchsicht gegen den gebauten Leser der
Redaktion. Fassung 5 legt fest, welche Felder keine neue `folge` auslösen
(3.1), welcher entfernte Beitrag zurückkommen darf (4.9), in welcher
Reihenfolge Kommentare stehen (4.7) und was bei unbekanntem Datum,
fehlender Kennung und vor der ersten Freigabe gilt). Geschrieben für die
Entwicklung des Buschtelefons. Es beschreibt, was die Redaktion
(`data_to_hyperlocal`) von der Übergabetür braucht und was dafür am
Buschtelefon zu ändern ist.

Format-Kennung: **`buschtelefon-redaktion/2`**. Sie ersetzt
`buschtelefon-redaktion/1` (`/api/redaktion/v1/funde`). Niemand liest v1
produktiv — der Abnehmer aus PR #40 wurde nie gemergt —, v1 darf wegfallen,
sobald v2 steht.

Die Redaktion hat am 11. November 2026 entschieden, was in den Entwürfen
offen war (Abschnitt 9). Offen ist noch ein Punkt, mit **[OFFEN]** markiert;
er hält den Bau nicht auf.

## 1. Wer macht was

| Aufgabe                                                         | Wer          |
| --------------------------------------------------------------- | ------------ |
| Quellen lesen (Facebook-Gruppen, später Instagram, TikTok)      | Buschtelefon |
| Rohmaterial möglichst vollständig aufbereiten, samt Kommentaren | Buschtelefon |
| Text in Bildern lesen (Flyer, Screenshots, Text-Kacheln)        | Buschtelefon |
| Quelle den Gemeinden zuordnen                                   | Buschtelefon |
| Einmal am Tag einen festen Stand freigeben                      | Buschtelefon |
| Einmal am Tag abholen                                           | Redaktion    |
| Sichten und einschätzen («weshalb könnte das relevant sein?»)   | Redaktion    |
| Meldung vorformulieren, prüfen, publizieren                     | Redaktion    |
| Als Recherche-Hinweis an die Chefredaktion geben                | Redaktion    |
| Absolut Unbrauchbares aussortieren und zählen (1.1)             | Buschtelefon |
| Auswählen, was relevant ist                                     | Redaktion    |

Das Buschtelefon liefert **Rohmaterial und Tatsachen**, kein Urteil: keine
Relevanz-Einschätzung, keinen Meldungsentwurf. Die Redaktion sichtet mit
eigenen Regeln, die aus den Entscheiden am Tisch lernen; ein zweites Urteil
von aussen liesse sich weder lernen noch messen.

### 1.1 Was das Buschtelefon aussortiert — und nur das

Aussortiert wird ausschliesslich, was **keinen Inhalt** trägt. Ein Beitrag
wird nicht geliefert, wenn **alle** Bedingungen zutreffen:

1. der eigene Text hat, ohne Emojis, Satzzeichen und Leerraum, **weniger als
   zwei Wörter** (leer, ein Wort, nur Emojis);
2. **kein Bild trägt gelesenen Text** (jedes Bild ist `kein_text`; ein Bild
   mit `nicht_lesbar`, `nicht_versucht` oder `zurueckgehalten` zählt als
   möglicher Inhalt, der Beitrag wird geliefert);
3. er trägt **keinen Link** (`verlinkt` leer) und **teilt keinen Beitrag**
   (`geteilt` ist `null`);
4. **aus den Kommentaren geht nicht hervor, worum es geht**: es sind weniger
   als fünf, oder sie tragen zusammen weniger als vierzig Wörter.

Das sind der Beitrag mit einem Wort, der mit einem Emoji und das Foto ohne
jeden Text — das Bild einer Katze mit drei «süss!» darunter bringt nichts
und verbraucht nur Ressourcen. Das Foto der überschwemmten Unterführung,
unter dem dreissig Leute schreiben, was los ist, kommt dagegen an. Alles
andere kommt ohnehin an, auch das Belanglose — ob es etwas taugt, entscheidet
die Redaktion. Es ist eine Regel des Codes, kein Urteil eines Modells; die
zwei Zahlen in Bedingung 4 darf das Buschtelefon nach den ersten Wochen mit
der Redaktion nachstellen.

Aussortiertes verschwindet nicht still: `/quellen` nennt je Quelle
`n_aussortiert` (3.5). Wird ein aussortierter Beitrag später brauchbar (der
Text wird ergänzt, ein Bildtext nachgelesen), kommt er als neuer Fund.

Nie über die Tür gehören ausserdem: Direktnachrichten, Mitgliederlisten,
Profilangaben, Profilbilder, Namen der Reagierenden, Stories — und
zurückgezogene Inhalte (4.9).

## 2. Der Tagesablauf

```
11:00       Buschtelefon startet den Sammellauf des Tages
ca. 11:50   der Lauf ist fertig → EIN Freigabeschritt vergleicht das
            Gesammelte mit dem zuletzt freigegebenen Stand und stempelt, was
            neu ist oder sich geändert hat. Spätestens 11:55, dann ohne die
            Quellen, die noch laufen
12:00       Redaktion holt ab (13:00 und 14:00 als kostenlose Nachläufe)
```

Vier Regeln daraus:

1. **Die Freigabe hängt am Ende des Laufs, nicht an der Uhr.** Sie vergleicht
   nur Funde aus Quellen, deren Lesen in diesem Lauf **vollständig**
   abgeschlossen wurde. Jede andere Quelle behält ihren letzten
   freigegebenen Stand und wird in `freigabe.quellen_offen` genannt.
2. **Höchstens eine Freigabe je Kalendertag** (Europe/Zurich), und sie findet
   **jeden Tag** statt, auch wenn sich nichts geändert hat — dann rückt
   `freigegeben_am` vor und `folge` nicht. Ein stiller Tag und eine
   ausgefallene Freigabe sehen so verschieden aus.
3. **Zwischen zwei Freigaben antwortet die Tür immer gleich.** Auch Zähler
   werden nur im Freigabeschritt nachgeführt. Was um 14:00 gesammelt wird,
   erscheint morgen. Ein Beitrag ändert sich für die Redaktion also
   höchstens einmal am Tag.
4. Eine ausgefallene Freigabe wird am Folgetag mitgeliefert, nie als zweite
   am selben Tag nachgeholt.

Dauert der Facebook-Lauf länger als 50 Minuten (siehe 4.8, das Nachlesen
kostet Zeit), startet er früher; die Redaktion bleibt bei 12:00.

## 3. Die Tür

```
GET {BUSCHTELEFON_URL}/api/redaktion/v2/funde?nach=<folge>&limit=<n>
GET {BUSCHTELEFON_URL}/api/redaktion/v2/quellen
```

Zugang unverändert: Cloudflare-Access-Dienst-Token (`CF-Access-Client-Id`,
`CF-Access-Client-Secret`) und `Authorization: Bearer <Schlüssel>`. Nur
`GET`. Es gibt **keinen Filter** nach Kanal oder Gemeinde: ein Lesezeichen,
ein Abruf — ein Filter auf einer Liste mit einem einzigen Lesezeichen
überspringt, was er ausblendet.

### 3.1 Das Lesezeichen: `folge`

v1 blättert über den Zeitstempel `erfasst_am`. Ein ganzer Lauf trägt
denselben Stempel; liegen mehr Funde darauf als `limit`, bleibt der Leser
für immer stehen. Und neue Kommentare bewegen den Stempel nicht, sind also
unsichtbar. Beides behebt eine Zahl:

- **`folge`** ist eine ganze Zahl, **eindeutig über alle Funde und streng
  aufsteigend**. Jeder Fund trägt die `folge` seiner **letzten freigegebenen
  Änderung** (die Neuaufnahme zählt als Änderung).
- `?nach=<folge>` liefert alles mit `folge > nach`, **aufsteigend nach
  `folge`**, höchstens `limit` Einträge (Standard 200, Maximum 500).
- Ohne `nach`: alles, was die Tür vorhält (3.4), von vorn.
- Ein Fund steht in der Liste **genau einmal**, unter seiner aktuellen
  `folge`. Ändert er sich, wandert er ans Ende.
- Die Redaktion merkt sich die höchste verarbeitete `folge` selbst — nur aus
  `weiter` oder aus gelieferten Einträgen, nie aus der eigenen Uhr. Ein
  älteres `nach` liefert erneut; das ist der Weg, einen Verlust nachzuholen,
  und kostet nichts, weil die Redaktion auf `kennung` zusammenführt.

**Umsetzungshinweis (der eine Punkt, der schiefgehen kann):** Die `folge`
wird **nicht beim Sammeln** vergeben, sondern **nur im Freigabeschritt, von
einem einzigen Schreiber, in einer Transaktion**. Eine Datenbank-Sequenz,
die parallele Sammelläufe beim Einfügen ziehen, vergibt Nummern in der
Reihenfolge des Einfügens; sichtbar werden sie in der Reihenfolge des
Commits. Ein Leser, der dazwischen bei 1'040 steht, überspringt die 1'038,
die erst danach sichtbar wird.

**Was eine neue `folge` auslöst.** Verglichen wird ein Fingerabdruck über
**alle Felder des Fundes** in normalisierter Form (Unicode NFC, Leerraum
zusammengefasst, Zeilenenden vereinheitlicht — verglichen wird die
normalisierte Form, geliefert der Wortlaut), **ausser**:

- `folge`, `geaendert_am`, `aenderung`, `kommentare_geprueft_am`,
  `beobachtet_bis`
- allen Zählern `n_…`, wo sie auch stehen: `n_reaktionen`, `n_geteilt`,
  `n_kommentare`, `n_bilder` (auch am Geteilten), `kommentare[].n_reaktionen`
- `kommentare_stand` und `kommentare_fehlend` — sie folgen dem Zähler der
  Plattform: bei einem gedeckelten Beitrag mit 340 Kommentaren ginge
  `kommentare_fehlend` sonst jeden Tag von 40 auf 47 auf 52, und der Fund
  bekäme täglich eine neue `folge` mit derselben Liste
- `art` und `beschreibung` jedes Bildes, am Beitrag, am Geteilten und am
  Kommentar (ein Modell formuliert sie jeden Tag anders)
- Zeitpunkten, die aus einer relativen Angabe errechnet sind (4.3): sie
  werden beim **ersten** Sehen festgelegt und nie neu gerechnet
- `veroeffentlicht_am`, `datum_genauigkeit`, `veroeffentlicht_fruehestens`
  und `veroeffentlicht_spaetestens`, wenn ein **genauerer** Wert einen
  ungenaueren ersetzt (4.3) — an Beitrag, Geteiltem und Kommentar

Ausgenommene Felder werden mit jeder Freigabe nachgeführt, lösen aber keine
neue `folge` aus; die Redaktion sieht ihren neuen Wert mit der nächsten
Änderung des Fundes. Jede andere Abweichung vergibt eine neue `folge` und
nennt in `aenderung`, wo sie liegt — jedes Feld gehört zu genau einem Wert:

| `aenderung`  | Felder                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `text`       | `text`, `text_abgeschnitten`                                                                                                                                             |
| `bilder`     | `bilder[]` (Status, Text, Kürzung, ein Bild mehr oder weniger)                                                                                                           |
| `verlinkt`   | `verlinkt[]`                                                                                                                                                             |
| `geteilt`    | `geteilt` mit allem, was darin steht                                                                                                                                     |
| `kommentare` | `kommentare[]` mit allem, was darin steht                                                                                                                                |
| `herkunft`   | `kanal`, `quelle`, `quelle_name`, `quelle_art`, `quelle_sichtbarkeit`, `gemeinden_bfs`, `link`, Verfasser und Zeitpunkt des Beitrags (4.3), ausser der Verfeinerung oben |
| `doublette`  | `doublette_von`                                                                                                                                                          |
| `status`     | `status`, `entfernt_grund`                                                                                                                                               |
| `neu`        | die erste Lieferung in `funde` (auch nach `ausgelassen`, 3.2) und die Rückkehr eines entfernten Beitrags (4.9) — dann steht `neu` **allein**                             |

Ein Bildtext wird **einmal je Bild** gelesen und gespeichert (Schlüssel ist
die Prüfsumme der Bilddatei, nicht ihre Adresse — die Adressen des Bild-CDN
wechseln bei jedem Laden); neu gelesen wird nur, was `nicht_versucht` oder
`nicht_lesbar` war. Sonst bekäme jeder Bild-Beitrag jeden Tag eine neue
`folge`, weil dasselbe Bild zweimal gelesen selten Zeichen für Zeichen
gleich herauskommt.

### 3.2 Die Antwort

```json
{
  "format": "buschtelefon-redaktion/2",
  "freigabe": {
    "tag": "2026-11-11",
    "folge": 18422,
    "freigegeben_am": "2026-11-11T11:52:10+01:00",
    "sammellauf_begonnen_am": "2026-11-11T11:00:02+01:00",
    "sammellauf_beendet_am": "2026-11-11T11:51:40+01:00",
    "quellen_offen": [{ "quelle": "fb-gruppe:99", "grund": "fehler" }]
  },
  "funde": [ … ],
  "ausgelassen": [ … ],
  "weiter": 17650
}
```

| Feld                      | Bedeutung                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`                  | fest; die Redaktion verweigert jede andere Kennung                                                                                                              |
| `freigabe.tag`            | der Kalendertag (Europe/Zurich) der letzten abgeschlossenen Freigabe. Ist er nicht heute, holt die Redaktion nichts, sagt es am Tisch und kommt um 13:00 wieder |
| `freigabe.folge`          | höchste vergebene `folge`                                                                                                                                       |
| `freigabe.freigegeben_am` | rückt mit **jeder** abgeschlossenen Freigabe vor, auch ohne Änderung                                                                                            |
| `freigabe.sammellauf_*`   | der Lauf, aus dem diese Freigabe gebaut ist                                                                                                                     |
| `freigabe.quellen_offen`  | Quellen, die in dieser Freigabe **fehlen**: `grund` ist `lauf_nicht_fertig` \| `fehler`. Leer ist der Normalfall                                                |
| `funde`                   | siehe 4                                                                                                                                                         |
| `ausgelassen`             | siehe unten                                                                                                                                                     |
| `weiter`                  | die höchste `folge` dieser Seite über `funde` **und** `ausgelassen`, wenn es weitere gibt; sonst `null`. Die nächste Seite ist `?nach=<weiter>`                 |

**`ausgelassen`** sind Funde, die das Buschtelefon hat, aber nicht übergeben
kann. Je Eintrag `{kennung, folge, grund, quelle, kanal, gemeinden_bfs,
veroeffentlicht_am}`; `grund` ist `kein_link` | `keine_stabile_kennung`.
Bei `keine_stabile_kennung` ist `kennung` **`null`** — eine vorläufige
Kennung (etwa aus `pfbid`) wird auch hier nie geliefert (4.1); die Redaktion
zählt einen solchen Eintrag, kann ihn aber keinem Fund zuordnen. Bei
`kein_link` trägt der Eintrag die Kennung, die der Fund später in `funde`
trägt. Ein ausgelassener Fund trägt eine `folge` wie jeder andere, steht auf
der Seite, in deren Bereich sie fällt, und zählt gegen `limit`. Wird er
später lieferbar, ist das eine Änderung mit neuer `folge` und
`aenderung: ["neu"]`.
**Überlänge ist nie ein Auslassungsgrund:** es wird gekürzt und
gekennzeichnet. Leer ist der Normalfall; die Redaktion zeigt die Zahl je
Quelle.

### 3.3 Fehler

| Status | Wann                                   | Körper (immer JSON, immer mit `format`)                                                                                    |
| ------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `400`  | `nach` oder `limit` ungültig           | `{"fehler": "ungueltige_eingabe", "grund": "…"}`                                                                           |
| `401`  | Bearer-Schlüssel fehlt oder ist falsch | `{"fehler": "nicht_berechtigt"}`                                                                                           |
| `410`  | `nach < verworfen_bis` (3.4)           | `{"fehler": "stand_zu_alt", "verworfen_bis": n}`                                                                           |
| `503`  | Tür nicht bereit                       | `{"fehler": "nicht_bereit", "grund": "nicht_eingerichtet" \| "freigabe_laeuft"}` — bei `freigabe_laeuft` mit `Retry-After` |

Fehlertexte nennen nie Inhalte eines Beitrags und nie ein Geheimnis.
Während einer Freigabe antwortet die Tür mit dem alten Stand oder mit `503
freigabe_laeuft` — nie mit einem halben neuen. Zugriffsprotokolle der Tür
enthalten keine Inhalte.

**Vor der allerersten Freigabe** antworten `/funde` und `/quellen` mit `503`
und `"grund": "nicht_eingerichtet"`, genau wie eine Tür ohne eingerichteten
Schlüssel — nie mit `200` und einem `freigabe`-Objekt ohne `tag` oder
`folge`. Die Redaktion liest ein solches `200` als kaputte Antwort, nicht
als stillen Tag.

### 3.4 Vorhaltefenster

Die Tür hält jeden Fund **mindestens 30 Tage ab seiner letzten Änderung**
vor, Einträge mit `status: entfernt` **90 Tage**. Sie merkt sich
`verworfen_bis`, die höchste `folge`, die je aus dem Fenster fiel. `410`
gilt genau dann, wenn `nach < verworfen_bis`. Danach holt die Redaktion
einmal ohne `nach` und führt auf `kennung` zusammen; was sie an offenen
Funden hält und im vollen Abruf weder in `funde` noch in `ausgelassen`
vorkommt, leert sie (die Kennung behält sie, Abschnitt 8).

**Höchstens** hält das Buschtelefon Wortlaut, Kommentare und Bildtexte 90
Tage ab Veröffentlichung (ohne bekanntes Datum gerechnet wie
`beobachtet_bis`, 4.8). **Die `kennung` behält es für immer** (4.8): sie
ist, was verhindert, dass ein alter Beitrag ein zweites Mal als neu
ankommt.

### 3.5 `GET …/v2/quellen`

Die Redaktion muss sagen können, **welche Quelle heute nicht oder nur halb
gelesen wurde** — eine stille Gruppe und eine, an der das Sammeln seit drei
Tagen scheitert, sehen sonst gleich aus. `/quellen` beschreibt den
Sammellauf, aus dem die aktuelle Freigabe gebaut wurde, trägt dasselbe
`freigabe`-Objekt und ändert sich wie `/funde` nur mit der Freigabe.

```json
{
  "format": "buschtelefon-redaktion/2",
  "freigabe": { … },
  "quellen": [
    {
      "kennung": "fb-gruppe:1234567890",
      "kanal": "facebook",
      "art": "gruppe",
      "name": "Du bisch vo Aesch, wenn …",
      "url": "https://www.facebook.com/groups/1234567890",
      "sichtbarkeit": "oeffentlich",
      "zugang": "ohne_anmeldung",
      "gemeinden_bfs": [2761],
      "aktiv": true,
      "stand": "gelesen",
      "zuletzt_vollstaendig_gelesen_am": "2026-11-11T11:12:00+01:00",
      "gelesen_zurueck_bis": "2026-11-09T08:00:00+01:00",
      "n_beitraege_gesehen": 14,
      "n_aussortiert": 3,
      "n_zu_alt": 1,
      "fehler_seit": null,
      "letzter_fehler": null,
      "hinweise": []
    }
  ]
}
```

| Feld                  | Regel                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `art`                 | `gruppe` \| `seite` \| `konto` \| `hashtag` \| `rundgang`. Ein **Personenprofil ist nie eine Quelle**; `konto` ist das Konto einer Organisation |
| `sichtbarkeit`        | `oeffentlich` \| `geschlossen` \| `unbekannt`, bei jedem Lesen neu bestimmt                                                                     |
| `zugang`              | `ohne_anmeldung` \| `mitgliedskonto` — wie das Buschtelefon liest                                                                               |
| `gemeinden_bfs`       | siehe 4.2                                                                                                                                       |
| `stand`               | `gelesen` \| `teilweise` \| `fehlgeschlagen` \| `nicht_versucht` — im Lauf dieser Freigabe                                                      |
| `gelesen_zurueck_bis` | Zeitpunkt des ältesten Beitrags, den der Lauf im Feed gesehen hat: die Tiefe des Lesens                                                         |
| `n_aussortiert`       | wie viele Beiträge dieses Laufs nach 1.1 nicht geliefert wurden                                                                                 |
| `n_zu_alt`            | wie viele erstmals gesehene Beiträge älter waren als das Aufnahmefenster (4.8) und darum nicht geliefert wurden                                 |
| `fehler_seit`         | erster Fehlschlag der laufenden Serie, sonst `null`                                                                                             |
| `letzter_fehler`      | kurzer Grund in Worten («Anmeldung abgelaufen»), `null` wenn der letzte Versuch gelang                                                          |
| `hinweise`            | string[], z. B. «Kommentare bei 4 Beiträgen nicht aufklappbar»                                                                                  |

Eine Quelle wird **nie aus der Liste entfernt**, nur auf `aktiv: false`
gesetzt.

## 4. Ein Fund

Ein Fund ist **ein Beitrag** (Post) mit allem, was an ihm hängt.

```json
{
  "kennung": "fb:1234567890_987654321",
  "folge": 17650,
  "status": "aktiv",
  "erstmals_freigegeben_am": "2026-11-09T11:51:55+01:00",
  "geaendert_am": "2026-11-11T11:52:10+01:00",
  "aenderung": ["kommentare"],
  "beobachtet_bis": "2026-11-22",

  "kanal": "facebook",
  "quelle": "fb-gruppe:1234567890",
  "quelle_name": "Du bisch vo Aesch, wenn …",
  "quelle_art": "gruppe",
  "quelle_sichtbarkeit": "oeffentlich",
  "gemeinden_bfs": [2761],
  "link": "https://www.facebook.com/groups/1234567890/posts/987654321",

  "veroeffentlicht_am": "2026-11-08T19:42:00+01:00",
  "datum_genauigkeit": "minute",

  "autor_art": "profil",
  "autor_rolle": null,
  "autor_name": null,
  "autor_vorname": "Sandra",
  "autor_ref": "A",

  "text": "Weiss jemand, warum die Hauptstrasse seit heute gesperrt ist? …",
  "text_abgeschnitten": false,

  "bilder": [
    {
      "nr": 1,
      "art": "flyer",
      "text_status": "gelesen",
      "text": "Räbeliechtli-Umzug\nFreitag, 13. November 2026, 18 Uhr\nBesammlung Schulhaus Neumatt",
      "text_abgeschnitten": false,
      "beschreibung": "Flyer mit Laternen-Zeichnung"
    }
  ],
  "n_bilder": 1,

  "verlinkt": [
    {
      "url": "https://www.aesch.bl.ch/…",
      "kurzlink": false,
      "titel": "Baustelleninfo Hauptstrasse",
      "text_status": "nicht_versucht",
      "text": null,
      "text_abgeschnitten": false
    }
  ],
  "geteilt": null,

  "kommentare": [
    {
      "kennung": "k:9f3a…",
      "kennung_art": "plattform",
      "stand": "sichtbar",
      "erstmals_freigegeben_am": "2026-11-09T11:51:55+01:00",
      "antwort_auf": null,
      "autor_ref": "B",
      "autor_art": "profil",
      "autor_rolle": null,
      "autor_name": null,
      "autor_vorname": "Marc",
      "veroeffentlicht_am": "2026-11-08T20:01:00+01:00",
      "datum_genauigkeit": "minute",
      "text": "Wasserleitungsbruch, die IWB ist dran.",
      "text_abgeschnitten": false,
      "bilder": [],
      "n_reaktionen": 4
    }
  ],
  "kommentare_stand": "vollstaendig",
  "kommentare_fehlend": 0,
  "kommentare_geprueft_am": "2026-11-11T11:20:00+01:00",
  "n_kommentare": 1,
  "n_reaktionen": 12,
  "n_geteilt": 0,

  "doublette_von": null
}
```

Die Pflicht-Angaben der folgenden Tabellen gelten für `status: aktiv` und
`nicht_erreichbar`. Für `entfernt` gilt 4.9.

### 4.1 Identität und Stand

| Feld                      | Typ         | Pflicht | Regel                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ----------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kennung`                 | string ≤ 64 | ja      | stabil für immer; derselbe Beitrag bekommt nie eine zweite. Bei Facebook aus der **numerischen** Beitrags-Kennung (`fb:<gruppe>_<beitrag>`); siehe unten                                                                                                                                                             |
| `folge`                   | integer     | ja      | 3.1                                                                                                                                                                                                                                                                                                                  |
| `status`                  | enum        | ja      | `aktiv` \| `nicht_erreichbar` \| `entfernt` (4.9)                                                                                                                                                                                                                                                                    |
| `erstmals_freigegeben_am` | Zeitpunkt   | ja      | ändert sich nie, auch nicht, wenn ein entfernter Beitrag zurückkommt (4.9)                                                                                                                                                                                                                                           |
| `geaendert_am`            | Zeitpunkt   | ja      | Zeitpunkt der Freigabe, die die aktuelle `folge` vergab                                                                                                                                                                                                                                                              |
| `aenderung`               | string[]    | ja      | was sich gegenüber dem **vorher freigegebenen** Stand geändert hat: `neu`, `text`, `kommentare`, `bilder`, `verlinkt`, `geteilt`, `herkunft` (Quelle, Gemeinden, Link, Sichtbarkeit, Verfasser), `doublette`, `status` — welches Feld zu welchem Wert gehört, steht in 3.1. Bei der ersten Lieferung genau `["neu"]` |
| `beobachtet_bis`          | Datum       | ja      | nie `null`. Bis und mit diesem Tag prüft das Buschtelefon auf neue Kommentare (4.8, dort auch die Rechnung bei ungenauem oder unbekanntem Datum). Danach kommen keine neuen Kommentare mehr; `entfernt` (der Beitrag oder ein Kommentar) und ein nachgelieferter Bildtext bleiben möglich                            |

**Kennung stabil machen.** Facebook zeigt Beitragslinks als `/posts/<Zahl>`,
`/permalink/<Zahl>` oder als undurchsichtiges `pfbid…`, und mehrere `pfbid`
führen zum selben Beitrag. Das Buschtelefon löst `pfbid` über den Permalink
zur numerischen Kennung auf. Gelingt das nicht, steht der Fund in
`ausgelassen` (`keine_stabile_kennung`) — nie mit einer vorläufigen Kennung
in `funde`. Die `kennung` enthält nie die Konto-Kennung einer Privatperson.

**Alle Zeitpunkte** sind ISO 8601 **mit Zeitzonenversatz**
(`2026-11-08T19:42:00+01:00`). In v1 kam ein Beitrag vom 8. November als
`2026-11-08T00:00:00+01:00`; in UTC gespeichert und auf den Tag gekürzt
wurde daraus der 7. November.

### 4.2 Herkunft

| Feld                  | Typ           | Pflicht | Regel                                                                                                                                                                   |
| --------------------- | ------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kanal`               | enum          | ja      | `facebook` \| `instagram` \| `tiktok`                                                                                                                                   |
| `quelle`              | string ≤ 100  | ja      | die `kennung` der Quelle aus `/quellen`                                                                                                                                 |
| `quelle_name`         | string ≤ 255  | ja      | Name der Gruppe / Seite, wie die Plattform ihn zeigt                                                                                                                    |
| `quelle_art`          | enum          | ja      | wie in 3.5                                                                                                                                                              |
| `quelle_sichtbarkeit` | enum          | ja      | `oeffentlich` \| `geschlossen` \| `unbekannt`, zum Zeitpunkt der Freigabe. Der Fund ist eine Momentaufnahme; die Redaktion soll dafür nicht `/quellen` fragen müssen    |
| `gemeinden_bfs`       | integer[]     | ja      | die **BFS-Nummern** der Gemeinden, denen die **Quelle** zugeordnet ist — eine, mehrere («Birseck», «Leimental») oder keine (`[]`). Kein Slug, kein Name                 |
| `link`                | string ≤ 2000 | ja      | **Permalink auf den Original-Beitrag**, `https://…`. Das ist der entscheidende Link: er steht immer am Tisch und beim Recherche-Hinweis. Ohne Permalink → `ausgelassen` |

Das Buschtelefon ordnet **keinen einzelnen Beitrag nach Inhalt** zu. Ob ein
Beitrag aus der Aescher Gruppe, der von Reinach handelt, zusätzlich auf dem
Reinacher Tisch erscheint, entscheidet die Redaktion mit ihrem eigenen
Namensabgleich. Die BFS-Nummern der bespielten Gemeinden liefert
`GET https://redaktion-admin.apps.bajour.ch/api/v1/gemeinden` (`bfs_nummer`).
Quellen nicht bespielter Gemeinden dürfen geliefert werden; die Redaktion
zeigt sie ohne Gemeinde.

### 4.3 Zeit und Autor

| Feld                                                         | Typ               | Pflicht         | Regel                                                                                                                                                                                              |
| ------------------------------------------------------------ | ----------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `veroeffentlicht_am`                                         | Zeitpunkt \| null | ja              | wann der Beitrag erschien                                                                                                                                                                          |
| `datum_genauigkeit`                                          | enum              | ja              | `minute` \| `stunde` \| `tag` \| `ungefaehr` \| `unbekannt`                                                                                                                                        |
| `veroeffentlicht_fruehestens`, `veroeffentlicht_spaetestens` | Zeitpunkt         | bei `ungefaehr` | die Grenzen («2 Wo.»). Die Redaktion druckt einen Tag nur, wenn beide auf denselben Kalendertag fallen                                                                                             |
| `autor_art`                                                  | enum              | ja              | `profil` \| `seite` \| `anonym` \| `unbekannt` — was die Plattform zeigt, kein Urteil. Ein Personenprofil ist `profil`, auch wenn die Person ein Amt hat                                           |
| `autor_rolle`                                                | enum \| null      | ja              | `behoerde` \| `medium` \| `organisation` \| `null`. **Nur** aus einer im Buschtelefon gepflegten Liste bekannter Seiten, nie geraten. Im Zweifel `null`                                            |
| `autor_name`                                                 | string \| null    | ja              | **nur** wenn `autor_rolle` gesetzt ist — der Name der Gemeinde, des Vereins, der Zeitung. Sonst immer `null`                                                                                       |
| `autor_ref`                                                  | string \| null    | ja              | Platzhalter, der **nur innerhalb dieses Fundes** gilt: `A` für die Person, die den Beitrag schrieb, `B`, `C`, … für weitere. `null` bei `anonym` — anonyme Einträge werden einander nie zugeordnet |

Regeln für Zeitpunkte:

- `tag`: der Zeitpunkt steht auf **12:00:00 Ortszeit** dieses Tages.
- `unbekannt`: `veroeffentlicht_am` ist `null`.
- Relative Angaben («vor 3 Std.», «Gestern», «2 Wo.») werden gegen den
  Zeitpunkt des **Sammelns** aufgelöst, beim **ersten** Sehen festgelegt und
  danach nie neu gerechnet. Ersetzt wird der Wert nur durch einen genaueren
  (das volle Datum aus dem Tooltip); das löst keine neue `folge` aus.

**`autor_vorname`** (string ≤ 60 | null, Pflicht, an Beitrag und Kommentar):
der **Vorname** der Person, wie das Profil ihn zeigt — das erste Wort des
Anzeigenamens, nie der Nachname, nie der ganze Name. `null` bei `seite`,
`anonym`, `unbekannt` und wo sich der Vorname nicht sicher abtrennen lässt
(Fantasienamen, «Familie Muster»). Die Redaktion darf den Vornamen in einer
Meldung verwenden («Sandra aus Aesch fragt …») und entscheidet je Meldung,
ob eine Person geschützt werden muss. **Der Nachname wechselt das System
nicht** in einem eigenen Feld; wer ihn braucht, folgt dem Link.

`autor_ref` zeigt daneben, dass zwanzig Kommentare von drei Personen
stammen und dass die Verfasserin selbst antwortet — zwei «Sandra» im selben
Faden bleiben so unterscheidbar. Beides ist **Datensparsamkeit, keine
Anonymisierung**: über den Link ist jede Person bestimmbar, das Material
bleibt Personendaten und wird so behandelt.

### 4.4 Text

| Feld                 | Typ             | Pflicht | Regel                                                                                                                      |
| -------------------- | --------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `text`               | string ≤ 20'000 | ja      | der Wortlaut des Beitrags mit Zeilenumbrüchen, «Mehr anzeigen» aufgeklappt. `""` ist gültig, wenn der Beitrag nur Bild ist |
| `text_abgeschnitten` | boolean         | ja      | `true`, wenn der Wortlaut länger war als die Grenze                                                                        |

Der Wortlaut bleibt Wortlaut: keine Zusammenfassung, keine Bereinigung,
keine Ersetzung. Namen, die im Beitrag stehen — getippt oder von der
Plattform als Markierung gesetzt —, bleiben stehen.

**Jedes Feld, das Text tragen kann, trägt seinen Status und sein
Kürzungszeichen.** Das gilt für Beitrag, Bild, Verlinktes, Geteiltes und
Kommentar gleich.

### 4.5 Bilder — die wichtigste neue Aufgabe

Viele Gruppenbeiträge **sind** ein Bild: ein Flyer, ein Screenshot, eine
Text-Kachel. Ohne den Text darin ist der Fund leer. Das Buschtelefon liest
ihn und liefert ihn als Text. Die Bilddateien selbst wechseln das System
nicht.

| Feld                          | Typ             | Pflicht | Regel                                                                                                                                                           |
| ----------------------------- | --------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bilder`                      | Objekt[]        | ja      | ein Eintrag **je Bild oder Video**, in der Reihenfolge der Plattform; `[]`, wenn es keine gibt                                                                  |
| `bilder[].nr`                 | integer         | ja      | 1, 2, 3 …                                                                                                                                                       |
| `bilder[].art`                | enum            | ja      | `foto` \| `flyer` \| `screenshot` \| `textkachel` \| `dokument` \| `privatchat` \| `ausweis_dokument` \| `video` \| `unbekannt`                                 |
| `bilder[].text_status`        | enum            | ja      | `gelesen` \| `kein_text` \| `nicht_lesbar` \| `nicht_versucht` \| `zurueckgehalten`                                                                             |
| `bilder[].text`               | string ≤ 10'000 | ja      | der Text im Bild, **wörtlich**, Zeile für Zeile. `null` bei jedem Status ausser `gelesen`                                                                       |
| `bilder[].text_abgeschnitten` | boolean         | ja      |                                                                                                                                                                 |
| `bilder[].beschreibung`       | string ≤ 300    | nein    | ein neutraler Satz, was zu sehen ist («Flyer mit Laternen-Zeichnung», «überschwemmte Unterführung»). Nie Person, Alter, Aussehen, Kennzeichen, Adresse          |
| `n_bilder`                    | integer \| null | ja      | wie viele Bilder/Videos der Beitrag hat. `null`, wenn die Plattform die Zahl nicht zeigt (Album mit «+5»). Grösser als `bilder.length` heisst: es fehlen welche |

Die fünf Zustände, nie verwechseln:

| `text_status`     | heisst                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `gelesen`         | der Text steht in `text`                                                                               |
| `kein_text`       | geprüft, das Bild trägt keinen                                                                         |
| `nicht_lesbar`    | Text vorhanden, aber nicht sicher lesbar                                                               |
| `nicht_versucht`  | nicht gelesen (Bild zu gross, Lesen ausgefallen)                                                       |
| `zurueckgehalten` | bewusst nicht gelesen: `privatchat`, `ausweis_dokument`, Foto von Personen, Kennzeichen, Klingelschild |

v1 kannte einen einzigen String `bildtext`, in dem «kein Bild», «kein Text»
und «nicht lesbar» gleich aussahen (`null`).

Regeln für das Lesen — die Redaktion schreibt daraus Meldungen und prüft
jede Ziffer gegen das Material:

1. **Wörtlich oder gar nicht.** Datum, Uhrzeit, Ort, Preis stehen so da wie
   im Bild. Was nicht sicher lesbar ist, wird nicht geraten: lieber
   `nicht_lesbar` als eine falsche Uhrzeit. Ein fehlender Termin ist der
   Redaktion lieber als ein falscher.
2. **Nichts ergänzen.** Kein Jahr dazusetzen, das nicht im Bild steht; keine
   Abkürzung auflösen; keine Rechtschreibung korrigieren.
3. **Ein Eintrag je Bild.** Bei einem Album mit fünf Flyern gehört jeder
   Termin zu seinem Bild.
4. **Einmal je Bild lesen** (3.1), Ergebnis speichern.
5. **Gesichter und Personen** werden weder beschrieben noch erkannt.
6. **Video:** das Vorschaubild wird wie ein Bild gelesen (`text_status` gilt
   dem Vorschaubild); gesprochener Text bleibt aussen vor (Abschnitt 9).
7. Wird ein Bildtext später besser gelesen, ist das eine Änderung (`bilder`).

Mit welchem Werkzeug gelesen wird (OCR oder ein Sprachmodell mit
Bildeingang), ist Sache des Buschtelefons. Ein Sprachmodell ergänzt gern
plausibel: der Auftrag muss «unlesbar» ausdrücklich als Antwort erlauben und
ein strukturiertes Ergebnis verlangen (`art`, `text_status`, `text`).

### 4.6 Verlinktes und Geteiltes

| Feld                            | Typ            | Pflicht | Regel                                                                                                                                                            |
| ------------------------------- | -------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verlinkt`                      | Objekt[]       | ja      | Links, die der Beitrag trägt; `[]`, wenn keine                                                                                                                   |
| `verlinkt[].url`                | string ≤ 2000  | ja      | der aus dem Weiterleitungslink der Plattform **dekodierte** Zielwert (`u=` bei `l.facebook.com`), ohne `fbclid`/`utm_*`. Kurzlinks Dritter werden nicht verfolgt |
| `verlinkt[].kurzlink`           | boolean        | ja      | `true`, wenn die Adresse ein nicht aufgelöster Kurzlink ist (bit.ly …)                                                                                           |
| `verlinkt[].titel`              | string ≤ 500   | nein    | Titel der Vorschaukarte                                                                                                                                          |
| `verlinkt[].text_status`        | enum           | ja      | `gelesen` \| `nicht_versucht` \| `nicht_lesbar`. `nicht_versucht` ist völlig in Ordnung — die Redaktion hat die Adresse                                          |
| `verlinkt[].text`               | string ≤ 8'000 | ja      | Text der Zielseite bei `gelesen`, sonst `null`                                                                                                                   |
| `verlinkt[].text_abgeschnitten` | boolean        | ja      |                                                                                                                                                                  |
| `geteilt`                       | Objekt \| null | ja      | wenn der Beitrag einen **anderen Beitrag teilt**                                                                                                                 |

`geteilt` trägt `{link, quelle_name, autor_art, autor_rolle, autor_name,
veroeffentlicht_am, datum_genauigkeit, text, text_abgeschnitten, bilder,
n_bilder, verlinkt}` in denselben Formen wie oben. `link` und `quelle_name`
nur, wenn `autor_rolle` gesetzt ist; bei einem geteilten Beitrag einer
Privatperson sind beide `null`, der Text bleibt.

Der geteilte Beitrag ist oft die eigentliche Nachricht («Polizei BL sucht
Zeugen», ein Vereins-Flyer), der eigene Text des Teilenden nur «Achtung!».
Beides getrennt zu haben, verhindert, dass die Redaktion die Polizei einer
Privatperson zuschreibt.

### 4.7 Kommentare

Die Redaktion will die Kommentare **im Wortlaut**: dort steht oft die
Antwort auf die Frage des Beitrags.

**Die Liste ist kumulativ.** Ein einmal freigegebener Kommentar bleibt in
der Liste, auch wenn ein späterer Lauf ihn nicht mehr sieht. Ein Scraper
kann einen gelöschten Kommentar nicht von einem unterscheiden, der nicht
geladen hat (Nachladen, Filter «Relevanteste», Zeitüberschreitung) — und die
Redaktion **ersetzt** ihre Liste durch die gelieferte. Ein schlechter
Sammeltag, der 6 von 40 Kommentaren lädt, darf nicht als «34 gelöscht»
ankommen.

| Feld                                                                                | Typ             | Pflicht | Regel                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------- | --------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kommentare`                                                                        | Objekt[]        | ja      | **immer die ganze Liste** zum freigegebenen Stand, **in der Reihenfolge der ersten Freigabe**: was neu dazukommt, wird hinten angehängt (untereinander in der Reihenfolge der Plattform bei «Älteste zuerst»), auch eine Antwort auf einen alten Kommentar. Schon gelieferte Kommentare behalten ihren Platz. Den Faden trägt allein `antwort_auf`, nie die Position |
| `kommentare[].kennung`                                                              | string ≤ 64     | ja      | innerhalb des Fundes eindeutig und stabil. Ein **vom Buschtelefon gebildeter** Schlüssel, nicht die Kommentar-Kennung der Plattform (die ist ein Permalink auf eine benannte Person)                                                                                                                                                                                 |
| `kommentare[].kennung_art`                                                          | enum            | ja      | `plattform` (aus der Plattform-Kennung abgeleitet, stabil auch bei Bearbeitung) \| `abgeleitet` (siehe unten)                                                                                                                                                                                                                                                        |
| `kommentare[].stand`                                                                | enum            | ja      | `sichtbar` \| `nicht_mehr_gesehen` \| `entfernt`                                                                                                                                                                                                                                                                                                                     |
| `kommentare[].erstmals_freigegeben_am`                                              | Zeitpunkt       | ja      | ändert sich nie. Daran sieht die Redaktion, was seit ihrem letzten Abruf neu ist — auch nach einem verpassten Tag                                                                                                                                                                                                                                                    |
| `kommentare[].antwort_auf`                                                          | string \| null  | ja      | `kennung` des Elternkommentars; `null` auf oberster Ebene. Darf auf eine Kennung zeigen, die nicht in der Liste steht (dann zeigt die Redaktion ihn oben)                                                                                                                                                                                                            |
| `kommentare[].autor_ref`, `autor_art`, `autor_rolle`, `autor_name`, `autor_vorname` |                 | ja      | wie 4.3 — `A` ist die Person, die den Beitrag schrieb                                                                                                                                                                                                                                                                                                                |
| `kommentare[].veroeffentlicht_am`, `datum_genauigkeit`                              |                 | ja      | wie 4.3; bei Kommentaren meist `ungefaehr` oder `stunde`                                                                                                                                                                                                                                                                                                             |
| `kommentare[].text`                                                                 | string ≤ 5'000  | ja      | Wortlaut; `null` bei `stand: entfernt`                                                                                                                                                                                                                                                                                                                               |
| `kommentare[].text_abgeschnitten`                                                   | boolean         | ja      |                                                                                                                                                                                                                                                                                                                                                                      |
| `kommentare[].bilder`                                                               | Objekt[]        | ja      | dieselbe Form wie 4.5; `[]`, wenn keine, und bei `stand: entfernt`                                                                                                                                                                                                                                                                                                   |
| `kommentare[].n_reaktionen`                                                         | integer \| null | nein    |                                                                                                                                                                                                                                                                                                                                                                      |
| `kommentare_stand`                                                                  | enum            | ja      | `vollstaendig` \| `gedeckelt` \| `teilweise` \| `unbekannt`                                                                                                                                                                                                                                                                                                          |
| `kommentare_fehlend`                                                                | integer \| null | ja      | wie viele die Plattform zeigt, die nicht in der Liste stehen; `0` im Normalfall, `null` wenn nicht bestimmbar                                                                                                                                                                                                                                                        |
| `kommentare_geprueft_am`                                                            | Zeitpunkt       | ja      | wann die Kommentare dieses Beitrags zuletzt gelesen wurden — der Stand kann älter sein als die Freigabe                                                                                                                                                                                                                                                              |
| `n_kommentare`                                                                      | integer \| null | ja      | die Zahl der Plattform; `null`, wenn sie keine oder nur eine gerundete zeigt («1,2 Tsd.»)                                                                                                                                                                                                                                                                            |
| `n_reaktionen`, `n_geteilt`                                                         | integer \| null | ja      |                                                                                                                                                                                                                                                                                                                                                                      |

Regeln:

- **`vollstaendig`** heisst: Sortierung «Alle Kommentare» gewählt, kein
  «Weitere Kommentare/Antworten anzeigen» mehr offen. Eine Abweichung von
  `n_kommentare` bis 10 % oder 3 Stück ist dabei kein Widerspruch (die
  Plattform zählt, was die Sitzung nicht sieht).
- **`nicht_mehr_gesehen`** wird nur gesetzt, wenn zwei Läufe an
  verschiedenen Tagen die Kommentare **vollständig** geladen haben und der
  Kommentar in beiden fehlte. Der Wortlaut bleibt. Ein Lauf, der weniger
  lädt als der freigegebene Stand, ändert die Liste nicht.
- **`entfernt`** nur, wenn die Plattform es ausdrücklich zeigt, oder auf ein
  Löschbegehren hin (4.9): der Eintrag bleibt an seinem Platz mit
  `kennung`, `antwort_auf` und `erstmals_freigegeben_am`; `text` und
  `autor_vorname` sind `null`, `bilder` ist `[]`. Ein Löschbegehren gegen
  einen Kommentar gilt immer, auch nach `beobachtet_bis`: es gibt dem Fund
  eine neue `folge` mit `aenderung: ["kommentare"]`. Die Redaktion leert den
  Kommentar auch bei einem Fund, über den schon entschieden ist
  (Abschnitt 8).
- **Deckel 300** Kommentare je Fund, Antworten eingeschlossen, **gezählt
  nach der ersten Freigabe**: die ersten 300 freigegebenen bleiben, was
  danach kommt, wird nicht mehr aufgenommen — nie fällt ein schon gelieferter
  Kommentar heraus, um einem neueren Platz zu machen. Dann steht
  `kommentare_stand` auf `gedeckelt` und `kommentare_fehlend` auf der Zahl
  der fehlenden; beides löst keine neue `folge` aus (3.1).
- **`kennung_art: abgeleitet`**: zeigt die Plattform keine Kommentar-Kennung,
  wird der Schlüssel aus Beitrag, Elternkommentar, Konto und der
  Ordnungszahl unter gleichen gebildet — **nicht aus dem Text**, damit eine
  Bearbeitung dieselbe Kennung behält. Die Redaktion zählt «neue Kommentare»
  nur über `plattform`-Kennungen verlässlich.
- Schlüssel werden als HMAC mit einem Geheimnis gebildet, das das
  Buschtelefon nie verlässt — ein blosser Hash über die Konto-Kennung liesse
  sich durchprobieren.

### 4.8 Wie lange ein Beitrag weiterbeobachtet wird

Bis `beobachtet_bis`, empfohlen **14 Tage ab Veröffentlichung**, mindestens
7; das Buschtelefon darf es je Quelle kürzen und sagt es im Feld.
`beobachtet_bis` ist **nie `null`** und wird beim ersten Sehen festgelegt.
Gerechnet wird vom Kalendertag (Europe/Zurich) von `veroeffentlicht_am`; bei
`datum_genauigkeit: ungefaehr` vom Tag von `veroeffentlicht_spaetestens`,
bei `unbekannt` vom Tag von `erstmals_freigegeben_am`. Ein später genaueres
Datum (4.3) verschiebt `beobachtet_bis` nicht. Ein aktiver oder nicht
erreichbarer Fund ohne `beobachtet_bis` ist für die Redaktion ungültig: sie
nennt ihn im Ergebnis des Abrufs und übergeht ihn.

**Ein alter Beitrag kommt nie wieder herein.** Facebook rückt einen Beitrag
im Feed nach oben, sobald jemand darunter kommentiert — auch einen von vor
zwei Jahren. Drei Regeln halten ihn draussen:

1. **Aufnahmefenster:** Ein Beitrag wird nur dann erstmals geliefert, wenn
   er beim ersten Sehen höchstens **14 Tage** alt ist (`veroeffentlicht_am`;
   bei `ungefaehr` zählt `veroeffentlicht_spaetestens`, bei `unbekannt`
   wird geliefert). Ältere werden gezählt (`n_zu_alt` in `/quellen`), nicht
   geliefert.
2. **Nach `beobachtet_bis` löst ein neuer Kommentar keine `folge` mehr
   aus.** Der Fund ist für die Redaktion abgeschlossen.
3. **Das Buschtelefon vergisst keine `kennung`.** Es führt ein dauerhaftes
   Register aller je gesehenen Beiträge — nur `kennung`,
   `erstmals_freigegeben_am` (oder «aussortiert» / «zu alt»),
   `beobachtet_bis` und bei einem entfernten Beitrag den `entfernt_grund`,
   ohne Inhalt —, auch nachdem es Wortlaut und Kommentare gelöscht hat (3.4)
   und auch für entfernte Beiträge (4.9). Ohne dieses Register sähe ein vor
   120 Tagen gelöschter Fund beim nächsten Kommentar wie ein neuer aus.
   Regel 1 fängt denselben Fall ein zweites Mal ab. Die **einzige**
   Rückkehr, die das Register zulässt, ist die eines an der Quelle
   gelöschten Beitrags bis `beobachtet_bis` (4.9).

Das Nachlesen ist der teure Teil eines Scrapers (jeden Beitrag öffnen, jeden
Antwort-Faden aufklappen) und das Muster, das Konten in die Sicherheitsprüfung
schickt. Darum:

- höchstens **einmal je Kalendertag** je Beitrag;
- **Pflicht** an den Tagen 1 bis 3 nach Veröffentlichung;
- danach nur, wenn der Kommentarzähler im Feed sich gegenüber dem
  freigegebenen Stand bewegt hat oder der Beitrag im Feed nach oben gerückt
  ist — mindestens aber jeden dritten Tag.

Was die Redaktion mit einer Änderung macht, ist ihre Sache (ein noch nicht
bearbeiteter Fund wird ergänzt, ein entschiedener nicht mehr — gelöscht wird
Entferntes aber in beiden, Abschnitt 8). Das Buschtelefon muss davon nichts
wissen und bekommt keine Rückmeldung.

### 4.9 Doubletten, nicht erreichbare und entfernte Beiträge

**`doublette_von`** (string \| null, Pflicht) zeigt **immer auf das
Original**, nie auf eine andere Doublette. Original ist der Fund mit dem
frühesten `erstmals_freigegeben_am`, bei Gleichstand die kleinere `kennung`;
das wechselt nie, auch wenn das Original entfernt wird (der Verweis darf
dann ins Leere zeigen). In derselben Freigabe erhält das Original die
tiefere `folge`. Wird eine Doublette erst später erkannt, ist das eine
Änderung (`doublette`). Verglichen werden Beitragstext und Bildtexte, auch
über Kanäle hinweg; jede Doublette trägt ihre eigenen Kommentare und ihren
eigenen Link und wird **geliefert**.

**`status: nicht_erreichbar`**: der Beitrag liess sich nicht mehr öffnen,
ohne dass die Plattform sagt, warum (Moderation, Anmeldewand, Konto aus der
Gruppe entfernt). Der Fund kommt vollständig mit seinem letzten Stand; die
Redaktion löscht nichts und zeigt einen Hinweis. Lässt er sich wieder
öffnen, kommt er mit `status: aktiv` und `aenderung` mit `status` — er war
nie entfernt, also nicht `neu`.

**`status: entfernt`**: der Beitrag ist an der Quelle gelöscht oder muss weg.
Der Fund trägt dann **genau** diese Felder, alle anderen **müssen fehlen**:

```json
{
  "kennung": "fb:…",
  "folge": 18001,
  "status": "entfernt",
  "entfernt_grund": "an_der_quelle_geloescht",
  "aenderung": ["status"],
  "erstmals_freigegeben_am": "…",
  "geaendert_am": "…",
  "kanal": "facebook",
  "quelle": "…",
  "gemeinden_bfs": [2761]
}
```

`entfernt_grund`: `an_der_quelle_geloescht` | `loeschbegehren` |
`quelle_abgemeldet`.

- `an_der_quelle_geloescht` nur, wenn die Plattform einer nachweislich
  angemeldeten Sitzung ausdrücklich «Inhalt nicht verfügbar» zeigt, **an
  zwei verschiedenen Tagen**. Alles andere ist `nicht_erreichbar`.
- Mit `entfernt` **löscht das Buschtelefon Wortlaut, Kommentare und
  Bildtexte auch bei sich** und behält nur die Felder oben.
- Die Redaktion löscht daraufhin ihr Rohmaterial und verwirft eine noch
  **nicht publizierte** Meldung. Ein Recherche-Hinweis trägt ohnehin keinen
  Wortlaut (Abschnitt 8); mit dem Material verschwindet auch, was er zeigt.
  **Eine schon publizierte Meldung bleibt, wie sie ist** — das gilt auch für
  ein Löschbegehren: es wird nur berücksichtigt, solange die Meldung nicht
  publiziert ist. Am Tisch steht dann der Hinweis «Original nicht mehr
  auffindbar».
- Ein `entfernt` zu einer Kennung, die die Redaktion nicht kennt, ignoriert
  sie.
- Nach `beobachtet_bis` wird eine Löschung an der Quelle nicht mehr
  festgestellt. Ein Löschbegehren gilt immer.

**Welcher entfernte Beitrag zurückkommen darf.** Die Regel hängt am
`entfernt_grund`, und das Register (4.8) behält die `kennung` in jedem Fall:

| `entfernt_grund`          | zurück?                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loeschbegehren`          | **nie.** Das Löschbegehren ist endgültig, auch wenn der Beitrag an der Quelle weiter steht und darunter kommentiert wird                                                                                                                                                                                                                                              |
| `quelle_abgemeldet`       | **nie.** Wird dieselbe Quelle später wieder erfasst, kommen nur ihre neuen Beiträge, nach dem Aufnahmefenster (4.8)                                                                                                                                                                                                                                                   |
| `an_der_quelle_geloescht` | nur **bis und mit `beobachtet_bis`**, wenn der Beitrag sich wieder öffnen lässt. Dann kommt er **vollständig wie ein neuer Fund** (frisch gelesen, denn sein Material ist auch beim Buschtelefon gelöscht): neue `folge`, `status: aktiv`, `aenderung: ["neu"]`, **unverändertes** `erstmals_freigegeben_am` aus dem Register. Danach ist auch dieser Grund endgültig |

Die Redaktion öffnet einen so zurückgekehrten Fund wieder, wenn über ihn
noch keine Person entschieden hatte; sonst bleibt er, wie er war
(Abschnitt 8).

## 5. Personendaten

Was über diese Tür geht, sind Äusserungen von Privatpersonen. Das Folgende
ist Teil des Vertrags, nicht Beiwerk.

- **Zweck:** ausschliesslich journalistische Recherche der Redaktion.
- **Nie über die Tür:** Nachnamen und Konto-Kennungen von Privatpersonen in
  eigenen Feldern (der Vorname schon, 4.3), Profilbilder, Profilangaben,
  Mitgliederlisten, Namen der Reagierenden, Direktnachrichten, Stories.
- **Ein Personenprofil ist nie eine Quelle.**
- **Besonders heikle Bilder** (Privatchat, Ausweis, medizinisches Schreiben,
  Kennzeichen) werden nicht gelesen (`zurueckgehalten`).
- **Löschbegehren und Einsprachen** (einer Person, einer Gruppen-Admin)
  nimmt eine Stelle entgegen **[OFFEN]**; das Buschtelefon setzt sie für
  einen Beitrag als `entfernt_grund: loeschbegehren` um (4.9), für einen
  Kommentar als `stand: entfernt` (4.7). Die Redaktion folgt mit dem
  nächsten Abruf.
- **Aufbewahrung** auf beiden Seiten befristet (3.4, Abschnitt 8). Die
  Abbildung Konto → `autor_ref` wird mit dem Inhalt des Fundes gelöscht; das
  Register der Kennungen (4.8) bleibt.
- Beide Seiten geben Kommentare von Privatpersonen an Sprachmodelle weiter
  (das Buschtelefon zum Bildlesen, die Redaktion zum Sichten und
  Vorformulieren). Das gehört ins Bearbeitungsverzeichnis beider Seiten.

## 6. Was gegenüber v1 wegfällt

| v1                           | v2                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `seit`, `stand`              | `nach` / `folge`                                                                                     |
| `erfasst_am`                 | `erstmals_freigegeben_am` + `geaendert_am`                                                           |
| `gemeinde_slug`              | `gemeinden_bfs[]`                                                                                    |
| `kanton`                     | entfällt (folgt aus der Gemeinde)                                                                    |
| `titel`                      | entfällt — ein Facebook-Beitrag hat keinen; die Redaktion bildet die Anzeigezeile aus dem Textanfang |
| `zusammenfassung`            | entfällt (Abschnitt 1)                                                                               |
| `artikel_text`               | `verlinkt[]`                                                                                         |
| `bildtext`                   | `bilder[]`                                                                                           |
| `pruefsumme`                 | entfällt — `folge` ist das Änderungssignal                                                           |
| `ohne_link` (Umschlag)       | `ausgelassen[]`                                                                                      |
| `autor_art` nur am Kommentar | `autor_art`/`autor_rolle`/`autor_ref` an Beitrag und Kommentar                                       |
| Kommentare ohne Kennung      | kumulative Liste mit `kennung`, `stand`, `antwort_auf`                                               |

## 7. Umsetzungshinweise für das Buschtelefon, in Reihenfolge

Die Reihenfolge ist nicht beliebig: der Freigabeschritt vergleicht
Fingerabdrücke, und die stimmen erst, wenn ihre Eingaben stabil sind.

1. **Kennungen stabil machen** — Beitrag (`pfbid` auflösen, 4.1) und
   Kommentar (4.7).
2. **`autor_ref` vergeben**: je Fund eine Abbildung Konto → Buchstabe, die
   über die Sammelläufe gleich bleibt (sonst heisst dieselbe Person morgen
   `C`). Sie bleibt im Buschtelefon und wird mit dem Fund gelöscht.
3. **Normalisierung für den Vergleich** festlegen, samt der Liste der
   ausgenommenen Felder und der Zuordnung Feld → `aenderung` (3.1).
4. **Bilder lesen**, einmal je Bild, Schlüssel ist die Prüfsumme der Datei;
   Ergebnis je Bild mit fünf Zuständen (4.5).
5. **Kommentare** kumulativ führen und neue hinten anhängen, «Alle
   Kommentare» wählen, Fäden aufklappen, `kommentare_stand` ehrlich setzen
   (4.7); Nachlesen nach 4.8.
6. **Relative Zeitangaben** beim ersten Sehen festlegen (4.3); Zeitpunkte
   mit Versatz, Tagesgenauigkeit auf 12:00.
7. **Register der Kennungen** anlegen (4.8), dauerhaft und ohne Inhalt,
   samt `beobachtet_bis` und `entfernt_grund`; Aufnahmefenster und die Regel
   aus 1.1 darauf aufsetzen, beide gezählt.
   **`gemeinden_bfs`**, `sichtbarkeit`, `zugang` an der **Quelle** pflegen;
   die Liste bekannter Seiten für `autor_rolle` anlegen.
8. **Freigabeschritt** bauen: ein Schreiber, eine Transaktion, am Ende des
   Sammellaufs; nur vollständig gelesene Quellen; vergibt `folge`, schreibt
   `aenderung`. Die Tür liest ausschliesslich den freigegebenen Stand.
   `folge` als `bigint`, eindeutig indexiert; `?nach=` ist
   `WHERE folge > $1 ORDER BY folge LIMIT $2` über Funde und Ausgelassene.
9. **`nicht_erreichbar` / `entfernt`** nach 4.9, samt Löschen bei sich;
   zurück kommt nur, was `an_der_quelle_geloescht` war, und nur bis
   `beobachtet_bis`.
10. **`/quellen`** mit `stand`, `fehler_seit`, `gelesen_zurueck_bis`.
11. **Längen einhalten**, Kürzungen kennzeichnen. In v1 konnte ein einziger
    zu langer Wert den ganzen Abruf bis zu 14 Tage blockieren.
12. **Fehlerantworten** nach 3.3, immer JSON.

### Prüfliste, bevor die Redaktion umstellt

Protokoll:

- [ ] Zwei Abrufe im Abstand von fünf Minuten, ausserhalb der Freigabe,
      liefern Byte für Byte dasselbe — `/funde` wie `/quellen`.
- [ ] `?nach=<freigabe.folge>` liefert leere `funde`, leere `ausgelassen`
      und `weiter: null`.
- [ ] Mit `limit=1` durchgeblättert kommt jeder Eintrag genau einmal, in
      aufsteigender `folge`.
- [ ] **Drei Sammelläufe an drei Tagen über zwanzig unveränderte Beiträge
      (davon zehn mit Bild) ergeben für keinen eine neue `folge`.**
- [ ] Ein Beitrag, an dem sich nur Zahlen bewegten (Reaktionen,
      `n_kommentare`, `kommentare_fehlend`), erscheint nicht neu; ebenso
      einer, dessen ungefähres Datum genauer wurde.
- [ ] Ein Beitrag mit einem neuen Kommentar erscheint nach der nächsten
      Freigabe mit höherer `folge`, `aenderung: ["kommentare"]` und der
      **ganzen** Liste; die schon gelieferten Kommentare stehen unverändert
      an derselben Stelle, der neue am Ende — auch wenn er eine Antwort auf
      den ersten ist.
- [ ] Ein Beitrag mit mehr als 300 Kommentaren: die ersten 300
      freigegebenen bleiben, `kommentare_stand: gedeckelt`; ein weiterer
      Kommentar ergibt keine neue `folge`.
- [ ] Ein Lauf, der nur einen Teil der Kommentare lädt, ändert die
      freigegebene Liste nicht.
- [ ] Derselbe Beitrag, in zwei getrennten Browser-Sitzungen an zwei Tagen
      gelesen, ergibt dieselbe `kennung` und dieselben Kommentar-Kennungen.
- [ ] An fünf aufeinanderfolgenden Tagen liegt `freigegeben_am` vor 11:55,
      und um 12:00 antwortet die Tür mit `200`.
- [ ] Ein Tag ohne Änderung: `freigabe.tag` ist heute, `freigabe.folge`
      gleich wie gestern.
- [ ] Eine Quelle, deren Lesen scheiterte, steht in `quellen_offen` und in
      `/quellen` mit `stand: fehlgeschlagen` und `fehler_seit`.
- [ ] Ein Fund ohne Permalink steht in `ausgelassen` mit `folge` und seiner
      `kennung`; nach Nachtrag erscheint er mit höherer `folge` und
      `aenderung: ["neu"]`. Ein Fund ohne stabile Kennung steht dort mit
      `kennung: null`.
- [ ] Vor der ersten Freigabe antworten `/funde` und `/quellen` mit `503`
      und `"grund": "nicht_eingerichtet"`.
- [ ] Falscher Bearer-Schlüssel: `401` mit JSON, nicht die Anmeldeseite.

Inhalt:

- [ ] **Bildtext:** Die Redaktion stellt 30 Bild-Beiträge aus den erfassten
      Gruppen zusammen (Flyer, Screenshots, Fotos). Bestanden, wenn in
      keinem `gelesen`-Text eine Ziffer von der Vorlage abweicht,
      `nicht_lesbar` bei höchstens 6 der 30 steht und jedes Foto ohne Text
      `kein_text` trägt.
- [ ] Jeder Zeitpunkt trägt einen Versatz; jeder mit Tagesgenauigkeit
      (`datum_genauigkeit` = `tag`) steht auf 12:00:00 Ortszeit.
- [ ] Kein Feld ausser `text` (von Beitrag, Kommentar, Bild, Geteiltem)
      trägt den Nachnamen oder die Konto-Kennung einer Privatperson;
      `autor_vorname` ist ein einzelnes Wort; `kennung`,
      Kommentar-Kennung und `geteilt.link` eingeschlossen.
- [ ] Ein Beitrag mit nur einem Emoji und ein Foto ohne Text erscheinen
      nicht in `funde`, aber in `n_aussortiert` ihrer Quelle; ein Foto mit
      zwei Wörtern Text erscheint.
- [ ] Ein zwei Jahre alter Beitrag, unter dem heute kommentiert wurde,
      erscheint nicht (`n_zu_alt`), auch wenn sein Inhalt beim Buschtelefon
      längst gelöscht ist.
- [ ] Ein Beitrag nach `beobachtet_bis` bekommt durch einen neuen Kommentar
      keine neue `folge`.
- [ ] Ein Beitrag mit `datum_genauigkeit: unbekannt` trägt ein
      `beobachtet_bis`, gerechnet ab `erstmals_freigegeben_am`.
- [ ] Ein Screenshot eines Privatchats trägt `zurueckgehalten`.
- [ ] Ein an der Quelle gelöschter Beitrag kommt nach dem zweiten Tag als
      `status: entfernt` mit genau den Feldern aus 4.9.
- [ ] Ein Beitrag mit Löschbegehren, der an der Quelle weiter steht, kommt
      nie wieder — auch nicht, wenn darunter neu kommentiert wird.
- [ ] Ein als `an_der_quelle_geloescht` entfernter Beitrag, der vor
      `beobachtet_bis` wieder erreichbar ist, kommt vollständig mit
      `aenderung: ["neu"]` und seinem alten `erstmals_freigegeben_am`.
- [ ] Ein Kommentar mit Löschbegehren steht an seinem Platz mit
      `stand: entfernt`, ohne Text, Vorname und Bilder.

## 8. Was die Redaktion damit macht (zur Einordnung)

Nicht Teil des Vertrags, aber der Grund für seine Form:

- Ein neuer Bereich **«Buschtelefon»** im Arbeitsplatz, neben Gemeinde,
  Medien und Daten, mit den Reitern **Facebook-Gruppen**, **Instagram** und
  **TikTok** (die letzten zwei leer, bis das Buschtelefon sie liefert), je
  mit Filter nach Gemeinde.
- Abruf einmal täglich um 12:00. Ein Fund, über den noch nicht entschieden
  ist, wird mit dem neuen Stand **ersetzt**, neu gesichtet, und der Tisch
  zeigt, was neu dazukam; ein entschiedener bleibt, wie er beim Entscheid
  war. **Entferntes gilt in beiden Fällen:** ein entfernter Beitrag wird
  auch bei einem entschiedenen Fund geleert, samt einer noch nicht
  publizierten Meldung (4.9); ein entfernter Kommentar (4.7) wird dort
  geleert, er allein — Note, Entscheid und Entwurf bleiben, wie sie sind.
- Kommt ein `an_der_quelle_geloescht` entfernter Beitrag zurück (4.9),
  öffnet die Redaktion den Fund wieder und sichtet ihn neu — aber nur, wenn
  noch keine Person über ihn entschieden hatte.
- Die Sichtung benotet und begründet («weshalb könnte das relevant sein»),
  sie filtert nie: was sie nicht vorschlägt, liegt einen Klick weiter.
- **Der Lauf schreibt den Entwurf gleich mit**, für die Funde ab einer
  Stufe, die die Redaktion am Tisch einstellt. Publiziert wird nichts ohne
  Entscheid einer Person.
- Drei Entscheide je Fund: Meldung übernehmen oder schreiben (auch mit
  eigenen Angaben oder ganz von Hand), ablehnen mit Grund, an die
  Chefredaktion als Recherche-Hinweis.
- **Der Recherche-Hinweis trägt keinen Wortlaut.** Er nennt nur Quelle und
  Tag («Beitrag aus Facebook-Gruppe «…» vom …»), die Gemeinde und die
  Begründung; die Chefredaktion liest Beitrag, Bildtexte, Kommentare und
  Link am Fund selbst, solange er sie hält. Leert die Aufbewahrung den
  Fund, ist das Material auch für sie weg; nach einem `entfernt` steht dort
  «Original nicht mehr auffindbar». Eine Kopie, die irgendwo stehen bliebe,
  gibt es nicht.
- **Öffentliche Gruppe:** Die Quellenzeile der Meldung verlinkt den
  **konkreten Beitrag**. Die Leute haben dort geschrieben, damit andere es
  lesen. Ob eine Person geschützt werden muss, entscheidet die Redaktion je
  Meldung; Vornamen darf eine Meldung nennen.
- **Geschlossene Gruppe** (und `unbekannt`): Der Link auf den Beitrag steht
  am Tisch, zur Überprüfung, und der Tisch sagt unübersehbar, dass der Fund
  aus einer geschlossenen Gruppe stammt. Die Meldung verlinkt nur die
  **Gruppe**; dass sie geschlossen ist, muss sie nicht sagen.
- Jede Meldung sagt, dass ihr Inhalt aus einem sozialen Netzwerk stammt und
  nicht unabhängig bestätigt ist. Nachnamen, Telefonnummern und Adressen von
  Privatpersonen stehen nicht darin; das wird geprüft, nicht nur verlangt.
- Aufbewahrung bei der Redaktion: offen 14 Tage, dann ist das Material
  gelöscht; abgelehnt 30 Tage als Lernbeispiel ohne Kommentare und
  Bildtexte, danach nur Entscheid und Grund; übernommen: Kommentare weg,
  sobald die Meldung publiziert oder verworfen ist; weitergereicht: bis zum
  Urteil der Chefredaktion, längstens 90 Tage. Auch die Redaktion behält die
  `kennung` eines gelöschten Fundes, damit eine erneute Lieferung nicht als
  neu gilt — die einzige Ausnahme ist die Rückkehr nach 4.9. Keine Kopien in
  den Directus-Revisionen, auch nicht über den Recherche-Hinweis.

## 9. Entscheide der Redaktion

**Entschieden am 11. November 2026:**

| Frage                            | Entscheid                                                                                                                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Link in der publizierten Meldung | öffentliche Gruppe: der konkrete Beitrag. Die Redaktion entscheidet, was publiziert wird und ob eine Privatperson zu schützen ist                                                                                           |
| Geschlossene Gruppen             | werden gesammelt, der Link wird mitgeliefert (Überprüfung). Eine Meldung ist möglich und verlinkt nur die Gruppe. Dass die Gruppe geschlossen ist, muss die Redaktorin am Tisch klar sehen; die Meldung muss es nicht sagen |
| Namen                            | der Vorname darf im Text einer Meldung stehen → `autor_vorname` (4.3). Kein Nachname in einem eigenen Feld                                                                                                                  |
| Aufbewahrung                     | wie vorgeschlagen (3.4, Abschnitt 8) — mit der Bedingung, dass ein uralter Beitrag nie wieder hereinkommt (4.8, das Register)                                                                                               |
| Entwurf                          | vom Lauf, für jeden Vorschlag — also ab der Stufe, die am Tisch eingestellt ist (Standard: ab Stufe 3 von 4)                                                                                                                |
| Einschätzung                     | bei der Redaktion. Das Buschtelefon sortiert nur absolut Unbrauchbares aus (1.1)                                                                                                                                            |
| Bild ohne Text                   | wird geliefert, wenn aus einem Link oder aus den Kommentaren hervorgeht, worum es geht (1.1, Bedingungen 3 und 4)                                                                                                           |
| Löschbegehren                    | wird nur berücksichtigt, solange die Meldung nicht publiziert ist; der Beitrag kommt danach nie wieder (4.9)                                                                                                                |

**Noch offen, hält den Bau nicht auf:**

- **[OFFEN] Zuständigkeit.** An welche Adresse geht ein Löschbegehren oder
  die Einsprache einer Gruppen-Admin?
- **Instagram und TikTok.** Dieselbe Form trägt beide (ein Reel ist ein Fund
  mit `bilder[].art: "video"`, die Bildunterschrift ist `text`).
  Eingeblendete Schrift und gesprochener Text werden festgelegt, wenn der
  erste Kanal dazukommt.
