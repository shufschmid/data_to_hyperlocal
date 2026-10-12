import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  chmediaTreffer,
  erstelleLinksucher,
  gleicherText,
  imFenster,
  parseSeitenmeta,
  parseSitemap,
  tamediaWeg,
  tuerFuer
} from './index'

const lies = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8')

const BZ_SITEMAP = lies('bzbasel-news.xml')
const BAZ_SITEMAP = lies('bazonline-news.xml')
const BZ_ARTIKEL = lies('bzbasel-artikel.html')
const BAZ_ARTIKEL = lies('bazonline-artikel.html')

const BEIZ =
  'https://www.bzbasel.ch/basel/baselland/dorfbeizen-unter-druck-warum-viele-restaurants-scheitern-ld.4247727'
const SMAESCH =
  'https://www.bazonline.ch/smaesch-pfeffingen-sieg-zum-auftakt-trotz-verletzungen-957013339861'

describe('tuerFuer — die Tabelle der Verlage', () => {
  it('kennt CH Media und Tamedia, sonst niemanden', () => {
    expect(tuerFuer('bzbasel.ch')?.verlag).toBe('chmedia')
    expect(tuerFuer('BaZonline.ch ')?.host).toBe('www.bazonline.ch')
    expect(tuerFuer('Neue Fricktaler Zeitung')).toBeNull()
    expect(tuerFuer('kultur-tipp.ch')).toBeNull()
  })
})

describe('parseSitemap und parseSeitenmeta — gemessen am 12. Oktober 2026', () => {
  it('liest die News-Sitemap von CH Media: Adresse, PRINT-Titel, Datum', () => {
    const e = parseSitemap(BZ_SITEMAP)
    expect(e).toHaveLength(4)
    const beiz = e.find((x) => x.loc === BEIZ)
    expect(beiz?.titel).toBe('Die Beiz für alle wird zum Restaurant für wenige')
    expect(beiz?.datum).toBe('2026-10-10T09:00:00Z')
  })

  it('liest die News-Sitemap von Tamedia: der Titel ist der Online-Titel', () => {
    const e = parseSitemap(BAZ_SITEMAP)
    expect(e).toHaveLength(3)
    expect(e.find((x) => x.loc === SMAESCH)?.titel).toBe(
      'Sm’Aesch Pfeffingen: Sieg zum Auftakt trotz Verletzungen'
    )
  })

  it('liest die bz-Seite: Online-Titel, Print-Titel als alternativeHeadline, Bezahlschranke', () => {
    const m = parseSeitenmeta(BZ_ARTIKEL)
    expect(m.headline).toBe(
      'Dorfbeizen unter Druck: Warum viele Restaurants scheitern'
    )
    expect(m.alternativeHeadline).toBe(
      'Die Beiz für alle wird zum Restaurant für wenige'
    )
    expect(m.isAccessibleForFree).toBe(false)
    expect(m.articleTitle).toBeNull()
  })

  it('liest die BaZ-Seite: Print-Titel im Datenlayer, Print-Lead als description, frei', () => {
    const m = parseSeitenmeta(BAZ_ARTIKEL)
    expect(m.articleTitle).toBe(
      "Sm'Aesch Pfeffingen startet mit einem Arbeitssieg in die Saison"
    )
    expect(m.description).toBe(
      'Die verletzungsgeschwächten Baselbieterinnen ringen Aufsteiger Aarau in fünf Sätzen nieder.'
    )
    expect(m.headline).toBe(
      'Sm’Aesch Pfeffingen: Sieg zum Auftakt trotz Verletzungen'
    )
    expect(m.isAccessibleForFree).toBe(true)
  })

  it('bleibt gegen eine fremde Seite unempfindlich', () => {
    expect(parseSeitenmeta('<html>nichts</html>')).toEqual({
      headline: null,
      alternativeHeadline: null,
      description: null,
      articleTitle: null,
      isAccessibleForFree: null
    })
    expect(parseSitemap('<urlset></urlset>')).toEqual([])
  })
})

describe('die Treffer-Regeln', () => {
  it('gleicherText sieht ueber Apostroph, Gedankenstrich und Tausendertrenner hinweg', () => {
    expect(gleicherText("Sm'Aesch – 3'200", 'Sm’Aesch — 3200')).toBe(true)
    expect(gleicherText('A', 'B')).toBe(false)
    expect(gleicherText(null, 'x')).toBe(false)
    expect(gleicherText('', '')).toBe(false)
  })

  it('imFenster: zwei Tage um das Stueck, ohne Datum immer', () => {
    expect(imFenster({ datum: '2026-10-10T09:00:00Z' }, '2026-10-11', 2)).toBe(
      true
    )
    expect(imFenster({ datum: '2026-10-01T09:00:00Z' }, '2026-10-11', 2)).toBe(
      false
    )
    expect(imFenster({ datum: null }, '2026-10-11', 2)).toBe(true)
  })

  it('CH Media: der Sitemap-Titel ist der Print-Titel — exakt, im Fenster', () => {
    const e = parseSitemap(BZ_SITEMAP)
    const stueck = {
      titel: 'Die Beiz für alle wird zum Restaurant für wenige',
      lead: null,
      datum: '2026-10-10'
    }
    expect(chmediaTreffer(e, stueck, 2)?.loc).toBe(BEIZ)
    expect(chmediaTreffer(e, { ...stueck, datum: '2026-09-01' }, 2)).toBeNull()
    expect(
      chmediaTreffer(e, { ...stueck, titel: 'Dorfbeizen unter Druck' }, 2)
    ).toBeNull()
  })

  it('CH Media, Blog-Eintrag: die feste Seite des Blogs steht unter der Tagesueberschrift', () => {
    const e = parseSitemap(BZ_SITEMAP)
    expect(
      chmediaTreffer(
        e,
        {
          titel: 'Sm’Aesch lässt in Aarau einen Punkt liegen',
          lead: null,
          datum: '2026-10-10',
          blogTitel:
            "Sm'Aesch gewinnt zum Auftakt knapp ++ Die Resultate im Regio-Fussball ++ EHC souverän"
        },
        2
      )?.loc
    ).toMatch(/regiosport-aktuell/)
    // The headline has moved on since the dossier — the first segment still names the day's blog.
    expect(
      chmediaTreffer(
        e,
        {
          titel: 'Sm’Aesch lässt in Aarau einen Punkt liegen',
          lead: null,
          datum: '2026-10-10',
          blogTitel:
            "Sm'Aesch gewinnt zum Auftakt knapp ++ EHC souverän ++ Wings mit ärgerlicher Niederlage"
        },
        2
      )?.loc
    ).toMatch(/regiosport-aktuell/)
    expect(
      chmediaTreffer(
        e,
        {
          titel: 'x',
          lead: null,
          datum: '2026-10-10',
          blogTitel: 'Ganz anders ++ EHC souverän'
        },
        2
      )
    ).toBeNull()
    expect(
      chmediaTreffer(
        e,
        {
          titel: 'Sm’Aesch lässt in Aarau einen Punkt liegen',
          lead: null,
          datum: '2026-10-10'
        },
        2
      )
    ).toBeNull()
  })

  it('Tamedia: Print-Titel vor Lead vor Online-Titel, sonst nichts', () => {
    const m = parseSeitenmeta(BAZ_ARTIKEL)
    expect(
      tamediaWeg(m, {
        titel:
          "Volleyball: Sm'Aesch Pfeffingen startet mit einem Arbeitssieg in die Saison",
        lead: null,
        datum: '2026-10-11'
      })
    ).toBeNull()
    expect(
      tamediaWeg(m, {
        titel:
          "Sm'Aesch Pfeffingen startet mit einem Arbeitssieg in die Saison",
        lead: null,
        datum: '2026-10-11'
      })
    ).toBe('print-titel')
    expect(
      tamediaWeg(m, {
        titel: 'Anderer Titel',
        lead: 'Die verletzungsgeschwächten Baselbieterinnen ringen Aufsteiger Aarau in fünf Sätzen nieder.',
        datum: '2026-10-11'
      })
    ).toBe('lead')
    expect(
      tamediaWeg(m, {
        titel: 'Sm’Aesch Pfeffingen: Sieg zum Auftakt trotz Verletzungen',
        lead: null,
        datum: '2026-10-11'
      })
    ).toBe('online-titel')
  })
})

// --- the searcher with a stubbed door --------------------------------------

interface Antwort {
  body?: string
  status?: number
  setCookie?: string
}

function stub(plan: Record<string, Antwort[] | Antwort>) {
  const aufrufe: { url: string; headers: Record<string, string> }[] = []
  const zaehler = new Map<string, number>()
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url = typeof input === 'string' ? input : input.toString()
    aufrufe.push({
      url,
      headers: (init?.headers as Record<string, string>) ?? {}
    })
    const n = zaehler.get(url) ?? 0
    zaehler.set(url, n + 1)
    const p = plan[url]
    if (p === undefined)
      return {
        status: 404,
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(0)
      } as unknown as Response
    const liste = Array.isArray(p) ? p : [p]
    const a = liste[Math.min(n, liste.length - 1)] ?? {}
    const daten = Buffer.from(a.body ?? '', 'utf8')
    return {
      status: a.status ?? 200,
      headers: new Headers(
        a.setCookie === undefined ? {} : { 'set-cookie': a.setCookie }
      ),
      arrayBuffer: async () =>
        daten.buffer.slice(
          daten.byteOffset,
          daten.byteOffset + daten.byteLength
        )
    } as unknown as Response
  }) as typeof fetch
  return { fetchImpl, aufrufe }
}

function sucher(
  s: ReturnType<typeof stub>,
  extra: Partial<Parameters<typeof erstelleLinksucher>[0]> = {}
) {
  return erstelleLinksucher({
    kontakt: 'it@bajour.ch',
    fetchImpl: s.fetchImpl,
    sleep: vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined),
    ...extra
  })
}

describe('erstelleLinksucher', () => {
  it('CH Media: Sitemap einmal je Lauf, Treffer auf den Print-Titel, Bezahlschranke von der Seite', async () => {
    const s = stub({
      'https://www.bzbasel.ch/sitemap/news.xml': { body: BZ_SITEMAP },
      [BEIZ]: { body: BZ_ARTIKEL }
    })
    const l = sucher(s)
    const a = await l.suche('bzbasel.ch', {
      titel: 'Die Beiz für alle wird zum Restaurant für wenige',
      lead: null,
      datum: '2026-10-10'
    })
    expect(a).toEqual({
      status: 'gefunden',
      treffer: {
        url: BEIZ,
        titel: 'Dorfbeizen unter Druck: Warum viele Restaurants scheitern',
        abo: true,
        weg: 'sitemap-titel'
      }
    })
    const b = await l.suche('bzbasel.ch', {
      titel: 'Gibt es nicht',
      lead: null,
      datum: '2026-10-10'
    })
    expect(b.status).toBe('nicht_gefunden')
    expect(s.aufrufe.filter((x) => x.url.endsWith('news.xml'))).toHaveLength(1)
    expect(s.aufrufe[0]?.headers['User-Agent']).toMatch(/it@bajour\.ch/)
    expect(l.protokoll()).toEqual({
      anfragen: 2,
      seiten: 1,
      hosts: ['www.bzbasel.ch']
    })
  })

  it('Tamedia: liest die Seiten des Fensters ueber den Cookie-Umweg und trifft auf den Print-Titel', async () => {
    const s = stub({
      'https://www.bazonline.ch/news.xml': { body: BAZ_SITEMAP },
      [SMAESCH]: [
        { status: 302, setCookie: 'entitlementToken=abc; Path=/; Secure' },
        { body: BAZ_ARTIKEL }
      ]
    })
    const l = sucher(s)
    const a = await l.suche('bazonline.ch', {
      titel: "Sm'Aesch Pfeffingen startet mit einem Arbeitssieg in die Saison",
      lead: null,
      datum: '2026-10-11'
    })
    expect(a.status).toBe('gefunden')
    if (a.status === 'gefunden') {
      expect(a.treffer.url).toBe(SMAESCH)
      expect(a.treffer.abo).toBe(false)
      expect(a.treffer.weg).toBe('print-titel')
    }
    const seitenAufrufe = s.aufrufe.filter((x) => x.url === SMAESCH)
    expect(seitenAufrufe).toHaveLength(2)
    expect(seitenAufrufe[1]?.headers['Cookie']).toBe('entitlementToken=abc')
  })

  it('Tamedia: sagt, wenn der Deckel der Seitenabrufe das Suchen verhindert hat', async () => {
    const s = stub({
      'https://www.bazonline.ch/news.xml': { body: BAZ_SITEMAP }
    })
    const l = sucher(s, { maxSeiten: 0 })
    const a = await l.suche('bazonline.ch', {
      titel: 'Irgendwas',
      lead: null,
      datum: '2026-10-11'
    })
    expect(a.status).toBe('fehler')
    if (a.status === 'fehler')
      expect(a.hinweis).toMatch(/Deckel von 0 Seitenabrufen/)
    expect(l.protokoll().seiten).toBe(0)
  })

  it('ohne Tuer wird nichts geholt; eine fremde Adresse in der Sitemap wird nie gelesen', async () => {
    const s = stub({
      'https://www.bazonline.ch/news.xml': {
        body: '<urlset><url><loc>https://www.tagesanzeiger.ch/x-123</loc><news:news><news:title>X</news:title></news:news></url></urlset>'
      }
    })
    const l = sucher(s)
    expect(
      await l.suche('Surprise', {
        titel: 'Aus dem Schatten',
        lead: null,
        datum: '2026-10-09'
      })
    ).toEqual({
      status: 'keine_tuer'
    })
    const a = await l.suche('bazonline.ch', {
      titel: 'X',
      lead: null,
      datum: '2026-10-11'
    })
    expect(a.status).toBe('nicht_gefunden')
    if (a.status === 'nicht_gefunden')
      expect(a.hinweis).toMatch(/1 Seiten nicht lesbar/)
    expect(s.aufrufe.some((x) => x.url.includes('tagesanzeiger'))).toBe(false)
  })

  it('eine Sitemap, die nicht antwortet, ist ein Fehler mit Grund', async () => {
    const s = stub({
      'https://www.bzbasel.ch/sitemap/news.xml': { status: 503 }
    })
    const a = await sucher(s).suche('bzbasel.ch', {
      titel: 'x',
      lead: null,
      datum: '2026-10-11'
    })
    expect(a).toEqual({ status: 'fehler', hinweis: 'Sitemap: HTTP 503' })
  })
})
