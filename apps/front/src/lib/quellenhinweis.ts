// Was die Zeile einer gestoerten Quelle sagt — und welcher Lauf sie heilt.
//
// Pur und darum pruefbar: die Kuerzung eines Fehlertexts und die Zuordnung
// Quelle → Lauf sind genau das, was falsch sein kann.

/** Wie `fetchMitZweiterTuer` einen doppelten Fehlschlag zusammensetzt. */
const CRAWLER_TRENNER = ' — auch über den Crawler nicht: '

/** „irgendwas: fetch failed" → „fetch failed"; ohne Doppelpunkt der ganze Text. */
function ursacheVon(text: string): string {
  const stelle = text.lastIndexOf(': ')
  return (stelle === -1 ? text : text.slice(stelle + 2)).trim()
}

/**
 * Derselbe Fehler, ohne die Wiederholung.
 *
 * Der Lauf setzt einen doppelten Fehlschlag aus zwei ganzen Saetzen zusammen:
 * „EuroAirport nicht erreichbar: fetch failed — auch über den Crawler nicht:
 * Crawler nicht erreichbar: fetch failed". Das ist zweimal dieselbe Auskunft
 * und kostet der Redaktion eine Zeile Bildschirm pro gestoerter Quelle.
 * Sagt die zweite Haelfte dasselbe wie die erste, bleibt sie ein Nachsatz;
 * sagt sie etwas anderes, steht sie kurz dabei. Weggelassen wird nie etwas,
 * was nicht schon dasteht.
 */
export function kurzerFehler(text: string | null): string {
  const roh = (text ?? '').trim()
  if (roh === '') return ''
  const stelle = roh.indexOf(CRAWLER_TRENNER)
  if (stelle === -1) return roh

  const direkt = roh.slice(0, stelle).trim()
  const ueberCrawler = roh.slice(stelle + CRAWLER_TRENNER.length).trim()
  if (ursacheVon(direkt) === ursacheVon(ueberCrawler)) {
    return `${direkt} · auch nicht über den Crawler`
  }
  return `${direkt} · über den Crawler: ${ursacheVon(ueberCrawler)}`
}

/**
 * Der Lauf, der genau diese Quelle wieder liest.
 *
 * Eine gestoerte Quelle war bisher eine Sackgasse mit einem Link darauf: die
 * Redaktion konnte die Seite oeffnen und abtippen, aber nicht sagen „versuch
 * es nochmal". Welcher Lauf zustaendig ist, haengt daran, WER die Zeile
 * geschrieben hat — die Agenda, die Kataloge, die statistik.bl-Tabellen und
 * der EuroAirport gehoeren dem 6-Uhr-Lauf, das Amtsblatt und simap ihrem
 * eigenen. Ein unbekannter Typ bekommt keinen Knopf statt eines falschen.
 */
export function laufFuer(typ: string): string | null {
  switch (typ) {
    case 'agenda':
    case 'ods':
    case 'statbl':
    case 'euroairport':
      return 'quellen/lauf'
    case 'amtsblatt':
    case 'simap':
      return 'amtsblatt/pruefen'
    default:
      return null
  }
}

/**
 * Ob sich ein Eintrag dieser Quelle von Hand erfassen laesst.
 *
 * Nur bei der Agenda: dort ist ein Eintrag ein Satz, den eine Redaktorin
 * abtippen kann. Die Monatszahlen des EuroAirports oder ein Katalog von 188
 * Datensaetzen sind es nicht, und ein Knopf, der in ein Formular fuehrt, das
 * dafuer nicht gemacht ist, ist schlimmer als keiner.
 */
export function kannVonHand(typ: string): boolean {
  return typ === 'agenda'
}
