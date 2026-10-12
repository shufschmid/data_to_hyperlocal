// The publishers' doors: where an SMD piece stands online, found by code.
//
// The dossier carries no address — SMD prints the piece, not its URL — and
// the newsroom wants the reader sent to the medium's own page, labelled
// «(Abo)» where it is paywalled. Two families were measured on 11/12 October
// 2026, and each has a different handle:
//
// - CH Media (bzbasel.ch, schweizheute.ch) publishes `sitemap/news.xml`, the
//   last 48 hours, and its `news:title` is the PRINT title — the very string
//   the dossier's TOC prints (`alternativeHeadline` on the page). 7 of 7
//   pieces inside the window matched exactly; a blog matches its permanent
//   page. The article page is read once more for `isAccessibleForFree`.
// - Tamedia (bazonline.ch) publishes `news.xml` too, but its titles are the
//   ONLINE headline, which differed from the print title in every one of
//   nine cases. The article page, however, carries the print title
//   (`articleTitle`) and the print lead (`description`) word for word, and
//   the sitemap lists only six to eight own pieces a day — so every URL of
//   the window is read once per run and compared on title or lead. The page
//   answers 302 to itself with an `entitlementToken` cookie the first time;
//   the second request carries it (a cookie round trip, not a bot wall).
//
// Everything else — print-only titles, radio, kultur-tipp.ch's TYPO3 sitemap
// without titles — has no door, and the desk says so: «(Artikel nicht online
// verfügbar)». The newsroom's rule of 12 October 2026: towards the reader it
// is then as if we had read it in the printed paper.
//
// Identified requests, a run-level cache per sitemap and per page, a declared
// cap on page reads, no crawler (these are data doors and plain pages that
// answered a direct read), and a host allowlist: nothing here can ever fetch
// a host the table does not name.

import { buildUserAgent } from '../agenda/index'
import { normiereTitel } from '../smd/parse'

export type Verlag = 'chmedia' | 'tamedia'

export interface Verlagstuer {
  verlag: Verlag
  host: string
}

/** Which publisher family a medium (as the dossier names it) belongs to. */
export const TUEREN: Readonly<Record<string, Verlagstuer>> = {
  'bzbasel.ch': { verlag: 'chmedia', host: 'www.bzbasel.ch' },
  'schweizheute.ch': { verlag: 'chmedia', host: 'www.schweizheute.ch' },
  'bazonline.ch': { verlag: 'tamedia', host: 'www.bazonline.ch' }
}

export function tuerFuer(medium: string): Verlagstuer | null {
  return TUEREN[medium.trim().toLowerCase()] ?? null
}

export interface LinkSuchStueck {
  titel: string
  lead: string | null
  /** ISO day of the piece — narrows the candidates. */
  datum: string
  /** A blog entry: the blog's headline of that day — its permanent page is listed under it, never under the entry's own title. */
  blogTitel?: string | null
}

export interface LinkTreffer {
  url: string
  /** The page's own headline, for the desk. */
  titel: string | null
  /** True behind the paywall, false when free, null when the page did not say. */
  abo: boolean | null
  /** How it was matched — for the row's hint. */
  weg: 'sitemap-titel' | 'print-titel' | 'lead' | 'online-titel'
}

export type LinkErgebnis =
  | { status: 'gefunden'; treffer: LinkTreffer }
  | { status: 'nicht_gefunden'; hinweis: string }
  | { status: 'keine_tuer' }
  | { status: 'fehler'; hinweis: string }

export interface SitemapEintrag {
  loc: string
  titel: string | null
  /** ISO instant or day as the sitemap prints it. */
  datum: string | null
}

export interface Seitenmeta {
  headline: string | null
  alternativeHeadline: string | null
  description: string | null
  /** Tamedia's data layer carries the print title here. */
  articleTitle: string | null
  isAccessibleForFree: boolean | null
}

export interface LinksucherOptionen {
  kontakt: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** Pause between two requests to the same host. */
  pauseMs?: number
  /** Article pages read per run, over all media — the declared cap. */
  maxSeiten?: number
  /** A sitemap or a page past this is not an answer we expect. */
  maxBytes?: number
  /** Days around the piece's date a sitemap entry may lie in. */
  fensterTage?: number
}

export interface Linksucher {
  suche(medium: string, stueck: LinkSuchStueck): Promise<LinkErgebnis>
  protokoll(): { anfragen: number; seiten: number; hosts: string[] }
}

export const LINK_PAUSE_MS = 1500
export const LINK_MAX_SEITEN = 30
export const LINK_MAX_BYTES = 3 * 1024 * 1024
export const LINK_FENSTER_TAGE = 2

// ---------------------------------------------------------------------------
// Pure parsers
// ---------------------------------------------------------------------------

function entitiesAuf(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(parseInt(n, 16))
    )
}

/** The `<url>` entries of a news sitemap: address, title where given, date. */
export function parseSitemap(xml: string): SitemapEintrag[] {
  const out: SitemapEintrag[] = []
  for (const block of xml.split('<url>').slice(1)) {
    const loc = /<loc>\s*([^<]+?)\s*<\/loc>/.exec(block)?.[1]
    if (loc === undefined) continue
    const titel = /<news:title>\s*([^<]*?)\s*<\/news:title>/.exec(block)?.[1]
    const datum =
      /<news:publication_date>\s*([^<]+?)\s*<\/news:publication_date>/.exec(
        block
      )?.[1] ?? /<lastmod>\s*([^<]+?)\s*<\/lastmod>/.exec(block)?.[1]
    out.push({
      loc: entitiesAuf(loc),
      titel: titel === undefined || titel === '' ? null : entitiesAuf(titel),
      datum: datum ?? null
    })
  }
  return out
}

function jsonString(html: string, schluessel: string): string | null {
  // `"key":"…"` with JSON escapes — decoded by JSON.parse, never by hand.
  const m = new RegExp(`"${schluessel}":("(?:[^"\\\\]|\\\\.)*")`).exec(html)
  if (m === null) return null
  try {
    const wert = JSON.parse(m[1] ?? '""') as unknown
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null
  } catch {
    return null
  }
}

/** What an article page says about itself — JSON-LD and, on Tamedia, the data layer. */
export function parseSeitenmeta(html: string): Seitenmeta {
  // The NewsArticle object first, so a BreadcrumbList's `name` cannot stand in.
  const start = html.indexOf('"@type":"NewsArticle"')
  const artikel = start < 0 ? html : html.slice(start)
  const frei = /"isAccessibleForFree":\s*(true|false)/.exec(artikel)?.[1]
  return {
    headline: jsonString(artikel, 'headline'),
    alternativeHeadline: jsonString(artikel, 'alternativeHeadline'),
    description: jsonString(artikel, 'description'),
    articleTitle: jsonString(html, 'articleTitle'),
    isAccessibleForFree:
      frei === undefined ? null : frei === 'true' ? true : false
  }
}

/** Whether two titles are the same piece of text in two spellings. */
export function gleicherText(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false
  const na = normiereTitel(a)
  const nb = normiereTitel(b)
  return na !== '' && na === nb
}

/** Whether a sitemap entry lies within `fensterTage` of the piece's day. */
export function imFenster(
  eintrag: Pick<SitemapEintrag, 'datum'>,
  datum: string,
  fensterTage: number
): boolean {
  if (eintrag.datum === null) return true
  const tag = Date.parse(`${eintrag.datum.slice(0, 10)}T00:00:00Z`)
  const ziel = Date.parse(`${datum}T00:00:00Z`)
  if (Number.isNaN(tag) || Number.isNaN(ziel)) return true
  return Math.abs(tag - ziel) <= fensterTage * 86_400_000
}

/** The CH Media match: the sitemap's title IS the print title. */
export function chmediaTreffer(
  eintraege: readonly SitemapEintrag[],
  stueck: LinkSuchStueck,
  fensterTage: number
): SitemapEintrag | null {
  const imFensterListe = eintraege.filter((e) =>
    imFenster(e, stueck.datum, fensterTage)
  )
  const direkt = imFensterListe.find((e) => gleicherText(e.titel, stueck.titel))
  if (direkt !== undefined) return direkt
  // A blog entry: the blog's permanent page stands in the sitemap under the
  // day's combined headline («A ++ B ++ C»), never under the entry's own.
  const blogTitel = stueck.blogTitel ?? null
  if (blogTitel === null) return null
  const ganz = imFensterListe.find((e) => gleicherText(e.titel, blogTitel))
  if (ganz !== undefined) return ganz
  // The headline moves on as entries arrive («A ++ B ++ C» becomes «A ++ D
  // ++ B»); its FIRST segment is the newest entry and outlives the rest.
  const kopf = erstesSegment(blogTitel)
  if (kopf === null) return null
  return (
    imFensterListe.find((e) => gleicherText(erstesSegment(e.titel), kopf)) ??
    null
  )
}

/** The part before the first « ++ » of a blog headline — null where there is none. */
function erstesSegment(titel: string | null): string | null {
  if (titel === null || !titel.includes('++')) return null
  const kopf = titel.split('++')[0]?.trim() ?? ''
  return kopf === '' ? null : kopf
}

/** The Tamedia match, on the page's own fields — print title, print lead, online headline. */
export function tamediaWeg(
  meta: Seitenmeta,
  stueck: LinkSuchStueck
): LinkTreffer['weg'] | null {
  if (gleicherText(meta.articleTitle, stueck.titel)) return 'print-titel'
  if (stueck.lead !== null && gleicherText(meta.description, stueck.lead))
    return 'lead'
  if (
    gleicherText(meta.headline, stueck.titel) ||
    gleicherText(meta.alternativeHeadline, stueck.titel)
  )
    return 'online-titel'
  return null
}

// ---------------------------------------------------------------------------
// The searcher — one per run, with its caches and its cap
// ---------------------------------------------------------------------------

export class VerlagFehler extends Error {
  constructor(
    message: string,
    readonly url: string
  ) {
    super(message)
    this.name = 'VerlagFehler'
  }
}

const wirklichSchlafen = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms))

export function erstelleLinksucher(optionen: LinksucherOptionen): Linksucher {
  const fetchImpl = optionen.fetchImpl ?? fetch
  const sleep = optionen.sleep ?? wirklichSchlafen
  const pauseMs = optionen.pauseMs ?? LINK_PAUSE_MS
  const maxSeiten = optionen.maxSeiten ?? LINK_MAX_SEITEN
  const maxBytes = optionen.maxBytes ?? LINK_MAX_BYTES
  const fensterTage = optionen.fensterTage ?? LINK_FENSTER_TAGE
  const userAgent = buildUserAgent(optionen.kontakt)
  const erlaubteHosts = new Set(Object.values(TUEREN).map((t) => t.host))

  let anfragen = 0
  let seiten = 0
  const hosts = new Set<string>()
  const zuletzt = new Map<string, number>()
  const sitemaps = new Map<string, Promise<SitemapEintrag[]>>()
  const seitenmeta = new Map<string, Promise<Seitenmeta | null>>()

  async function hole(
    url: string,
    cookie: string | null = null
  ): Promise<{ status: number; text: string; setCookie: string | null }> {
    const host = new URL(url).host
    if (!erlaubteHosts.has(host))
      throw new VerlagFehler(`Host ${host} ist keine Verlagstuer.`, url)
    const vorher = zuletzt.get(host)
    if (vorher !== undefined) {
      const warten = pauseMs - (Date.now() - vorher)
      if (warten > 0) await sleep(warten)
    }
    anfragen += 1
    hosts.add(host)
    zuletzt.set(host, Date.now())
    const antwort = await fetchImpl(url, {
      redirect: 'manual',
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xml;q=0.9,*/*;q=0.5',
        ...(cookie === null ? {} : { Cookie: cookie })
      }
    })
    const puffer = await antwort.arrayBuffer()
    if (puffer.byteLength > maxBytes)
      throw new VerlagFehler(
        `Antwort groesser als ${maxBytes} Bytes (${puffer.byteLength}).`,
        url
      )
    return {
      status: antwort.status,
      text: Buffer.from(puffer).toString('utf8'),
      setCookie: antwort.headers.get('set-cookie')
    }
  }

  /** A page, through the cookie round trip where the host asks for one. */
  async function holeSeite(url: string): Promise<string> {
    const erste = await hole(url)
    if (erste.status === 200) return erste.text
    if (
      (erste.status === 301 || erste.status === 302) &&
      erste.setCookie !== null
    ) {
      const cookie = erste.setCookie.split(';')[0] ?? null
      const zweite = await hole(url, cookie)
      if (zweite.status === 200) return zweite.text
      throw new VerlagFehler(`HTTP ${zweite.status} nach Cookie-Umweg`, url)
    }
    throw new VerlagFehler(`HTTP ${erste.status}`, url)
  }

  function sitemapVon(tuer: Verlagstuer): Promise<SitemapEintrag[]> {
    const url =
      tuer.verlag === 'chmedia'
        ? `https://${tuer.host}/sitemap/news.xml`
        : `https://${tuer.host}/news.xml`
    let p = sitemaps.get(url)
    if (p === undefined) {
      p = hole(url).then((a) => {
        if (a.status !== 200)
          throw new VerlagFehler(`Sitemap: HTTP ${a.status}`, url)
        return parseSitemap(a.text)
      })
      sitemaps.set(url, p)
    }
    return p
  }

  /** A page's meta, once per run; null when the cap bit or the page refused. */
  function metaVon(url: string): Promise<Seitenmeta | null> {
    let p = seitenmeta.get(url)
    if (p === undefined) {
      p = (async () => {
        if (seiten >= maxSeiten) return null
        seiten += 1
        return parseSeitenmeta(await holeSeite(url))
      })()
      seitenmeta.set(url, p)
    }
    return p
  }

  async function sucheChmedia(
    tuer: Verlagstuer,
    stueck: LinkSuchStueck
  ): Promise<LinkErgebnis> {
    const eintraege = await sitemapVon(tuer)
    const treffer = chmediaTreffer(eintraege, stueck, fensterTage)
    if (treffer === null)
      return {
        status: 'nicht_gefunden',
        hinweis: `kein Eintrag mit diesem Titel in der News-Sitemap von ${tuer.host} (${eintraege.length} Eintraege)`
      }
    let abo: boolean | null = null
    let titel: string | null = treffer.titel
    try {
      const meta = await metaVon(treffer.loc)
      if (meta !== null) {
        abo =
          meta.isAccessibleForFree === null ? null : !meta.isAccessibleForFree
        titel = meta.headline ?? titel
      }
    } catch {
      // The sitemap already named the page; the paywall question stays open.
    }
    return {
      status: 'gefunden',
      treffer: { url: treffer.loc, titel, abo, weg: 'sitemap-titel' }
    }
  }

  async function sucheTamedia(
    tuer: Verlagstuer,
    stueck: LinkSuchStueck
  ): Promise<LinkErgebnis> {
    const eintraege = (await sitemapVon(tuer)).filter((e) =>
      imFenster(e, stueck.datum, fensterTage)
    )
    // The online title is tried first — free, no page read.
    const direkt = eintraege.find((e) => gleicherText(e.titel, stueck.titel))
    const reihenfolge =
      direkt === undefined
        ? eintraege
        : [direkt, ...eintraege.filter((e) => e !== direkt)]
    let gedeckelt = false
    let fehler = 0
    for (const e of reihenfolge) {
      let meta: Seitenmeta | null
      try {
        meta = await metaVon(e.loc)
      } catch {
        fehler += 1
        continue
      }
      if (meta === null) {
        gedeckelt = true
        continue
      }
      const weg = tamediaWeg(meta, stueck)
      if (weg === null) continue
      return {
        status: 'gefunden',
        treffer: {
          url: e.loc,
          titel: meta.headline ?? e.titel,
          abo:
            meta.isAccessibleForFree === null
              ? null
              : !meta.isAccessibleForFree,
          weg
        }
      }
    }
    const teile = [
      `${eintraege.length} Eintraege der News-Sitemap von ${tuer.host} im Fenster`
    ]
    if (gedeckelt)
      teile.push(`Deckel von ${maxSeiten} Seitenabrufen je Lauf erreicht`)
    if (fehler > 0) teile.push(`${fehler} Seiten nicht lesbar`)
    return {
      status: gedeckelt ? 'fehler' : 'nicht_gefunden',
      hinweis: `kein Treffer auf Print-Titel, Lead oder Online-Titel — ${teile.join(', ')}`
    }
  }

  return {
    async suche(medium, stueck) {
      const tuer = tuerFuer(medium)
      if (tuer === null) return { status: 'keine_tuer' }
      try {
        return tuer.verlag === 'chmedia'
          ? await sucheChmedia(tuer, stueck)
          : await sucheTamedia(tuer, stueck)
      } catch (fehler) {
        return {
          status: 'fehler',
          hinweis:
            fehler instanceof Error ? fehler.message : 'Unbekannter Fehler'
        }
      }
    },
    protokoll: () => ({ anfragen, seiten, hosts: [...hosts].sort() })
  }
}
