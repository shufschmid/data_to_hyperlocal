import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { darfLesen, darfSchreiben, LESBAR } from './aktionen'

// The allowlist and its callers live in two places that no compiler connects: a
// component builds a string, this list matches it against a regex. On 18
// September 2026 that gap swallowed two shipped features in one morning — a
// button and a form that both answered «Unbekannte Aktion» in production while
// their endpoints were live.
//
// So the test reads the components rather than a hand-kept list: a new caller
// is covered the moment it is written, and a deleted one stops being checked by
// itself.

const KOMPONENTEN = join(process.cwd(), 'src', 'components')
const BEISPIEL_ID = '0123abcd-4567-89ef-0123-456789abcdef'

/** Every `fuehreAus('…')` path in the workspace, with its id holes filled. */
function gerufenePfade(): string[] {
  const pfade = new Set<string>()
  for (const datei of readdirSync(KOMPONENTEN)) {
    if (!datei.endsWith('.tsx') || datei.includes('.test.')) continue
    const quelle = readFileSync(join(KOMPONENTEN, datei), 'utf8')
    // Backticks UND Anfuehrungszeichen: ein Pfad ohne Platzhalter wird gern
    // als gewoehnliche Zeichenkette geschrieben, und genau so einer waere
    // sonst ungeprueft durchgerutscht.
    for (const treffer of quelle.matchAll(/fuehreAus\(\s*(?:`([^`]+)`|'([^']+)'|"([^"]+)")/g)) {
      const roh = treffer[1] ?? treffer[2] ?? treffer[3]
      if (roh === undefined) continue
      pfade.add(roh.replace(/\$\{[^}]*[Ii]d\}/g, BEISPIEL_ID))
    }
  }
  return [...pfade].sort()
}

// A path that still carries a hole picks its verb at runtime
// (`meldungen/:id/${was}`); the verbs themselves are spelled out by sibling
// calls in the same file, so the hole is not an answerable question here.
const gepruefte = gerufenePfade().filter((p) => !p.includes('${'))

describe('Die Liste erlaubter Aktionen', () => {
  it('findet ueberhaupt Aufrufe, sonst prueft dieser Test nichts', () => {
    expect(gepruefte.length).toBeGreaterThan(20)
  })

  it.each(gepruefte)('kennt %s', (pfad) => {
    expect(darfSchreiben(pfad)).toBe(true)
  })

  it('laesst nichts durch, was nicht dasteht', () => {
    for (const erfunden of [
      'meldungen',
      `gemeinden/${BEISPIEL_ID}/loeschen`,
      `amtsblatt/${BEISPIEL_ID}`,
      '../items/directus_users'
    ]) {
      expect(darfSchreiben(erfunden)).toBe(false)
    }
  })

  it('liest nur die drei Pfade, deren Zustand im Prozess lebt', () => {
    expect(LESBAR).toHaveLength(3)
    for (const pfad of ['quellen/lauf', 'gemeindeseiten/lauf', 'bilanz']) expect(darfLesen(pfad)).toBe(true)
    expect(darfLesen('artikel')).toBe(false)
  })
})
