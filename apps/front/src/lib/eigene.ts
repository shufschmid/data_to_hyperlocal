// Die zwei Wege, eine Meldung mit eigenen Angaben zu erzeugen — rein, getestet.
//
// Der Anlass war die „Turnerobe" in Reinach (4. November 2026): der Kalender
// nannte Tag, Zeit und Ort, aber nicht, was eine Turnerobe ist, und der
// Schreiber verweigerte zu Recht. Die Redaktion weiss es. Ihre Worte: ueberall
// braucht es die Option, eine eigene Meldung zu schreiben oder zusaetzliche
// Angaben zu machen, damit die KI die Meldung schreibt.
//
// Was hier steht, ist nur die Form des Koerpers, den der Endpunkt erwartet
// (`redaktion/ergaenzung.ts` im Bundle prueft ihn noch einmal) und was das
// Formular der Redaktorin sagt, bevor sie abschickt. Keine Regel: die Regeln
// — Ziffern, Zeitbezug, Quellenzeile — bleiben im Bundle.

export type EigeneModus = 'ergaenzen' | 'selbst'

export interface EigeneEingabe {
  ergaenzung: string
  titel: string
  lead: string
  text: string
}

/** Was ein `…/meldung`-Endpunkt ueber die Id hinaus annimmt: eines von beiden, oder nichts. */
export interface MeldungErzeugenKoerper {
  ergaenzung?: string
  eigene?: { titel: string; lead: string; text: string }
}

export const LEERE_EINGABE: EigeneEingabe = {
  ergaenzung: '',
  titel: '',
  lead: '',
  text: ''
}

/** Dieselben Grenzen wie im Bundle — damit das Formular sie nennt, bevor der Server sie nennt. */
export const ERGAENZUNG_MAX_ZEICHEN = 6000
export const TITEL_MAX_ZEICHEN = 255

export const MODUS_TEXT: Record<EigeneModus, string> = {
  ergaenzen: 'Angaben ergänzen – die KI schreibt',
  selbst: 'Selbst schreiben'
}

/** Was noch fehlt, bevor abgeschickt werden kann — oder null. */
export function fehlendes(modus: EigeneModus, eingabe: EigeneEingabe): string | null {
  if (modus === 'ergaenzen') {
    const text = eingabe.ergaenzung.trim()
    if (text === '') return 'Die ergänzenden Angaben fehlen.'
    if (text.length > ERGAENZUNG_MAX_ZEICHEN)
      return `Die ergänzenden Angaben sind zu lang – höchstens ${ERGAENZUNG_MAX_ZEICHEN} Zeichen.`
    return null
  }
  const titel = eingabe.titel.trim()
  if (titel === '') return 'Der Titel fehlt.'
  if (titel.length > TITEL_MAX_ZEICHEN)
    return `Der Titel ist zu lang – höchstens ${TITEL_MAX_ZEICHEN} Zeichen.`
  if (eingabe.lead.trim() === '') return 'Der Lead fehlt – ohne ihn lässt sich die Meldung nicht publizieren.'
  if (eingabe.text.trim() === '') return 'Der Text fehlt.'
  return null
}

/** Der Koerper fuer den Endpunkt, oder null, solange etwas fehlt. */
export function koerperAus(modus: EigeneModus, eingabe: EigeneEingabe): MeldungErzeugenKoerper | null {
  if (fehlendes(modus, eingabe) !== null) return null
  if (modus === 'ergaenzen') return { ergaenzung: eingabe.ergaenzung.trim() }
  return {
    eigene: {
      titel: eingabe.titel.trim(),
      lead: eingabe.lead.trim(),
      text: eingabe.text.trim()
    }
  }
}
