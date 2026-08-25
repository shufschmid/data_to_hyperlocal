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
  /** Canonical identity: `kw34-2026`, `_v2`/`-2` suffixes normalized away. */
  schluessel: string
  /** As the paper prints it — "34", or "30/31" for a double issue. */
  nummer: string | null
  /** Publication date from the link text, `YYYY-MM-DD`. */
  datum: string | null
  /** The issue page — in Binningen's archive it 301-redirects straight to the PDF. */
  seiteUrl: string
  /** First calendar week of the issue, for ordering. */
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
  const treffer = /kw(\d{1,2})\D*?(20\d{2})/i.exec(slug)
  if (treffer === null) return null

  const kw = Number(treffer[1])
  const jahr = Number(treffer[2])
  if (kw < 1 || kw > 53) return null

  return { schluessel: `kw${String(kw).padStart(2, '0')}-${jahr}`, kw, jahr }
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

  const anker = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
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
