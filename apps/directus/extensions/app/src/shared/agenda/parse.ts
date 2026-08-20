// Reading the statistics office's publication agenda.
//
// The page carries two kinds of entry, and the second one is the reason this
// connector exists at all:
//
//   published   <br>07.07.2026 <a href="…">Abfallstatistik 2025</a>
//   planned     Sozialhilfestatistik 2025<br>Gemeindefinanzen 2025<br>…
//
// Published entries say a statistic is out. Planned entries say one is coming
// this quarter, with no date yet — that is the lead time the open-data API
// cannot give us, because a dataset only appears there once it exists.
//
// For the waste statistics the gap was measurable: the agenda listed it on
// 7 July 2026, the machine-readable dataset was updated on 21 July.
//
// Parsing is deliberately a small set of regexes rather than a DOM library. The
// markup is flat and stable, and a parser dependency would be the third-largest
// thing in this bundle.

export interface AgendaEintrag {
  /** ISO date. Null for an entry that is only announced for a quarter. */
  datum: string | null
  /** e.g. "3. Quartal: Juli–September". Null when the page has no heading. */
  quartal: string | null
  titel: string
  /** Absolute URL, or null for a planned entry that has no target yet. */
  link: string | null
  status: 'publiziert' | 'geplant'
}

/** Content sits in these; using them keeps navigation and footer text out. */
const BLOCK = /<span class="text-nowrap">([\s\S]*?)<\/span>/gi

// The quarter text has to follow <strong> *directly*, which is what separates a
// heading from an entry that merely mentions a quarter:
//
//   heading   <strong>1. Quartal: Januar–März<br></strong>26.01.2026 <a …>
//   entry     Bevölkerungsstatistik, 2. Quartal 2026<strong><br></strong>
//
// The closing tag is deliberately not part of the match — the first quarter
// wraps a <br> inside the <strong>, and requiring </strong> misses it.
const QUARTAL_UEBERSCHRIFT = /<strong>\s*(\d\.\s*Quartal[^<]{0,40})/i
const MIT_DATUM =
  /(\d{2})\.(\d{2})\.(\d{4})\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i

// The page currently serves raw UTF-8, so the umlaut entries are belt and
// braces — but a CMS switching its output encoding is exactly the kind of
// change that would otherwise put "M&auml;rz" into a published article.
const ENTITAETEN: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç'
}

export function decodeEntities(value: string): string {
  return value.replace(
    /&(#\d+|#x[0-9a-f]+|\w+);/gi,
    (treffer, name: string) => {
      if (name.startsWith('#x') || name.startsWith('#X')) {
        return String.fromCodePoint(Number.parseInt(name.slice(2), 16))
      }
      if (name.startsWith('#')) {
        return String.fromCodePoint(Number.parseInt(name.slice(1), 10))
      }
      // Named entities are case-sensitive: &Auml; is Ä, &auml; is ä. Lowercasing
      // the lookup would quietly turn every capital umlaut into a small one.
      return ENTITAETEN[name] ?? treffer
    }
  )
}

function reinerText(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

function absolut(link: string, basisUrl: string): string {
  if (/^https?:\/\//i.test(link)) return link
  return `${basisUrl.replace(/\/+$/, '')}${link.startsWith('/') ? '' : '/'}${link}`
}

/** A title that is really an entry, not a stray fragment of layout. */
function istTitel(value: string): boolean {
  return (
    value.length >= 4 &&
    value.length <= 120 &&
    // A planned entry never carries its own date; those are the published ones.
    !/\d{2}\.\d{2}\.\d{4}/.test(value) &&
    !/^\d+\.\s*Quartal/i.test(value)
  )
}

export function parseAgenda(html: string, basisUrl: string): AgendaEintrag[] {
  const eintraege: AgendaEintrag[] = []
  const gesehen = new Set<string>()
  let quartal: string | null = null

  const merke = (eintrag: AgendaEintrag): void => {
    // The same statistic can appear once planned and later once published; the
    // key keeps both apart while suppressing genuine duplicates.
    const schluessel = `${eintrag.status}|${eintrag.datum ?? eintrag.quartal ?? ''}|${eintrag.titel}`
    if (gesehen.has(schluessel)) return
    gesehen.add(schluessel)
    eintraege.push(eintrag)
  }

  for (const block of html.matchAll(BLOCK)) {
    const inhalt = block[1] ?? ''

    const ueberschrift = QUARTAL_UEBERSCHRIFT.exec(inhalt)
    if (ueberschrift !== null) {
      quartal = reinerText(ueberschrift[1] ?? '')
      // Deliberately no `continue`: the first quarter puts its heading and its
      // first entry in the same block, so skipping ahead would lose the entry.
      // The heading itself cannot be mistaken for one — `istTitel` rejects it.
    }

    // `<br>` is the row separator inside a block, for both kinds of entry.
    for (const zeile of inhalt.split(/<br\s*\/?>/i)) {
      const datiert = MIT_DATUM.exec(zeile)

      if (datiert !== null) {
        const titel = reinerText(datiert[5] ?? '')
        if (titel === '') continue
        merke({
          datum: `${datiert[3]}-${datiert[2]}-${datiert[1]}`,
          quartal,
          titel,
          link: absolut(datiert[4] ?? '', basisUrl),
          status: 'publiziert'
        })
        continue
      }

      const titel = reinerText(zeile)
      if (!istTitel(titel)) continue

      merke({ datum: null, quartal, titel, link: null, status: 'geplant' })
    }
  }

  return eintraege
}

/**
 * Stable identity of an entry across runs.
 *
 * Deliberately excludes the date: an entry that was planned and then gets a
 * publication date is the *same* announcement reaching a new state, not a new
 * one. Keying on the date would report every publication twice.
 */
export function agendaSchluessel(eintrag: AgendaEintrag): string {
  return eintrag.titel.toLowerCase().replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// The same agenda, read from Markdown.
//
// Only used when every honest attempt has been refused: the crawler renders the
// page in a real browser, and what comes back is Markdown rather than the HTML
// `parseAgenda` above expects. The shape is flatter but carries everything —
// quarter heading, date, title, link:
//
//     **1. Quartal: Januar–März**26.01.2026
//     [Sozialmedizinische Institutionen 2024](https://statistik.bl.ch/…/14_4)
//
// The first date of a quarter is glued to its heading, which is why the date is
// searched for anywhere in the line rather than anchored at its start.

const MD_QUARTAL = /(\d\.\s*Quartal:[^*\n]*)/
const MD_DATUM = /(\d{2})\.(\d{2})\.(\d{4})/
const MD_TITEL = /^\[([^\]]+)\]\(([^)]+)\)$/

/**
 * Reads the agenda out of the crawler's Markdown.
 *
 * An entry needs a title; a date is optional, because the office announces some
 * statistics for a quarter without fixing a day. Those arrive as `geplant`,
 * exactly as from the HTML path, so the rest of the pipeline cannot tell which
 * route an entry took.
 */
export function parseAgendaMarkdown(markdown: string): AgendaEintrag[] {
  const zeilen = markdown
    .split('\n')
    .map((z) => z.trim())
    .filter((z) => z !== '')

  const eintraege: AgendaEintrag[] = []
  let quartal: string | null = null
  let datum: string | null = null

  for (const zeile of zeilen) {
    const q = MD_QUARTAL.exec(zeile)
    if (q !== null && q[1] !== undefined) quartal = q[1].trim()

    const titel = MD_TITEL.exec(zeile)
    if (titel !== null && titel[1] !== undefined && titel[2] !== undefined) {
      eintraege.push({
        datum,
        quartal,
        titel: titel[1].trim(),
        link: titel[2].trim(),
        status: datum === null ? 'geplant' : 'publiziert'
      })
      // Each date belongs to exactly one entry; keeping it would hand the same
      // day to every following title.
      datum = null
      continue
    }

    const d = MD_DATUM.exec(zeile.replace(/\*/g, ''))
    if (
      d !== null &&
      d[1] !== undefined &&
      d[2] !== undefined &&
      d[3] !== undefined
    ) {
      datum = `${d[3]}-${d[2]}-${d[1]}`
    }
  }

  return eintraege
}
