import { blockZuText, kappe, TEXT_MAX_ZEICHEN } from '../gemeindeseite/text'
import { plausibel, type Heute } from '../gemeindeseite/datum'

// The canton's own data door, and the pure parsers over its answers.
//
// www.baselland.ch is a Nuxt frontend behind a Cloudflare Managed Challenge;
// the page itself reads a Plone REST API at bl-api.webcloud7.ch (the
// `apiUrls` of its `window.__NUXT__` config), which answers JSON to
// `Accept: application/json` with no challenge at all — measured on 28/29
// September 2026, when four of eight HTML requests were turned away and not
// one API request was. The riehenevents.ch rule: read the door the page
// itself calls.
//
// Two listing blocks carry everything the newsroom asked for. The general
// `NewsListingBlock` (tag `BL-Home`) holds every directorate's press
// releases — measured over its last 100 items: VGD 19/19, SID 8/8, BUD
// 20/20, Regierungsrat 25/25 — and the Polizeimeldungen block (tag
// `Polizeimeldungen`) holds what is NOT in it. Which blocks belong to a
// portal is a ROW (`quellen.konfiguration.listen`), never a constant.
//
// Three things measured that shape the parsers. A list item's `effective` is
// the publication instant, but 3 of 100 carry 1969 — the DATE comes from the
// detail's `news_date`, and an implausible `effective` keeps an item IN the
// window so the detail can decide. A press release carries no `description`
// (7 of 100), a police notice always does (20 of 20) — so every new item is
// opened and the municipality filter runs over the text. And the text sits as
// HTML in `slblocks[*].text.data`, ordered by `slblocks_layout`.

export type KantonKennung = 'medienmitteilung' | 'polizeimeldung'

export interface KantonListe {
  kennung: KantonKennung
  /** The block's path on the API host, e.g. `/startseite/ftw-news-newslistingblock`. */
  pfad: string
  /** Who speaks: «Kanton Basel-Landschaft» or «Polizei Basel-Landschaft». */
  name: string
}

export interface KantonKonfiguration {
  listen: KantonListe[]
  /** The public site the API paths are shown on — linked, never fetched. */
  seite: string
}

const KENNUNGEN: readonly KantonKennung[] = [
  'medienmitteilung',
  'polizeimeldung'
]

/** Reads `quellen.konfiguration` of a `kanton` row; throws in German so the run can put it on the row. */
export function leseKonfiguration(roh: unknown): KantonKonfiguration {
  const k =
    typeof roh === 'string'
      ? (JSON.parse(roh) as unknown)
      : (roh as Record<string, unknown> | null)
  if (typeof k !== 'object' || k === null)
    throw new Error('Die Konfiguration der Quelle fehlt (listen, seite).')
  const o = k as Record<string, unknown>
  const seite = typeof o['seite'] === 'string' ? o['seite'].trim() : ''
  if (!/^https:\/\/[^/]+$/.test(seite.replace(/\/$/, '')))
    throw new Error('Die Konfiguration nennt keine oeffentliche Seite (seite).')
  const listen = Array.isArray(o['listen']) ? o['listen'] : []
  const gelesen: KantonListe[] = []
  for (const l of listen as unknown[]) {
    if (typeof l !== 'object' || l === null) continue
    const z = l as Record<string, unknown>
    const kennung = z['kennung']
    if (
      typeof kennung !== 'string' ||
      !(KENNUNGEN as readonly string[]).includes(kennung) ||
      typeof z['pfad'] !== 'string' ||
      !z['pfad'].startsWith('/') ||
      typeof z['name'] !== 'string' ||
      z['name'].trim() === ''
    )
      throw new Error(
        `Eine Liste der Konfiguration ist unvollstaendig (kennung, pfad, name): ${JSON.stringify(l)}`
      )
    gelesen.push({
      kennung: kennung as KantonKennung,
      pfad: z['pfad'].replace(/\/$/, ''),
      name: z['name'].trim()
    })
  }
  if (gelesen.length === 0)
    throw new Error('Die Konfiguration nennt keine Liste (listen).')
  return { listen: gelesen, seite: seite.replace(/\/$/, '') }
}

export interface ListenItem {
  /** The API address (`@id`) — the item's identity at the source. */
  id: string
  titel: string
  teaser: string | null
  /** The publication instant as the list prints it; unreliable (1969 measured). */
  effective: string | null
}

export interface Liste {
  items: ListenItem[]
  total: number | null
  next: string | null
}

function text(wert: unknown): string | null {
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null
}

/** The listing block's items — `News` only, in the order the block prints them (newest first). */
export function parseListe(json: unknown): Liste {
  const o = (typeof json === 'object' && json !== null ? json : {}) as Record<
    string,
    unknown
  >
  const roh = Array.isArray(o['items']) ? (o['items'] as unknown[]) : []
  const items: ListenItem[] = []
  for (const r of roh) {
    if (typeof r !== 'object' || r === null) continue
    const i = r as Record<string, unknown>
    if (i['@type'] !== 'News') continue
    const id = text(i['@id'])
    const titel = text(i['title'])
    if (id === null || titel === null) continue
    items.push({
      id,
      titel,
      teaser: text(i['description']),
      effective: text(i['effective'])
    })
  }
  const batching = (
    typeof o['batching'] === 'object' && o['batching'] !== null
      ? o['batching']
      : {}
  ) as Record<string, unknown>
  return {
    items,
    total: typeof o['items_total'] === 'number' ? o['items_total'] : null,
    next: text(batching['next'])
  }
}

/** The date part of an instant, if it is a real calendar day within reach. */
function plausiblesDatum(wert: string | null, heute: Heute): string | null {
  if (wert === null) return null
  const tag = wert.slice(0, 10)
  return plausibel(tag, heute) ? tag : null
}

export type DatumQuelle = 'news_date' | 'effective' | 'keins'

/**
 * The day an item was published: `news_date` of the detail first (it is what
 * the list is sorted by), `effective` only as a plausible stand-in, else
 * nothing — and the caller says on the row which it was.
 */
export function datumAus(
  newsDate: string | null,
  effective: string | null,
  heute: Heute
): { datum: string | null; quelle: DatumQuelle } {
  const ausNewsDate = plausiblesDatum(newsDate, heute)
  if (ausNewsDate !== null) return { datum: ausNewsDate, quelle: 'news_date' }
  const ausEffective = plausiblesDatum(effective, heute)
  if (ausEffective !== null) return { datum: ausEffective, quelle: 'effective' }
  return { datum: null, quelle: 'keins' }
}

/**
 * Whether a list item belongs to the run's window. An item whose `effective`
 * is implausible stays IN — the detail decides — so the three 1969 rows of a
 * hundred are opened once rather than silently skipped for ever.
 */
export function imFenster(
  item: Pick<ListenItem, 'effective'>,
  seit: string,
  heute: Heute
): boolean {
  const tag = plausiblesDatum(item.effective, heute)
  return tag === null || tag >= seit
}

export interface Detail {
  titel: string | null
  teaser: string | null
  newsDate: string | null
  effective: string | null
  /** The placement tags — `BL-Home`, `Polizeimeldungen`, `SID-Startseite` … */
  subjects: string[]
  text: string
  textAbgeschnitten: boolean
  /** The path on the API host, the same path on the public site. */
  pfad: string | null
}

/** The block uids in the order the page lays them out; blocks the layout does not name follow in object order. */
function blockReihenfolge(o: Record<string, unknown>): string[] {
  const bloecke =
    typeof o['slblocks'] === 'object' && o['slblocks'] !== null
      ? (o['slblocks'] as Record<string, unknown>)
      : {}
  const geordnet: string[] = []
  const layout = o['slblocks_layout'] as { items?: unknown } | undefined
  const rows = Array.isArray(layout?.items) ? (layout.items as unknown[]) : []
  for (const row of rows) {
    const cols = Array.isArray((row as { items?: unknown })?.items)
      ? ((row as { items: unknown[] }).items as unknown[])
      : []
    for (const col of cols) {
      const uids = Array.isArray((col as { items?: unknown })?.items)
        ? ((col as { items: unknown[] }).items as unknown[])
        : []
      for (const uid of uids)
        if (typeof uid === 'string' && uid in bloecke) geordnet.push(uid)
    }
  }
  for (const uid of Object.keys(bloecke))
    if (!geordnet.includes(uid)) geordnet.push(uid)
  return geordnet
}

/** The detail of one item: its own date, its tags, its text as plain paragraphs. */
export function parseDetail(json: unknown): Detail {
  const o = (typeof json === 'object' && json !== null ? json : {}) as Record<
    string,
    unknown
  >
  const bloecke =
    typeof o['slblocks'] === 'object' && o['slblocks'] !== null
      ? (o['slblocks'] as Record<string, unknown>)
      : {}
  const teile: string[] = []
  for (const uid of blockReihenfolge(o)) {
    const b = bloecke[uid] as Record<string, unknown> | undefined
    if (b === undefined) continue
    const titel = text(b['title'])
    if (b['show_title'] === true && titel !== null && titel !== '.')
      teile.push(titel)
    const t = b['text'] as Record<string, unknown> | null | undefined
    const html = typeof t?.['data'] === 'string' ? t['data'] : null
    if (html !== null) {
      const klar = blockZuText(html)
      if (klar !== '') teile.push(klar)
    }
  }
  // A police notice keeps its opening paragraph in `description` and starts
  // the blocks with the second (measured on Buus); a press release repeats
  // nothing there. The teaser opens the text wherever the blocks do not
  // already carry it — the place a notice names is usually in that sentence.
  const teaser = text(o['description'])
  const bloeckeText = teile.join('\n\n').trim()
  const anfang = teaser?.slice(0, 40) ?? ''
  const volltext =
    teaser !== null && (anfang === '' || !bloeckeText.includes(anfang))
      ? `${teaser}\n\n${bloeckeText}`.trim()
      : bloeckeText
  const gekappt = kappe(volltext, TEXT_MAX_ZEICHEN)
  const id = text(o['@id'])
  let pfad: string | null = null
  if (id !== null) {
    try {
      pfad = new URL(id).pathname.replace(/\/$/, '')
    } catch {
      pfad = null
    }
  }
  return {
    titel: text(o['title']),
    teaser,
    newsDate: text(o['news_date']),
    effective: text(o['effective']),
    subjects: Array.isArray(o['subjects'])
      ? (o['subjects'] as unknown[]).filter(
          (s): s is string => typeof s === 'string'
        )
      : [],
    text: gekappt.text,
    textAbgeschnitten: gekappt.abgeschnitten,
    pfad
  }
}

const DIREKTIONEN: Record<string, string> = {
  sicherheitsdirektion: 'Sicherheitsdirektion',
  'bau-und-umweltschutzdirektion': 'Bau- und Umweltschutzdirektion',
  'volkswirtschafts-und-gesundheitsdirektion':
    'Volkswirtschafts- und Gesundheitsdirektion',
  'finanz-und-kirchendirektion': 'Finanz- und Kirchendirektion',
  'bildungs-kultur-und-sportdirektion': 'Bildungs-, Kultur- und Sportdirektion'
}

function humanisiert(slug: string): string {
  return slug
    .split('-')
    .filter((t) => t !== '')
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
    .join(' ')
}

/**
 * Who published, read off the path — the police before its directorate,
 * because a Polizeimeldung lives under the Sicherheitsdirektion. Unknown
 * folders are humanised rather than dropped: a new office is a name to show,
 * not a reason to lose the row.
 */
export function behoerdeAusPfad(pfad: string | null): string {
  const p = pfad ?? ''
  if (/\/polizei\//.test(p)) return 'Polizei Basel-Landschaft'
  const direktion = /\/direktionen\/([^/]+)\//.exec(p)?.[1]
  if (direktion !== undefined)
    return DIREKTIONEN[direktion] ?? humanisiert(direktion)
  if (/\/regierungsrat\//.test(p)) return 'Regierungsrat'
  if (/\/landeskanzlei\//.test(p)) return 'Landeskanzlei'
  if (/\/landrat-parlament\//.test(p)) return 'Landrat'
  if (/\/gerichte\//.test(p)) return 'Gerichte'
  const ordner = /^\/[^/]+\/([^/]+)\//.exec(p)?.[1]
  return ordner === undefined ? 'Kanton Basel-Landschaft' : humanisiert(ordner)
}

/** The item's path on the API host — the same path on the public site. */
export function pfadVon(apiId: string): string | null {
  try {
    return new URL(apiId).pathname.replace(/\/$/, '')
  } catch {
    return null
  }
}

/** The public page of an item: the API path on the site the newsroom links. */
export function oeffentlicheSeite(apiId: string, seite: string): string | null {
  const pfad = pfadVon(apiId)
  return pfad === null ? null : `${seite.replace(/\/$/, '')}${pfad}`
}
