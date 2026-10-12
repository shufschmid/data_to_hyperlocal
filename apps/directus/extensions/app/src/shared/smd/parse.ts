// The SMD «Dossier» — one PDF a day from the Schweizer Mediendatenbank's saved
// search, read from its text layer and cut into DOCUMENTS without a model.
//
// Measured on six dossiers of 6–11 October 2026 (65 documents, 278 pages).
// The PDF opens with a table of contents: one line per document, `DD-MM-YYYY
// <medium> <title> …… <page>`, a long title wrapping onto a second line that
// then carries the dots and the page number. Every page of the body opens with
// `© <medium> DD-MM-YYYY` and closes with `Dossier - <user> - DD-MM-YYYY <n>`,
// continuation pages included — so the TOC's page numbers, not the headers,
// are what cuts the documents. The medium comes from the first page's header
// and the title from the TOC line with the medium stripped; rubric, lead and
// byline are read off the first page by shape (large-font title lines wrap
// short, a byline is two or three capitalised words without punctuation).
//
// A BLOG — bz's «FCB aktuell», «Blaulicht Region Basel», «Regiosport-Aktuell»,
// schweizheute's «Wetter-Newsblog» — arrives whole every time one entry
// changed: 36 pages for three new entries, 200 of the 278 pages measured.
// Its entries are recognisable by their timestamp pair, `HH:MM Uhr` over
// `D. Monat` (sometimes with the weekday in front), and are returned as such;
// what to do with them is the desk's decision, not the parser's.

export interface DossierKopf {
  /** The day the dossier was compiled, ISO; null when the title page says nothing. */
  erstelltAm: string | null
  /** «Anzahl Dokumente N» on the title page — checked against the TOC. */
  anzahlDokumente: number | null
}

export interface InhaltsEintrag {
  /** ISO day of the piece, as the TOC prints it. */
  datum: string
  /** The TOC line without date, dots and page: `<medium> <title>`. */
  text: string
  /** 1-based page in the PDF. */
  seite: number
}

export interface BlogEintrag {
  /** ISO day, the year inferred from the dossier's date. */
  datum: string
  /** `HH:MM`. */
  zeit: string
  titel: string
  /** The entry's own lines, joined — up to the next entry. */
  text: string
}

export interface SmdDokument {
  medium: string
  /** ISO day from the TOC. */
  datum: string
  /** The line under the page header — a rubric («Sport», «Pratteln») or a blog's name. */
  rubrik: string | null
  titel: string
  lead: string | null
  autor: string | null
  /** Everything after the title, page headers and footers removed, lines joined with newlines. */
  text: string
  seiteVon: number
  seiteBis: number
  /** Set when the document is a blog: at least two timestamped entries. */
  blog: { name: string; eintraege: BlogEintrag[] } | null
}

export interface DossierLesung {
  kopf: DossierKopf
  dokumente: SmdDokument[]
  /** Every inference and every doubt, in words — for the run's result. */
  hinweise: string[]
}

const KOPF = /^© (.+?) (\d{2})-(\d{2})-(\d{4})$/
const FUSS = /^Dossier - .+ - \d{2}-\d{2}-\d{4} \d+$/
const TOC_ANFANG = /^(\d{2})-(\d{2})-(\d{4}) (.*)$/
const TOC_ENDE = /\.{3,}\s*(\d+)\s*$/
const ZEIT = /^(\d{1,2})[:.](\d{2}) Uhr$/
const MONATE: Record<string, number> = {
  januar: 1,
  februar: 2,
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
const TAG = new RegExp(
  `^(?:(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag),?\\s+)?(\\d{1,2})\\.\\s+(${Object.keys(MONATE).join('|')})$`,
  'i'
)

/** A blog's title lines are set large and wrap short; body lines run to ~60 characters. */
const TITEL_ZEILE_MAX = 45
const TITEL_ZEILEN_MAX = 3
/** How many lines after the title a byline may stand. */
const KOPF_ZEILEN_MAX = 8

function isoAus(tag: string, monat: string, jahr: string): string {
  return `${jahr}-${monat.padStart(2, '0')}-${tag.padStart(2, '0')}`
}

function zeilenVon(seite: string): string[] {
  return seite
    .split('\n')
    .map((z) => z.trim())
    .filter((z) => z !== '')
}

/** Letters and digits only, lowercase — what two spellings of one title have in common. */
export function normiereTitel(titel: string): string {
  return titel
    .normalize('NFC')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

// ---------------------------------------------------------------------------
// 1. The title page and the table of contents
// ---------------------------------------------------------------------------

export function parseKopf(zeilen: readonly string[]): DossierKopf {
  let erstelltAm: string | null = null
  let anzahlDokumente: number | null = null
  for (const z of zeilen) {
    const am = /^erstellt von .+ am (\d{2})-(\d{2})-(\d{4})$/.exec(z)
    if (am !== null) erstelltAm = isoAus(am[1] ?? '', am[2] ?? '', am[3] ?? '')
    const anzahl = /^Anzahl Dokumente (\d+)$/.exec(z)
    if (anzahl !== null) anzahlDokumente = Number(anzahl[1])
  }
  return { erstelltAm, anzahlDokumente }
}

/** The TOC lines, from «Inhaltsverzeichnis» on: one entry per `DD-MM-YYYY …… <page>`, wrapped titles joined. */
export function parseInhaltsverzeichnis(
  zeilen: readonly string[]
): InhaltsEintrag[] {
  const start = zeilen.indexOf('Inhaltsverzeichnis')
  if (start < 0) return []
  const eintraege: InhaltsEintrag[] = []
  let offen: { datum: string; text: string } | null = null
  for (const z of zeilen.slice(start + 1)) {
    if (FUSS.test(z)) continue
    const neu = TOC_ANFANG.exec(z)
    if (neu !== null) {
      offen = {
        datum: isoAus(neu[1] ?? '', neu[2] ?? '', neu[3] ?? ''),
        text: neu[4] ?? ''
      }
    } else if (offen !== null) {
      offen.text = `${offen.text} ${z}`
    } else {
      continue
    }
    const ende = TOC_ENDE.exec(offen.text)
    if (ende !== null) {
      eintraege.push({
        datum: offen.datum,
        text: offen.text.slice(0, ende.index).trim(),
        seite: Number(ende[1])
      })
      offen = null
    }
  }
  return eintraege
}

// ---------------------------------------------------------------------------
// 2. One document: head, body, blog entries
// ---------------------------------------------------------------------------

/** Two or three capitalised words, no punctuation — «Nils Løvold», «bz-Sportredaktion». */
export function istAutorZeile(zeile: string): boolean {
  if (zeile.length > 40) return false
  if (/[.:!?,;«»"()]/.test(zeile)) return false
  const tokens = zeile.split(/\s+/)
  if (tokens.length > 5) return false
  // Every word capitalised — or a particle («von», «de»), or a desk name
  // with the capital after its hyphen («bz-Sportredaktion»). A wrapped lead
  // line («Ein langer») has a lowercase word and is no byline.
  const PARTIKEL = new Set(['von', 'van', 'de', 'der', 'di', 'da', 'und'])
  if (
    !tokens.every(
      (t) =>
        /^\p{Lu}[\p{L}\-'’]*$/u.test(t) ||
        /^\p{Ll}[\p{L}]*-\p{Lu}[\p{L}\-]*$/u.test(t) ||
        PARTIKEL.has(t)
    )
  )
    return false
  // A single word is a byline only as a hyphenated desk name.
  if (tokens.length === 1 && !zeile.includes('-')) return false
  // A line in capitals («RAUM BASEL») is a rubric header, never a byline.
  if (tokens.some((t) => /^\p{Lu}{2,}$/u.test(t))) return false
  return true
}

/** Where a sentence ends — a lead's last line, or a body line that is no title. */
const SATZENDE = /[.!?»]\s*(\([a-z]{2,4}\))?$/

/** How many of the body's first lines spell the TOC's title (they wrap). */
function titelZeilen(zeilen: readonly string[], titel: string): number {
  const ziel = normiereTitel(titel)
  if (ziel === '') return 0
  let acc = ''
  let n = 0
  for (const z of zeilen.slice(0, 6)) {
    const naechste = acc + normiereTitel(z)
    if (!ziel.startsWith(naechste)) break
    acc = naechste
    n += 1
    if (acc === ziel) return n
  }
  // Only a full match counts; a prefix alone could be the title's first word
  // repeated in a kicker.
  return acc === ziel ? n : 0
}

interface Kopfteile {
  lead: string | null
  autor: string | null
}

/**
 * Lead and byline from the lines after the title: everything up to a byline
 * within the first eight lines, else up to the first sentence end.
 */
export function kopfteile(nachTitel: readonly string[]): Kopfteile {
  const fenster = nachTitel.slice(0, KOPF_ZEILEN_MAX)
  // A page that opens with a rubric in capitals («RAUM BASEL») has no lead.
  const erste = fenster[0] ?? ''
  if (erste !== '' && erste.split(/\s+/).every((t) => /^\p{Lu}{2,}$/u.test(t)))
    return { lead: null, autor: null }
  const autorIndex = fenster.findIndex(istAutorZeile)
  if (autorIndex >= 0) {
    const lead = fenster.slice(0, autorIndex).join(' ').trim()
    return {
      lead: lead === '' ? null : lead,
      autor: fenster[autorIndex] ?? null
    }
  }
  const satz = fenster.findIndex((z) => SATZENDE.test(z))
  if (satz >= 0 && satz < 6) {
    return {
      lead: fenster
        .slice(0, satz + 1)
        .join(' ')
        .trim(),
      autor: null
    }
  }
  return { lead: null, autor: null }
}

function blogDatum(tag: string, monat: string, dossierDatum: string): string {
  const m = MONATE[monat.toLowerCase()] ?? 1
  const dossierJahr = Number(dossierDatum.slice(0, 4))
  const dossierMonat = Number(dossierDatum.slice(5, 7))
  // «10. Oktober» in a dossier of 11 October is this year; «10. Juni» too; a
  // «20. Dezember» in a January dossier is last year's.
  const jahr = m > dossierMonat ? dossierJahr - 1 : dossierJahr
  return `${jahr}-${String(m).padStart(2, '0')}-${tag.padStart(2, '0')}`
}

/** The timestamped entries of a body — the blog's shape. */
export function parseBlogEintraege(
  zeilen: readonly string[],
  dossierDatum: string
): BlogEintrag[] {
  const anfaenge: number[] = []
  for (let i = 0; i + 1 < zeilen.length; i += 1) {
    if (ZEIT.test(zeilen[i] ?? '') && TAG.test(zeilen[i + 1] ?? ''))
      anfaenge.push(i)
  }
  const eintraege: BlogEintrag[] = []
  anfaenge.forEach((start, k) => {
    const ende = anfaenge[k + 1] ?? zeilen.length
    const zeit = ZEIT.exec(zeilen[start] ?? '')
    const tag = TAG.exec(zeilen[start + 1] ?? '')
    if (zeit === null || tag === null) return
    const rest = zeilen.slice(start + 2, ende)
    // Title lines are set large and wrap short; the body runs long.
    const titel: string[] = []
    for (const z of rest) {
      if (titel.length >= TITEL_ZEILEN_MAX) break
      if (titel.length > 0 && (z.length > TITEL_ZEILE_MAX || SATZENDE.test(z)))
        break
      titel.push(z)
      if (SATZENDE.test(z)) break
    }
    eintraege.push({
      datum: blogDatum(tag[1] ?? '', tag[2] ?? '', dossierDatum),
      zeit: `${(zeit[1] ?? '').padStart(2, '0')}:${zeit[2] ?? ''}`,
      titel: titel.join(' ').trim(),
      text: rest.slice(titel.length).join('\n').trim()
    })
  })
  return eintraege
}

/** One document from its pages — the shared shape of a plain article and a blog. */
export function parseDokument(
  eintrag: InhaltsEintrag,
  seiten: readonly string[][],
  seiteVon: number,
  seiteBis: number,
  dossierDatum: string,
  hinweise: string[]
): SmdDokument {
  const erste = seiten[0] ?? []
  const kopf = KOPF.exec(erste[0] ?? '')
  let medium: string
  if (kopf !== null) {
    medium = kopf[1] ?? ''
  } else {
    medium = eintrag.text.split(' ')[0] ?? ''
    hinweise.push(
      `Seite ${seiteVon}: kein Seitenkopf «© Medium Datum» — Medium «${medium}» aus dem Inhaltsverzeichnis geraten`
    )
  }
  const titel =
    eintrag.text.startsWith(`${medium} `) || eintrag.text === medium
      ? eintrag.text.slice(medium.length).trim()
      : eintrag.text
  if (titel === eintrag.text && kopf !== null)
    hinweise.push(
      `Seite ${seiteVon}: die Zeile im Inhaltsverzeichnis beginnt nicht mit dem Medium «${medium}»`
    )

  // The body: every page's lines, headers and footers dropped; the first
  // page additionally loses the rubric line and the title's own lines.
  const ohneRahmen = seiten.map((zeilen) =>
    zeilen.filter((z) => !KOPF.test(z) && !FUSS.test(z))
  )
  const ersteOhneRahmen = ohneRahmen[0] ?? []
  const rubrik = ersteOhneRahmen[0] ?? null
  const nachRubrik = ersteOhneRahmen.slice(1)
  const n = titelZeilen(nachRubrik, titel)
  if (n === 0)
    hinweise.push(
      `Seite ${seiteVon}: der Titel «${titel.slice(0, 60)}» steht nicht am Seitenanfang — Rubrik und Titel nicht abgetrennt`
    )
  const koerper = [...nachRubrik.slice(n), ...ohneRahmen.slice(1).flat()]
  const { lead, autor } = kopfteile(koerper)
  const eintraege = parseBlogEintraege(koerper, dossierDatum)
  return {
    medium,
    datum: eintrag.datum,
    rubrik: rubrik === '' ? null : rubrik,
    titel,
    lead,
    autor,
    text: koerper.join('\n').trim(),
    seiteVon,
    seiteBis,
    blog:
      eintraege.length >= 2
        ? {
            name: rubrik === null || rubrik === '' ? `${medium} Blog` : rubrik,
            eintraege
          }
        : null
  }
}

// ---------------------------------------------------------------------------
// 3. The whole dossier
// ---------------------------------------------------------------------------

/**
 * Cuts a dossier's page texts into documents. The TOC's page numbers are the
 * only cut: a document runs from its page to the page before the next entry's.
 */
export function parseDossier(seitenTexte: readonly string[]): DossierLesung {
  const hinweise: string[] = []
  const seiten = seitenTexte.map(zeilenVon)
  // The title page and the TOC: every page before the first one that opens
  // with a header. A long TOC spills onto a second page.
  let ersteKoerperseite = seiten.findIndex((z) => KOPF.test(z[0] ?? ''))
  if (ersteKoerperseite < 0) ersteKoerperseite = seiten.length
  const vorspann = seiten.slice(0, ersteKoerperseite).flat()
  const kopf = parseKopf(vorspann)
  const inhalt = parseInhaltsverzeichnis(vorspann)
  if (inhalt.length === 0) {
    hinweise.push('Kein Inhaltsverzeichnis gefunden — keine Dokumente gelesen')
    return { kopf, dokumente: [], hinweise }
  }
  if (kopf.anzahlDokumente !== null && kopf.anzahlDokumente !== inhalt.length)
    hinweise.push(
      `Das Titelblatt nennt ${kopf.anzahlDokumente} Dokumente, das Inhaltsverzeichnis ${inhalt.length}`
    )
  const dossierDatum =
    kopf.erstelltAm ?? inhalt[0]?.datum ?? new Date().toISOString().slice(0, 10)

  const dokumente: SmdDokument[] = []
  inhalt.forEach((eintrag, k) => {
    const von = eintrag.seite
    const naechste = inhalt[k + 1]?.seite ?? seiten.length + 1
    const bis = naechste - 1
    if (von < 1 || von > seiten.length || bis < von) {
      hinweise.push(
        `Inhaltsverzeichnis: «${eintrag.text.slice(0, 60)}» nennt Seite ${von}, das Dossier hat ${seiten.length} Seiten — Dokument nicht gelesen`
      )
      return
    }
    dokumente.push(
      parseDokument(
        eintrag,
        seiten.slice(von - 1, bis),
        von,
        bis,
        dossierDatum,
        hinweise
      )
    )
  })
  return { kopf, dokumente, hinweise }
}
