import robots from './robots'
import { metadata } from './layout'
import nextConfig from '../../next.config'

// Der Blog soll erreichbar bleiben, aber in keinem Suchindex auftauchen. Das
// funktioniert nur, wenn drei Dinge zusammenpassen — und die eine Falle dabei
// ist, dass ein `Disallow` das `noindex` unwirksam macht, statt es zu
// verstaerken. Genau das halten diese Tests fest.

describe('robots.txt', () => {
  it('sperrt den Crawler NICHT aus — sonst liest er das noindex nie', () => {
    const regeln = robots().rules
    const alle = Array.isArray(regeln) ? regeln : [regeln]

    for (const regel of alle) {
      const disallow = regel.disallow
      const eintraege = disallow === undefined ? [] : Array.isArray(disallow) ? disallow : [disallow]
      // Ein "/" hier waere der Fehler: robots.txt regelt das CRAWLEN,
      // noindex das INDEXIEREN. Wer ausgesperrt wird, kann das noindex
      // nicht lesen — und Google darf die Adresse dann trotzdem listen.
      expect(eintraege.filter((e) => e !== '')).toEqual([])
    }
  })

  it('laedt niemanden ein: keine Sitemap', () => {
    expect(robots().sitemap).toBeUndefined()
  })
})

describe('noindex', () => {
  it('steht in den Metadaten der Wurzel, also auf jeder Seite', () => {
    const r = metadata.robots
    expect(r).not.toBeNull()
    expect(typeof r).toBe('object')
    const regel = r as {
      index?: boolean
      follow?: boolean
      googleBot?: { index?: boolean }
    }
    expect(regel.index).toBe(false)
    expect(regel.follow).toBe(false)
    // Google liest die eigene Direktive, wo es eine findet.
    expect(regel.googleBot?.index).toBe(false)
  })

  it('steht auch als Header auf jeder Route, nicht nur im HTML-Kopf', async () => {
    const bloecke = await nextConfig.headers!()
    const allgemein = bloecke.find((b) => b.source === '/:path*')

    expect(allgemein).toBeDefined()
    const wert = allgemein!.headers.find((h) => h.key === 'X-Robots-Tag')?.value
    expect(wert).toContain('noindex')
    expect(wert).toContain('nofollow')
  })

  it('gilt auch fuer den Blog und die Freigabe-Seite', async () => {
    const bloecke = await nextConfig.headers!()
    // Der allgemeine Block deckt beide ab; /freigabe hat zusaetzlich seinen
    // eigenen, weil dort schon die Referrer-Policy strenger ist.
    const trifft = (pfad: string) =>
      bloecke.filter((b) => b.source === '/:path*' || pfad.startsWith(b.source.split('/:')[0]!))

    for (const pfad of ['/blog', '/freigabe/abc']) {
      const passende = trifft(pfad)
      const hatNoindex = passende.some((b) =>
        b.headers.some((h) => h.key === 'X-Robots-Tag' && h.value.includes('noindex'))
      )
      expect(hatNoindex).toBe(true)
    }
  })
})
