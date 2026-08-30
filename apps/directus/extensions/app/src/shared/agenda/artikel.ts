// The office's web article behind an agenda entry.
//
// The agenda row is three words ("Bau- und Wohnbaustatistik 2025"); the article
// it links is the same statistic explained — what was counted, over which
// period, what stands out, and which portal tables belong to it. Two things
// come out of it:
//
//   1. Better material for the mapping. Matching "Bau- und Wohnbaustatistik
//      2025" against a catalogue of 188 titles from the title alone is a coin
//      toss between three housing datasets; the article names the subject.
//   2. Framing for the briefing. The figures always come from the dataset —
//      the article supplies the context the numbers sit in.
//
// Pure parsing only. The fetch lives with the caller, like everywhere else.

/** Longest article text handed on. Enough for the lead and the first section. */
export const ARTIKEL_MAX_ZEICHEN = 6000

const SKRIPT = /<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi
const TAG = /<[^>]+>/g

// The two things a statistics article links: portal tables by number, and a
// search on the open-data portal by term. Neither is a dataset id — measured on
// the real page, which links `web_portal/9_1` and `explore/?…q=Wohnbaustatistik`.
const PORTAL_TABELLE = /statistik\.bl\.ch\/web_portal\/(\d+(?:_\d+)*)/gi
const ODS_SUCHE = /data\.bl\.ch\/explore\/[^"'\s<>]*?[?&]q=([^"'&\s<>]+)/gi
const ODS_DATENSATZ = /data\.bl\.ch\/explore\/dataset\/([\w-]+)/gi

export interface Artikel {
  /** The readable text, entities resolved, whitespace collapsed, capped. */
  text: string
  /** Portal tables the article points at, e.g. `9_1`. Newest-first is not implied. */
  tabellen: string[]
  /** Search terms from open-data links — a hint at the subject, never an id. */
  suchbegriffe: string[]
  /** Dataset ids, when an article does link one directly. */
  datensaetze: string[]
}

function entities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&(?:#39|apos);/gi, "'")
    .replace(/&(?:auml|Auml|ouml|Ouml|uuml|Uuml|szlig|ndash|mdash);/gi, (t) => {
      const karte: Record<string, string> = {
        '&auml;': 'ä',
        '&Auml;': 'Ä',
        '&ouml;': 'ö',
        '&Ouml;': 'Ö',
        '&uuml;': 'ü',
        '&Uuml;': 'Ü',
        '&szlig;': 'ss',
        '&ndash;': '–',
        '&mdash;': '—'
      }
      return karte[t.toLowerCase()] ?? karte[t] ?? t
    })
}

function eindeutig(werte: string[]): string[] {
  return [...new Set(werte)]
}

/**
 * Reads one article page into the parts the pipeline can use.
 *
 * Deliberately forgiving: a page that changed its layout still yields text, and
 * an empty result is a normal answer rather than an error — the mapping falls
 * back to the title, exactly as before.
 */
export function parseArtikel(html: string): Artikel {
  // `&amp;` first: a query string in an href arrives escaped, so the parameter
  // after it is preceded by a semicolon rather than an ampersand and no
  // `[?&]q=` would ever match.
  const adressen = html.replace(/&amp;/gi, '&')

  const tabellen: string[] = []
  for (const treffer of adressen.matchAll(PORTAL_TABELLE)) {
    if (treffer[1] !== undefined) tabellen.push(treffer[1])
  }

  const suchbegriffe: string[] = []
  for (const treffer of adressen.matchAll(ODS_SUCHE)) {
    const roh = treffer[1]
    if (roh === undefined) continue
    try {
      const begriff = decodeURIComponent(roh.replace(/\+/g, ' ')).trim()
      if (begriff !== '') suchbegriffe.push(begriff)
    } catch {
      // Ein kaputt kodierter Parameter ist kein Grund, den Artikel zu verlieren.
    }
  }

  const datensaetze: string[] = []
  for (const treffer of adressen.matchAll(ODS_DATENSATZ)) {
    if (treffer[1] !== undefined) datensaetze.push(treffer[1])
  }

  const text = entities(html.replace(SKRIPT, ' ').replace(TAG, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ARTIKEL_MAX_ZEICHEN)

  return {
    text,
    tabellen: eindeutig(tabellen),
    suchbegriffe: eindeutig(suchbegriffe),
    datensaetze: eindeutig(datensaetze)
  }
}

/** Whether a link is one of the office's web articles — the only page we fetch. */
export function istWebartikel(link: string | null): boolean {
  return (
    link !== null &&
    /^https?:\/\/(www\.)?baselland\.ch\/.+webartikel/i.test(link)
  )
}
