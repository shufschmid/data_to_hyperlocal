/**
 * Pure reading of the official gazette portal's answers.
 *
 * Everything here is a pure function over strings the connector fetched, so the
 * rules can be tested without a network call. What travels over the wire lives
 * in `index.ts`.
 */

/** One publication as the list endpoint delivers it. */
export interface Publikation {
  id: string
  nummer: string
  rubrik: string
  unterrubrik: string
  titel: string
  publiziertAm: string
  kanton: string
  mandant: string
  amt: string
}

/**
 * A minimal RFC-4180 reader for the portal's semicolon-separated export.
 *
 * Not `split('\n')`: the `legalRemedy` column carries whole paragraphs of
 * appeal instructions, newlines and semicolons included, inside quotes. A
 * line-based reader tears those rows apart and every column after them shifts,
 * which is how a first attempt reported Zurich fire bans as Riehen news.
 */
export function parseCsv(text: string): string[][] {
  const zeilen: string[][] = []
  let zeile: string[] = []
  let feld = ''
  let inAnfuehrung = false

  for (let i = 0; i < text.length; i++) {
    const z = text[i]

    if (inAnfuehrung) {
      if (z === '"') {
        // A doubled quote is one literal quote, not the end of the field.
        if (text[i + 1] === '"') {
          feld += '"'
          i++
        } else {
          inAnfuehrung = false
        }
      } else {
        feld += z
      }
      continue
    }

    if (z === '"') inAnfuehrung = true
    else if (z === ';') {
      zeile.push(feld)
      feld = ''
    } else if (z === '\n' || z === '\r') {
      // Only close the row on the first character of the break.
      if (z === '\r' && text[i + 1] === '\n') i++
      zeile.push(feld)
      zeilen.push(zeile)
      zeile = []
      feld = ''
    } else feld += z
  }

  if (feld !== '' || zeile.length > 0) {
    zeile.push(feld)
    zeilen.push(zeile)
  }

  return zeilen
}

/**
 * The list export into typed rows. Columns are addressed by header name, never
 * by index — the portal's schema version moves and the order with it.
 */
export function parseListe(csv: string): Publikation[] {
  const zeilen = parseCsv(csv)
  const kopf = zeilen[0]
  if (kopf === undefined) return []

  const spalte = new Map(kopf.map((name, i) => [name.trim(), i]))
  const lies = (zeile: string[], name: string): string => {
    const i = spalte.get(name)
    return i === undefined ? '' : (zeile[i] ?? '').trim()
  }

  const treffer: Publikation[] = []
  for (const zeile of zeilen.slice(1)) {
    const id = lies(zeile, 'id')
    if (id === '') continue

    treffer.push({
      id,
      nummer: lies(zeile, 'publicationNumber'),
      rubrik: lies(zeile, 'rubric'),
      unterrubrik: lies(zeile, 'subRubric'),
      titel: lies(zeile, 'titleDe'),
      publiziertAm: lies(zeile, 'publicationDate'),
      kanton: lies(zeile, 'cantons'),
      mandant: lies(zeile, 'primaryTenantCode'),
      amt: lies(zeile, 'registrationOfficeDisplayName')
    })
  }
  return treffer
}

/**
 * The six kinds of publication the newsroom sorts by.
 *
 * `personen` is not a topic but a property: those rubrics name natural persons
 * in a private matter — a bankruptcy, a payment order, an estate, a property
 * sale. Keeping them together is what lets one rule cover them all.
 *
 * `beschaffung` is the one group the gazette shares with another source: it
 * also carries the simap.ch feed, whose rows arrive through `shared/simap` and
 * are marked `quelle_typ: 'simap'`.
 */
export type Gruppe =
  | 'bauen'
  | 'wirtschaft'
  | 'behoerden'
  | 'grundbuch'
  | 'personen'
  | 'beschaffung'

export const GRUPPEN_TEXT: Record<Gruppe, string> = {
  bauen: 'Bauen, Planung, Verkehr',
  wirtschaft: 'Handelsregister',
  behoerden: 'Behoerden und Buergerrecht',
  grundbuch: 'Grundbuch und Handaenderungen',
  personen: 'Konkurse, Betreibungen, Erbschaft',
  beschaffung: 'Oeffentliche Beschaffung'
}

/**
 * Sub-rubric first, rubric second.
 *
 * The boundaries genuinely run below the rubric: Solothurn files property
 * transfers under `BA-SO35` inside "Bau, Raum, Verkehr und Energie", where both
 * Basel cantons give the land registry a rubric of its own. Mapping on the
 * rubric alone would file the same event under two different headings
 * depending on the canton.
 */
const GRUPPE_JE_UNTERRUBRIK: Record<string, Gruppe> = {
  'BA-SO35': 'grundbuch',
  'BA-SO45': 'grundbuch',
  'BA-SO60': 'personen',
  'WB-BL80': 'bauen',
  'WB-BL18': 'bauen',
  'WB-BL17': 'personen',
  'WB-BL30': 'personen',
  'WB-BL90': 'personen',
  'VE-BS45': 'personen'
}

const GRUPPE_JE_RUBRIK: Record<string, Gruppe> = {
  // Bauen, Planung, Verkehr
  'BP-BL': 'bauen',
  'RP-BL': 'bauen',
  'BP-BS': 'bauen',
  'RP-BS': 'bauen',
  'VE-BS': 'bauen',
  'BA-SO': 'bauen',
  // Handelsregister
  HR: 'wirtschaft',
  BH: 'wirtschaft',
  // Behoerden
  'RS-BL': 'behoerden',
  'PL-BL': 'behoerden',
  'KW-BL': 'behoerden',
  'SW-BL': 'behoerden',
  'WB-BL': 'behoerden',
  'RS-BS': 'behoerden',
  'PR-BS': 'behoerden',
  'BV-BS': 'behoerden',
  'KO-BS': 'behoerden',
  'KA-BS': 'behoerden',
  'BW-BS': 'behoerden',
  'BE-BS': 'behoerden',
  // Basel-Stadt publishes its procurement notices in the gazette, so this one
  // rubric belongs with the simap.ch feed rather than with the authorities'
  // pile. A BS tender can therefore show up twice — once here, once from simap
  // — and that is deliberate: the two carry different ids, the duplicate is
  // visible side by side, and the editor rejecting one as `doublette` teaches
  // the next triage. Matching them on titles would be guesswork.
  'OB-BS': 'beschaffung',
  'AI-BS': 'behoerden',
  'KW-BS': 'behoerden',
  'SW-BS': 'behoerden',
  'RE-SO': 'behoerden',
  'BU-SO': 'behoerden',
  'AL-SO': 'behoerden',
  'AR-SO': 'behoerden',
  AB: 'behoerden',
  // Grundbuch
  'GR-BL': 'grundbuch',
  'GR-BS': 'grundbuch',
  // Personen
  KK: 'personen',
  SB: 'personen',
  NA: 'personen',
  LS: 'personen',
  ES: 'personen',
  SR: 'personen',
  UP: 'personen',
  UV: 'personen',
  AW: 'personen',
  'GB-BL': 'personen',
  'GB-BS': 'personen',
  'TE-BL': 'personen',
  'TE-BS': 'personen',
  'FZ-BS': 'personen',
  'GE-SO': 'personen',
  'VA-SO': 'personen'
}

/** `null` for a rubric the newsroom does not collect — the row is dropped. */
export function gruppeVon(rubrik: string, unterrubrik: string): Gruppe | null {
  return GRUPPE_JE_UNTERRUBRIK[unterrubrik] ?? GRUPPE_JE_RUBRIK[rubrik] ?? null
}

/** German names, from the portal's own `/api/v1/rubrics` catalogue. */
const RUBRIK_TEXT: Record<string, string> = {
  'BP-BL': 'Baugesuche',
  'GB-BL': 'Gerichtliche Bekanntmachungen',
  'GR-BL': 'Grundbuch',
  'KW-BL': 'Kirchenwesen',
  'PL-BL': 'Politische Rechte',
  'RP-BL': 'Raumplanung',
  'RS-BL': 'Landrat und Regierungsrat',
  'SW-BL': 'Steuerwesen',
  'TE-BL': 'Erbschaftsamtliche Bekanntmachungen',
  'WB-BL': 'Allgemeine Bekanntmachungen',
  'AI-BS': 'Kantonale Anzeigen und Inserate',
  'BE-BS': 'Bewilligungen',
  'BP-BS': 'Baupublikationen und Nutzungsgesuche',
  'BV-BS': 'Buergerrecht und Aufenthalt',
  'BW-BS': 'Bildungswesen',
  'FZ-BS': 'Familie und Zivilstandswesen',
  'GB-BS': 'Gerichtliche Entscheide und Vorladungen',
  'GR-BS': 'Grundbuch',
  'KA-BS': 'Weitere kantonale Bekanntmachungen',
  'KO-BS': 'Weitere kommunale Bekanntmachungen',
  'KW-BS': 'Kirchenwesen',
  'OB-BS': 'Oeffentliches Beschaffungswesen',
  'PR-BS': 'Politische Rechte',
  'RP-BS': 'Raumplanung',
  'RS-BS': 'Beschluesse und Erlasse',
  'SW-BS': 'Steuerwesen',
  'TE-BS': 'Erbschaftsamtliche Bekanntmachungen',
  'VE-BS': 'Umwelt, Verkehr und Energie',
  'AL-SO': 'Allgemeine amtliche Bekanntmachungen',
  'AR-SO': 'Wirtschaft, Arbeit und Bildung',
  'BA-SO': 'Bau, Raum, Verkehr und Energie',
  'BU-SO': 'Buergerrecht, Steuer- und Zivilstandswesen',
  'GE-SO': 'Gerichtliche Entscheide und Vorladungen',
  'RE-SO': 'Behoerden und politische Rechte',
  'VA-SO': 'Verschollenheit, Ableben und Erbschaft',
  AB: 'Arbeit',
  AW: 'Abhandengekommene Wertpapiere',
  BB: 'Weitere Register und Bekanntmachungen Bund',
  BH: 'Bekanntmachungen nach Handelsregisterverordnung',
  ES: 'Erbschaft',
  HR: 'Handelsregistereintragungen',
  KK: 'Konkurse',
  LS: 'Liquidationsschuldenrufe',
  NA: 'Nachlassverfahren',
  SB: 'Schuldbetreibungen',
  SR: 'Weitere gesellschaftsrechtliche Schuldenrufe',
  UP: 'Mitteilungen an Gesellschafter',
  UV: 'Gerichtliche Entscheide und Vorladungen'
}

/** The sub-rubrics worth naming precisely — the rest fall back to the rubric. */
const UNTERRUBRIK_TEXT: Record<string, string> = {
  'BA-SO05': 'Baugesuch',
  'BA-SO10': 'Oeffentliche Planauflage',
  'BA-SO35': 'Handaenderung',
  'BA-SO55': 'Verkehrsanordnung',
  'BP-BL05': 'Baugesuch',
  'GR-BL10': 'Handaenderung',
  'RP-BL10': 'Oeffentliche Planauflage',
  'RS-BL10': 'Beschluesse und Bekanntmachungen',
  'RS-BL20': 'Erlasse',
  'RS-BS65': 'Beschluss der Gemeinde Riehen',
  'RS-BS60': 'Beschluss der Gemeinde Bettingen',
  'RS-BS40': 'Beschluss des Grossen Rates',
  'RS-BS45': 'Beschluss des Regierungsrates',
  'VE-BS40': 'Verkehrsanordnung',
  'WB-BL80': 'Verkehrspolizeiliche Anordnung',
  'BV-BS10': 'Buergerrecht',
  HR01: 'Neueintragung',
  HR02: 'Mutation',
  HR03: 'Loeschung'
}

export function rubrikName(rubrik: string, unterrubrik: string): string {
  return UNTERRUBRIK_TEXT[unterrubrik] ?? RUBRIK_TEXT[rubrik] ?? rubrik
}

/**
 * The source link, derived and never written.
 *
 * The official PDF rather than the portal's single-page app: it is one stable
 * address, it renders without JavaScript, and it is the document the office
 * actually published. Measured: 200, `application/pdf`.
 */
export function quellenlink(id: string): string {
  return `https://amtsblattportal.ch/api/v1/publications/${id}/pdf`
}

/** One fact from the publication's `<content>`, already flattened. */
export interface Angabe {
  bezeichnung: string
  wert: string
}

/**
 * What a publication points at besides itself.
 *
 * `lesbar` is the whole point: Basel-Landschaft puts the building plans online
 * as plain images, so the newsroom can look at them. Solothurn's eBau portal is
 * a single-page app whose API answers 401 — the link is worth showing and
 * impossible to read, and saying so is better than a silent empty result.
 */
export interface Unterlage {
  art: 'plaene' | 'akten' | 'karte' | 'ebau' | 'andere'
  bezeichnung: string
  url: string
  lesbar: boolean
}

export interface Inhalt {
  angaben: Angabe[]
  unterlagen: Unterlage[]
  /** `entryDeadline` — the date that makes an article urgent. */
  frist: string | null
  /** Names the publication attributes to natural persons. */
  personen: string[]
}

/**
 * Order matters here, and getting it wrong is invisible until it reaches a
 * reader.
 *
 * The gazette escapes its own markup, so a decision arrives as
 * `&lt;p>Der Einwohnerrat …&lt;/p>`. Stripping tags first leaves the escaped
 * ones untouched, and decoding afterwards turns them back into literal `<p>`
 * that no later pass removes. So: unescape the angle brackets, THEN strip, and
 * decode `&amp;` last so an `&amp;lt;` cannot smuggle a tag through.
 *
 * Exported because simap.ch hands its project descriptions as real HTML
 * (`<p>Innentüren und innere Verglasungen …</p>`), and the same order is right
 * there — one rule, one place.
 */
export function entferneMarkup(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function tagInhalt(xml: string, tag: string): string[] {
  const treffer: string[] = []
  const muster = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g')
  let m = muster.exec(xml)
  while (m !== null) {
    treffer.push(m[1] ?? '')
    m = muster.exec(xml)
  }
  return treffer
}

function bezeichneUnterlage(url: string, beschriftung: string): Unterlage {
  if (url.includes('bgauflage.bl.ch'))
    return { art: 'plaene', bezeichnung: 'Baugesuchsplaene', url, lesbar: true }
  if (url.includes('esti-consultation.ch'))
    return {
      art: 'akten',
      bezeichnung: 'Gesuchsunterlagen',
      url,
      lesbar: false
    }
  if (url.includes('portal-ebau'))
    return {
      art: 'ebau',
      bezeichnung: 'Baugesuch im eBau-Portal',
      url,
      lesbar: false
    }
  if (url.includes('geoview') || url.includes('map.geo'))
    return {
      art: 'karte',
      bezeichnung: 'Lage auf der Karte',
      url,
      lesbar: false
    }
  return {
    art: 'andere',
    bezeichnung: beschriftung === '' ? 'Weitere Unterlagen' : beschriftung,
    url,
    lesbar: false
  }
}

/**
 * The single publication's XML into facts, links and a deadline.
 *
 * Deliberately a flattening rather than a schema-aware parse: every rubric has
 * its own XSD (there are hundreds), and the newsroom needs the labelled values,
 * not the tree. The German label the office chose travels with the value, so a
 * building permit's "Auflagefrist" stays "Auflagefrist" without a mapping table
 * that would rot the moment a canton adds a field.
 */
export function parseInhalt(xml: string): Inhalt {
  const inhalt = xml.slice(xml.indexOf('<content>'))
  const angaben: Angabe[] = []
  const personen: string[] = []

  // `<element>` blocks carry a German `<term><de>` label and one value.
  for (const block of tagInhalt(inhalt, 'element')) {
    const bezeichnung = entferneMarkup(tagInhalt(block, 'de')[0] ?? '')
    const werte = tagInhalt(block, 'de')
      .slice(1)
      .map(entferneMarkup)
      .filter((w) => w !== '')
    const neutral = tagInhalt(block, 'valueTextNeutral').map(entferneMarkup)
    const wert = [...werte, ...neutral].filter((w) => w !== '').join(' — ')
    if (bezeichnung !== '' && wert !== '' && !wert.startsWith('http'))
      angaben.push({ bezeichnung, wert })
  }

  // Rubrics that publish prose rather than labelled fields (decisions, the
  // commercial register) carry it in a handful of named tags.
  for (const tag of [
    'publicationText',
    'enactment',
    'enactmentTitle',
    'projectDescription',
    'purpose',
    'decidingOffice',
    'dateDecision',
    'additionalLegalRemedy',
    'fullResolution'
  ]) {
    for (const roh of tagInhalt(inhalt, tag)) {
      const wert = entferneMarkup(roh)
      if (wert !== '') angaben.push({ bezeichnung: tag, wert })
    }
  }

  for (const roh of tagInhalt(inhalt, 'officialName')) {
    const name = entferneMarkup(roh)
    if (name !== '') personen.push(name)
  }
  for (const block of tagInhalt(inhalt, 'person')) {
    const vorname = entferneMarkup(tagInhalt(block, 'prename')[0] ?? '')
    const name = entferneMarkup(tagInhalt(block, 'name')[0] ?? '')
    const ganz = `${vorname} ${name}`.trim()
    if (ganz !== '') personen.push(ganz)
  }

  const unterlagen: Unterlage[] = []
  const gesehen = new Set<string>()
  for (const m of inhalt.matchAll(/https?:\/\/[^\s<>"'&)]+/g)) {
    const url = m[0]
    if (url.includes('w3.org') || url.includes('shab.ch/')) continue
    if (gesehen.has(url)) continue
    gesehen.add(url)
    unterlagen.push(bezeichneUnterlage(url, ''))
  }

  const frist = tagInhalt(inhalt, 'date')
    .map((d) => d.trim())
    .find((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))

  return {
    angaben,
    unterlagen,
    frist: frist ?? null,
    personen: [...new Set(personen)]
  }
}

/**
 * The plan viewer's image list.
 *
 * `bgauflage.bl.ch/pages/<Dossier>.html` is a thin gallery whose images are
 * declared in one inline `const images = [...]` array with paths relative to
 * the page. Measured on 1197/2026: four JPEGs, 330–440 KB, all public.
 */
export function planBilder(html: string, seiteUrl: string): string[] {
  const start = html.indexOf('const images')
  if (start === -1) return []
  const ende = html.indexOf('];', start)
  if (ende === -1) return []

  const basis = new URL(seiteUrl)
  const bilder: string[] = []
  for (const m of html.slice(start, ende).matchAll(/img:\s*'([^']+)'/g)) {
    const pfad = m[1]
    if (pfad === undefined) continue
    bilder.push(new URL(pfad, basis).toString())
  }
  return bilder
}
