// Reading a weekly paper's WordPress archive — the pure half.
//
// The archive is a list of links, newest first, and that order is the only
// ordering this module trusts: slugs are irregular (`bwb-kw26-2026_v2`,
// `bwb-kw19-2026-2`, weeks missing over the summer), so URLs are never
// constructed, only read. The canonical `schluessel` normalizes those slug
// accidents away — it is what makes the daily run idempotent when the same
// list is read every morning.

export interface ArchivEintrag {
  /** The slug as the archive prints it, suffixes and all. */
  slug: string
  /** Canonical identity: `kw34-2026` or `2026-08-21`, slug accidents normalized away. */
  schluessel: string
  /** As the paper prints it — "34", or "30/31" for a double issue. */
  nummer: string | null
  /** Publication date from the link text, `YYYY-MM-DD`. */
  datum: string | null
  /** The issue page — in Binningen's archive it 301-redirects straight to the PDF. */
  seiteUrl: string
  /**
   * Ordering number within the year: the calendar week for week-keyed papers,
   * the day of the year for date-keyed ones. Only ever compared within one
   * paper, so the two scales never meet.
   */
  kw: number | null
  jahr: number | null
}

const MONATE: Record<string, number> = {
  januar: 1,
  februar: 2,
  maerz: 3,
  märz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12
}

/** "20. August 2026" → "2026-08-20". Null for anything else — never guessed. */
export function parseDeutschesDatum(text: string): string | null {
  const treffer = /(\d{1,2})\.\s*([A-Za-zÄÖÜäöü]+)\s*(\d{4})/.exec(text)
  if (treffer === null) return null

  const tag = Number(treffer[1])
  const monat = MONATE[(treffer[2] ?? '').toLowerCase()]
  const jahr = Number(treffer[3])
  if (monat === undefined || tag < 1 || tag > 31) return null

  return `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`
}

/**
 * The canonical identity of an issue, out of an irregular slug.
 *
 * `bwb-kw26-2026_v2` and a hypothetical `bwb-kw26-2026` are the same issue —
 * the `_v2` is the archive replacing a broken upload, not a new paper. Only
 * week and year carry identity; everything else is publishing noise.
 */
export function normalisiereSchluessel(
  slug: string
): { schluessel: string; kw: number; jahr: number } | null {
  const woche = /kw(\d{1,2})\D*?(20\d{2})/i.exec(slug)
  if (woche !== null) {
    const kw = Number(woche[1])
    const jahr = Number(woche[2])
    if (kw < 1 || kw > 53) return null
    return { schluessel: `kw${String(kw).padStart(2, '0')}-${jahr}`, kw, jahr }
  }

  // Date-keyed papers (lokalzeitungen.ch): the slug carries DD-MM-YYYY, our
  // stored key is the ISO date. The "week" becomes the day of the year — an
  // ordering number on the same only-compared-within-one-paper contract.
  const imSlug = /(\d{2})-(\d{2})-(20\d{2})/.exec(slug)
  const alsIso = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(slug)
  let tag: number
  let monat: number
  let jahr: number
  if (imSlug !== null) {
    tag = Number(imSlug[1])
    monat = Number(imSlug[2])
    jahr = Number(imSlug[3])
  } else if (alsIso !== null) {
    jahr = Number(alsIso[1])
    monat = Number(alsIso[2])
    tag = Number(alsIso[3])
  } else {
    return null
  }
  const iso = `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`
  const geparst = new Date(`${iso}T00:00:00Z`)
  if (
    Number.isNaN(geparst.getTime()) ||
    geparst.toISOString().slice(0, 10) !== iso
  ) {
    return null
  }

  const jahresanfang = Date.UTC(jahr, 0, 1)
  const tagImJahr =
    Math.floor((geparst.getTime() - jahresanfang) / 86_400_000) + 1

  return { schluessel: iso, kw: tagImJahr, jahr }
}

/** Strictly newer, by (year, week) — the cutoff rule for the daily run. */
export function istNeuer(
  a: { jahr: number | null; kw: number | null },
  b: { jahr: number | null; kw: number | null }
): boolean {
  if (a.jahr === null || a.kw === null || b.jahr === null || b.kw === null) {
    return false
  }
  return a.jahr > b.jahr || (a.jahr === b.jahr && a.kw > b.kw)
}

/**
 * Every issue link of the archive page, in source order (newest first).
 *
 * Matched by the slug carrying a calendar week, not by position in the DOM —
 * the page is a WordPress/Elementor build whose wrappers change with every
 * theme update, while "a link whose slug names a week" is what the archive
 * fundamentally is.
 */
export function parseArchiv(html: string, basisUrl: string): ArchivEintrag[] {
  const basis = new URL(basisUrl)
  const eintraege: ArchivEintrag[] = []
  const gesehen = new Set<string>()

  // `</a\s*>` rather than `</a>`: HTML formatters split closing tags across
  // lines, and a fixture that went through one must parse like the live page.
  const anker = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a\s*>/gi
  let treffer: RegExpExecArray | null
  while ((treffer = anker.exec(html)) !== null) {
    const href = treffer[1] ?? ''
    let url: URL
    try {
      url = new URL(href, basis)
    } catch {
      continue
    }
    if (url.host !== basis.host) continue

    const slug = url.pathname.replace(/^\/|\/$/g, '')
    if (slug === '' || slug.includes('/')) continue

    const kanon = normalisiereSchluessel(slug)
    if (kanon === null) continue

    // The same issue can be linked twice (menu + list); the first occurrence
    // wins, which in source order is also the more prominent one.
    if (gesehen.has(slug)) continue
    gesehen.add(slug)

    const text = (treffer[2] ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const nummer =
      /kw\s?(\d{1,2}(?:\/\d{1,2})?)/i.exec(text)?.[1] ?? String(kanon.kw)

    eintraege.push({
      slug,
      schluessel: kanon.schluessel,
      nummer,
      datum: parseDeutschesDatum(text),
      seiteUrl: url.toString(),
      kw: kanon.kw,
      jahr: kanon.jahr
    })
  }

  return eintraege
}

/**
 * Every issue link of a lokalzeitungen.ch paper page, in source order.
 *
 * That platform's landing page (`/riehener-zeitung/`) links the CURRENT issue
 * as `/ausgabe/<paper>-DD-MM-YYYY/` — usually exactly one. That is enough for
 * the daily check: the date is the identity, and anything newer than what we
 * hold is the day's work.
 */
export function parseLokalzeitungen(
  html: string,
  basisUrl: string
): ArchivEintrag[] {
  const basis = new URL(basisUrl)
  const eintraege: ArchivEintrag[] = []
  const gesehen = new Set<string>()

  const anker = /<a\s[^>]*href="([^"]+)"[^>]*>/gi
  let treffer: RegExpExecArray | null
  while ((treffer = anker.exec(html)) !== null) {
    let url: URL
    try {
      url = new URL(treffer[1] ?? '', basis)
    } catch {
      continue
    }
    if (url.host !== basis.host) continue

    const pfad = url.pathname.replace(/^\/|\/$/g, '')
    if (!pfad.startsWith('ausgabe/')) continue
    const slug = pfad.slice('ausgabe/'.length)
    if (slug === '' || slug.includes('/')) continue

    const kanon = normalisiereSchluessel(slug)
    if (kanon === null) continue
    if (gesehen.has(slug)) continue
    gesehen.add(slug)

    eintraege.push({
      slug,
      schluessel: kanon.schluessel,
      // The printed issue number is not on this page; the operation derives it
      // from the PDF's own filename (RZ-KW34-2026.pdf) once downloaded.
      nummer: null,
      datum: kanon.schluessel,
      seiteUrl: url.toString(),
      kw: kanon.kw,
      jahr: kanon.jahr
    })
  }

  return eintraege
}

/**
 * The paywall-free PDF behind a lokalzeitungen.ch issue page: the title link
 * points straight at `wp-content/uploads/…pdf`. First same-host PDF link wins.
 */
export function findePdfLink(html: string, basisUrl: string): string | null {
  const basis = new URL(basisUrl)
  const anker = /<a\s[^>]*href="([^"]+\.pdf)"[^>]*>/gi
  let treffer: RegExpExecArray | null
  while ((treffer = anker.exec(html)) !== null) {
    try {
      const url = new URL(treffer[1] ?? '', basis)
      if (url.host === basis.host) return url.toString()
    } catch {
      continue
    }
  }
  return null
}

/**
 * Every issue link of an issuu e-paper listing, in source order.
 *
 * The Wochenblatt für das Birseck lists its issues as plain links to
 * `issuu.com/az-anzeiger/docs/<slug>`, newest first, and the slug carries
 * everything: `35_20260827_woz_wobanz` is Nr. 35 of 2026-08-27, a double
 * issue reads `30-31_20260723_…`. The printed number doubles as the calendar
 * week, so the canonical key is the same `kwNN-YYYY` the WordPress archive
 * produces.
 */
export function parseIssuuEpaper(html: string): ArchivEintrag[] {
  const eintraege: ArchivEintrag[] = []
  const gesehen = new Set<string>()

  const anker = /<a\s[^>]*href="([^"]+)"[^>]*>/gi
  let treffer: RegExpExecArray | null
  while ((treffer = anker.exec(html)) !== null) {
    let url: URL
    try {
      url = new URL(treffer[1] ?? '')
    } catch {
      continue
    }
    if (!/(^|\.)issuu\.com$/i.test(url.host)) continue

    const pfad = /^\/([^/]+)\/docs\/([^/]+)$/.exec(
      url.pathname.replace(/\/$/, '')
    )
    if (pfad === null) continue
    const slug = pfad[2] ?? ''

    const teile = /^(\d{1,2})(?:-(\d{1,2}))?_(20\d{2})(\d{2})(\d{2})_/.exec(
      slug
    )
    if (teile === null) continue
    const kw = Number(teile[1])
    if (kw < 1 || kw > 53) continue
    const iso = `${teile[3]}-${teile[4]}-${teile[5]}`
    const datum = new Date(`${iso}T00:00:00Z`)
    if (
      Number.isNaN(datum.getTime()) ||
      datum.toISOString().slice(0, 10) !== iso
    ) {
      continue
    }
    const jahr = Number(teile[3])

    if (gesehen.has(slug)) continue
    gesehen.add(slug)

    eintraege.push({
      slug,
      schluessel: `kw${String(kw).padStart(2, '0')}-${jahr}`,
      nummer: teile[2] === undefined ? String(kw) : `${kw}/${Number(teile[2])}`,
      datum: iso,
      // The reader page, https enforced (the listing links `http://`) and the
      // embed query stripped — this address is also what a Meldung's source
      // line deep-links into, as `…/docs/<slug>/<seite>`.
      seiteUrl: `https://issuu.com/${pfad[1]}/docs/${slug}`,
      kw,
      jahr
    })
  }

  return eintraege
}

/**
 * The document id an issuu reader page carries in its script payload — the
 * only key the publisher-enabled download API needs. Exactly one occurrence
 * on a real document page; null when the page shape changed.
 */
export function findeIssuuPublicationId(html: string): string | null {
  return (
    /\\?"publicationId\\?":\s*\\?"([0-9a-f]{32})\\?"/.exec(html)?.[1] ?? null
  )
}

/**
 * Every issue of a Localpoint-CMS e-paper listing, in source order.
 *
 * The BiBo (Birsigtal-Bote) runs on Localpoint's CMS: the listing page embeds
 * its issues as JSON in `<script id="data-epapers">` — `name` is the issue
 * date as `DD.MM.YYYY`, `unique_id` identifies the document. The reader lives
 * at `/bcms/read_epaper?id={jahr}/{datum-iso}-{unique_id}` on the same host.
 * The printed number is not in the listing; it is read off the front page's
 * text layer once the PDF is downloaded (`nummerAusErsterSeite`).
 */
export function parseLocalpointEpaper(
  html: string,
  basisUrl: string
): ArchivEintrag[] {
  const basis = new URL(basisUrl)
  const block = /<script[^>]*id="data-epapers"[^>]*>([\s\S]*?)<\/script>/i.exec(
    html
  )
  if (block === null) return []

  let roh: unknown
  try {
    roh = JSON.parse(block[1] ?? '')
  } catch {
    return []
  }
  if (!Array.isArray(roh)) return []

  const eintraege: ArchivEintrag[] = []
  const gesehen = new Set<string>()

  for (const item of roh) {
    if (typeof item !== 'object' || item === null) continue
    const e = item as Record<string, unknown>
    const name = typeof e.name === 'string' ? e.name : ''
    const uniqueId = typeof e.unique_id === 'string' ? e.unique_id : ''
    const datumTeile = /^(\d{2})\.(\d{2})\.(20\d{2})$/.exec(name)
    if (datumTeile === null || uniqueId === '') continue

    const iso = `${datumTeile[3]}-${datumTeile[2]}-${datumTeile[1]}`
    const kanon = normalisiereSchluessel(iso)
    if (kanon === null) continue

    const slug = `${iso}-${uniqueId}`
    if (gesehen.has(slug)) continue
    gesehen.add(slug)

    eintraege.push({
      slug,
      schluessel: kanon.schluessel,
      nummer: null,
      datum: iso,
      seiteUrl: `${basis.origin}/bcms/read_epaper?id=${kanon.jahr}/${slug}`,
      kw: kanon.kw,
      jahr: kanon.jahr
    })
  }

  return eintraege
}

/**
 * The original PDF behind a Localpoint reader page.
 *
 * The reader page embeds an iframe on `epaper.blitzbucket.com/p/{pub}/{jahr}/
 * {datei}`, and the reader's own download button opens
 * `files.localpoint.ch/pdf/{pub}/{jahr}/{datei}.pdf` — the same coordinates,
 * so the address is derived, never guessed. Null when the page shape changed.
 */
export function findeLocalpointPdf(html: string): string | null {
  const treffer =
    /https:\/\/epaper\.blitzbucket\.com\/p\/([\w-]+)\/(\d{4})\/([\w-]+)/.exec(
      html
    )
  if (treffer === null) return null
  return `https://files.localpoint.ch/pdf/${treffer[1]}/${treffer[2]}/${treffer[3]}.pdf`
}

/**
 * The printed issue number, read off the front page's text layer.
 *
 * Localpoint listings never state it, but the front page prints it in the
 * head ("BIBO NR. 35 | 82. JAHRGANG"). Null when the page says nothing —
 * the attribution then falls back to the issue date, never to a guess.
 */
export function nummerAusErsterSeite(text: string): string | null {
  const treffer = /\bNr\.\s?(\d{1,2})\b/i.exec(text.slice(0, 600))
  if (treffer === null) return null
  const nummer = Number(treffer[1])
  return nummer >= 1 && nummer <= 53 ? String(nummer) : null
}

/**
 * Un-space letter-spaced ALL-CAPS runs from a PDF text layer.
 *
 * InDesign sets section headers and kickers with wide letter-spacing, and the
 * text layer preserves it: the Wochenblatt für das Birseck prints its
 * municipality rubric as "R E I N AC H", "M Ü NC H E N S T E I N". When the
 * issue travels to the inventory as text (too large for a document block),
 * that garble hides exactly the signal the municipality assignment needs — so
 * a run of four or more short uppercase tokens is collapsed back into a word.
 * Body prose (lower-case, longer words) is left untouched.
 */
export function entspreizeVersalien(text: string): string {
  return text.replace(
    /(?<![A-Za-zÄÖÜäöü])(?:[A-ZÄÖÜ]{1,3} ){3,}[A-ZÄÖÜ]{1,3}(?![A-Za-zÄÖÜäöü])/g,
    (lauf) => lauf.replace(/ /g, '')
  )
}

/**
 * The link a source line uses for one page of an issue.
 *
 * A PDF address takes the `#page=N` viewer fragment; an issuu reader address
 * takes the page as a path segment — its viewer ignores fragments.
 */
export function seitenLink(pdfUrl: string, seite: number): string {
  try {
    if (/(^|\.)issuu\.com$/i.test(new URL(pdfUrl).host)) {
      return `${pdfUrl.replace(/\/$/, '')}/${seite}`
    }
  } catch {
    // Not a parseable URL — the fragment form is the harmless default.
  }
  return `${pdfUrl}#page=${seite}`
}

/**
 * The printed issue number, read off the PDF's own filename.
 *
 * Date-keyed archives never state it, but the paper's file does:
 * `RZ-KW34-2026.pdf`. Null when the filename says nothing — the attribution
 * then falls back to the issue date, never to a guess.
 */
export function nummerAusDateiname(url: string): string | null {
  const datei = url.split('/').pop() ?? ''
  const treffer = /kw\s?-?(\d{1,2})/i.exec(datei)
  if (treffer === null) return null
  const kw = Number(treffer[1])
  return kw >= 1 && kw <= 53 ? String(kw) : null
}

/**
 * Which archive entries the daily run takes up.
 *
 * A paper with no stored issues takes exactly the newest entry — everything
 * older is ignored forever, that was the registration deal. Afterwards only
 * entries strictly newer than the newest stored week qualify, and at most ONE
 * per run: a weekly cannot legitimately produce more, and a gap after a
 * missed day self-heals one issue per morning, oldest first.
 */
export function waehleNeueAusgaben(
  archiv: readonly ArchivEintrag[],
  gespeicherteSchluessel: readonly string[]
): ArchivEintrag[] {
  if (archiv.length === 0) return []

  if (gespeicherteSchluessel.length === 0) {
    const neueste = archiv[0]
    return neueste === undefined ? [] : [neueste]
  }

  const bekannt = new Set(gespeicherteSchluessel)
  let obergrenze: { jahr: number; kw: number } | null = null
  for (const schluessel of gespeicherteSchluessel) {
    const kanon = normalisiereSchluessel(schluessel)
    if (
      kanon !== null &&
      (obergrenze === null || istNeuer(kanon, obergrenze))
    ) {
      obergrenze = kanon
    }
  }
  // Stored keys we cannot read are a data problem, not a licence to re-import
  // the archive — better no issue today than the whole backlog.
  if (obergrenze === null) return []
  const grenze = obergrenze

  const neue = archiv.filter(
    (eintrag) => !bekannt.has(eintrag.schluessel) && istNeuer(eintrag, grenze)
  )

  // Source order is newest first — the LAST new entry is the oldest, and the
  // one whose turn it is.
  const aelteste = neue[neue.length - 1]
  return aelteste === undefined ? [] : [aelteste]
}
