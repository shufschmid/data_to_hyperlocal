import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bundFuer, bundUrl, liesBund, parseBund } from './bund'

const fixture = JSON.parse(
  readFileSync(
    new URL('./fixtures/bund-2026-09-27-ohne-kantone.json', import.meta.url),
    'utf8'
  )
) as unknown

describe('parseBund — das Ergebnis des Bundes', () => {
  it('liest die Vorlagen des Tages, am Nachmittag noch nicht beendet', () => {
    const liste = parseBund(fixture)
    expect(liste).toHaveLength(2)
    expect(liste[0]?.titel).toMatch(/Neutralitätsinitiative/)
    expect(liste.every((v) => !v.beendet && v.angenommen === null)).toBe(true)
  })

  it('traut `vorlageAngenommen` erst, wenn die Vorlage beendet ist', () => {
    const liste = parseBund({
      schweiz: {
        vorlagen: [
          {
            vorlagenTitel: [{ langKey: 'de', text: 'A' }],
            vorlageBeendet: false,
            vorlageAngenommen: true
          },
          {
            vorlagenTitel: [{ langKey: 'de', text: 'B' }],
            vorlageBeendet: true,
            vorlageAngenommen: false
          }
        ]
      }
    })
    expect(liste).toEqual([
      { titel: 'A', beendet: false, angenommen: null },
      { titel: 'B', beendet: true, angenommen: false }
    ])
  })

  it('paart ueber den Titel, nie ueber die Reihenfolge', () => {
    const liste = parseBund(fixture)
    expect(
      bundFuer(
        'Volksinitiative «Wahrung der schweizerischen Neutralität (Neutralitätsinitiative)»',
        liste
      )
    ).toBe(liste[0])
    expect(bundFuer('Eine kantonale Vorlage', liste)).toBeNull()
  })
})

describe('liesBund', () => {
  it('baut die Adresse aus dem Tag', () => {
    expect(
      bundUrl('https://ogd-static.voteinfo-app.ch/v1/ogd', '2026-09-27')
    ).toBe(
      'https://ogd-static.voteinfo-app.ch/v1/ogd/sd-t-17-02-20260927-eidgAbstimmung.json'
    )
  })

  it('kennt ohne Datei keinen Bund', async () => {
    const leer = async () => new Response('', { status: 404 })
    expect(await liesBund('https://x', '2026-09-27', leer)).toBeNull()
  })

  it('wirft bei einer anderen Absage', async () => {
    const kaputt = async () => new Response('', { status: 500 })
    await expect(liesBund('https://x', '2026-09-27', kaputt)).rejects.toThrow(
      /500/
    )
  })
})
