// Die Navigation des Arbeitsplatzes in zwei Stufen: oben vier Bereiche, darunter
// die Werkbaenke des gewaehlten Bereichs.
//
// Die Redaktion am 27. September 2026: zehn Werkbaenke plus Zahnrad passten
// nicht mehr in eine Zeile, die hinteren verschwanden hinter dem
// Blaetterpfeil. Die Reihenfolge der Bereiche ist ihre: zuerst Gemeinde, dann
// Medien, dann Daten, zuletzt die Chefredaktion. Pur, damit Gruppierung und
// Zaehler pruefbar sind.

export type Werkbank =
  | 'gemeindeseiten'
  | 'veranstaltungen'
  | 'amtsblatt'
  | 'wochenblaetter'
  | 'regionaljournal'
  | 'punkt6'
  | 'statistik'
  | 'sport'
  | 'entsorgung'
  | 'chefredaktion'

export type BereichWert = 'gemeinde' | 'medien' | 'daten' | 'chefredaktion'

export interface Bereich {
  wert: BereichWert
  text: string
  werkbaenke: ReadonlyArray<{ wert: Werkbank; text: string }>
}

export const BEREICHE: readonly Bereich[] = [
  {
    wert: 'gemeinde',
    text: 'Gemeinde',
    werkbaenke: [
      { wert: 'gemeindeseiten', text: 'Gemeindeseiten' },
      { wert: 'veranstaltungen', text: 'Veranstaltungen' },
      { wert: 'amtsblatt', text: 'Amtsblatt' }
    ]
  },
  {
    wert: 'medien',
    text: 'Medien',
    werkbaenke: [
      { wert: 'wochenblaetter', text: 'Wochenblätter' },
      { wert: 'regionaljournal', text: 'Regionaljournal' },
      { wert: 'punkt6', text: 'punkt6' }
    ]
  },
  {
    wert: 'daten',
    text: 'Daten',
    werkbaenke: [
      { wert: 'statistik', text: 'data to hyperlocal' },
      { wert: 'sport', text: 'Sportresultate' },
      { wert: 'entsorgung', text: 'Entsorgung' }
    ]
  },
  {
    wert: 'chefredaktion',
    text: 'Chefredaktion',
    werkbaenke: [{ wert: 'chefredaktion', text: 'Chefredaktion' }]
  }
]

/** Der Bereich einer Werkbank — null fuer alles hinter dem Zahnrad und den Blog. */
export function bereichVon(reiter: string): Bereich | null {
  return BEREICHE.find((b) => b.werkbaenke.some((w) => w.wert === reiter)) ?? null
}

/**
 * Was ein Zaehler meint. `arbeit`: hier liegt etwas zu tun. `fehler`: hier
 * steht etwas Falsches draussen (die Revisionswaechter) — das Wichtigere.
 * `chef`: was auf die Chefredaktion wartet.
 */
export type ZaehlerArt = 'arbeit' | 'fehler' | 'chef'

export interface Zaehler {
  anzahl: number
  art: ZaehlerArt
}

/**
 * Der Zaehler eines Bereichs aus denen seiner Werkbaenke. Ein Fehler geht vor:
 * sobald eine Werkbank etwas Falsches draussen meldet, zeigt der Bereich die
 * Zahl dieser Fehler in Rot, nicht die Summe der Arbeit — sonst verschwaende
 * das Wichtigste in einer grossen blauen Zahl.
 */
export function bereichsZaehler(bereich: Bereich, zaehler: Partial<Record<Werkbank, Zaehler>>): Zaehler {
  const eigene = bereich.werkbaenke.map((w) => zaehler[w.wert]).filter((z): z is Zaehler => z !== undefined)
  const fehler = eigene.filter((z) => z.art === 'fehler').reduce((s, z) => s + z.anzahl, 0)
  if (fehler > 0) return { anzahl: fehler, art: 'fehler' }
  const chef = eigene.filter((z) => z.art === 'chef').reduce((s, z) => s + z.anzahl, 0)
  const arbeit = eigene.filter((z) => z.art === 'arbeit').reduce((s, z) => s + z.anzahl, 0)
  if (chef > 0 && arbeit === 0) return { anzahl: chef, art: 'chef' }
  return { anzahl: arbeit + chef, art: 'arbeit' }
}

/**
 * Wohin ein Klick auf einen Bereich fuehrt: zur Werkbank, die dort zuletzt
 * offen war, sonst zur ersten. Wer zwischen Gemeinde und Medien hin und her
 * geht, landet wieder dort, wo sie war.
 */
export function zielImBereich(bereich: Bereich, zuletzt: Partial<Record<BereichWert, Werkbank>>): Werkbank {
  const gemerkt = zuletzt[bereich.wert]
  if (gemerkt !== undefined && bereich.werkbaenke.some((w) => w.wert === gemerkt)) return gemerkt
  return bereich.werkbaenke[0]?.wert ?? 'gemeindeseiten'
}
