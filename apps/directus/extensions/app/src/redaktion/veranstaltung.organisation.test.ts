import { describe, expect, it } from 'vitest'
import {
  attributionsWarnung,
  istGemeindeKalender,
  MELDUNG_SYSTEM_PROMPT,
  quelleFaktenZeile
} from './veranstaltung'

// Der Kalender einer Organisation (Blutspende SRK, seit 30.09.2026): die
// Attribution nennt die Organisation, die Gemeinde bleibt der Ort.
describe('ein Kalender, der nicht der Gemeinde gehoert', () => {
  const f = {
    gemeinde: 'Aesch',
    quelleName: 'Blutspende SRK Schweiz',
    quelleArt: 'organisation' as const
  }

  it('sagt es in der Faktenzeile, und die Gemeinde ist der Normalfall', () => {
    expect(quelleFaktenZeile(f)).toBe(
      'Quelle: Blutspende SRK Schweiz (Kalender einer Organisation, nicht der Gemeinde)'
    )
    expect(
      quelleFaktenZeile({
        quelleName: 'Veranstaltungskalender der Gemeinde Aesch'
      })
    ).toBe('Quelle: Veranstaltungskalender der Gemeinde Aesch')
    expect(istGemeindeKalender({})).toBe(true)
    expect(istGemeindeKalender({ quelleArt: 'gemeinde' })).toBe(true)
    expect(istGemeindeKalender(f)).toBe(false)
    expect(MELDUNG_SYSTEM_PROMPT).toMatch(/laut \{Name der Quelle\}/)
  })

  it('die Attribution nimmt den Namen der Organisation und raet ihn im Hinweis', () => {
    expect(
      attributionsWarnung(
        'Laut Blutspende SRK Schweiz findet am Dienstag, 26. Januar 2027, in Aesch eine Blutspende statt.',
        f
      )
    ).toBeNull()
    expect(
      attributionsWarnung(
        'In Aesch findet am 26. Januar 2027 eine Blutspende statt.',
        f
      )
    ).toBe(
      'Die Meldung sagt nicht, dass Blutspende SRK Schweiz die Quelle ist ("laut Blutspende SRK Schweiz").'
    )
    expect(
      attributionsWarnung('Es gibt eine Blutspende.', {
        gemeinde: 'Pratteln',
        quelleName: 'Veranstaltungskalender der Gemeinde Pratteln'
      })
    ).toMatch(/nennt weder/)
  })
})
