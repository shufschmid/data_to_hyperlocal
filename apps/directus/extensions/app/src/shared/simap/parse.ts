// Reading simap.ch — the pure half. No network, no Directus, all unit-tested.
//
// simap.ch is the Swiss public procurement platform of the Confederation and
// the cantons. Its search and detail endpoints need no credentials, which is
// what makes this feed possible at all.
//
// Two shapes matter here and they are NOT the same:
//   - a SEARCH row: one per project, carrying its NEWEST publication
//   - a DETAIL document: everything about one publication of that project
// The desk row is built from both — the search row identifies it, the detail
// fills the facts a Meldung is written from.

import { entferneMarkup, type Angabe } from '../amtsblatt/parse'

/** simap translates its own fields; German first, then whatever exists. */
export interface Mehrsprachig {
  de?: string | null
  fr?: string | null
  it?: string | null
  en?: string | null
}

export function textVon(wert: Mehrsprachig | null | undefined): string {
  if (wert === null || wert === undefined) return ''
  return (wert.de ?? wert.fr ?? wert.it ?? wert.en ?? '').trim()
}

export interface SimapAdresse {
  countryId: string | null
  cantonId: string | null
  postalCode: string | null
  city: Mehrsprachig | null
}

/** One row of the public project search. */
export interface SimapProjekt {
  /** The project's uuid — what the public web link is built from. */
  id: string
  publicationId: string
  publikationsnummer: string
  projektnummer: string
  titel: string
  /** `tender`, `award`, `direct_award`, `advance_notice`, `abandonment`, … */
  pubTyp: string
  projektTyp: string
  projektUnterTyp: string
  verfahren: string
  publiziertAm: string
  vergabestelle: string
  korrigiert: boolean
  /** Where the work happens. Null where the office described it in prose only. */
  ort: SimapAdresse | null
}

export interface SimapSuchergebnis {
  projekte: SimapProjekt[]
  /** `<datum>|<projektnummer>`, handed back as `lastItem` for the next page. */
  weiter: string | null
}

function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === 'object' && wert !== null
}

function zeichenkette(wert: unknown): string {
  return typeof wert === 'string' ? wert : ''
}

function adresseVon(wert: unknown): SimapAdresse | null {
  if (!istObjekt(wert)) return null
  const plz = zeichenkette(wert['postalCode'])
  const kanton = zeichenkette(wert['cantonId'])
  if (plz === '' && kanton === '') return null
  return {
    countryId: zeichenkette(wert['countryId']) || null,
    cantonId: kanton || null,
    postalCode: plz || null,
    city: istObjekt(wert['city']) ? (wert['city'] as Mehrsprachig) : null
  }
}

/**
 * The search answer, validated.
 *
 * A row without an id or a publicationId is dropped rather than repaired: it
 * could neither be deduplicated nor linked, and the desk is not the place to
 * find out.
 */
export function parseSuche(antwort: unknown): SimapSuchergebnis {
  if (!istObjekt(antwort)) throw new Error('simap-Antwort ist kein Objekt.')
  const rohe = antwort['projects']
  if (!Array.isArray(rohe)) throw new Error('Feld "projects" fehlt.')

  const projekte: SimapProjekt[] = []
  for (const eintrag of rohe) {
    if (!istObjekt(eintrag)) continue
    const id = zeichenkette(eintrag['id'])
    const publicationId = zeichenkette(eintrag['publicationId'])
    if (id === '' || publicationId === '') continue

    projekte.push({
      id,
      publicationId,
      publikationsnummer: zeichenkette(eintrag['publicationNumber']),
      projektnummer: zeichenkette(eintrag['projectNumber']),
      titel: textVon(eintrag['title'] as Mehrsprachig),
      pubTyp: zeichenkette(eintrag['pubType']),
      projektTyp: zeichenkette(eintrag['projectType']),
      projektUnterTyp: zeichenkette(eintrag['projectSubType']),
      verfahren: zeichenkette(eintrag['processType']),
      publiziertAm: zeichenkette(eintrag['publicationDate']),
      vergabestelle: textVon(eintrag['procOfficeName'] as Mehrsprachig),
      korrigiert: eintrag['corrected'] === true,
      ort: adresseVon(eintrag['orderAddress'])
    })
  }

  const seite = antwort['pagination']
  const weiter = istObjekt(seite) ? zeichenkette(seite['lastItem']) : ''
  return { projekte, weiter: weiter === '' ? null : weiter }
}

/** German names for the publication types, from simap's own wording. */
const PUBTYP_TEXT: Record<string, string> = {
  tender: 'Ausschreibung',
  award: 'Zuschlag',
  direct_award: 'Freihaendige Vergabe',
  advance_notice: 'Vorankuendigung',
  abandonment: 'Abbruch des Verfahrens',
  revocation: 'Widerruf',
  participant_selection: 'Teilnehmerauswahl',
  selective_offering_phase: 'Angebotsphase (selektiv)',
  request_for_information: 'Marktabklaerung',
  competition: 'Wettbewerb',
  study_contract: 'Studienauftrag'
}

const UNTERTYP_TEXT: Record<string, string> = {
  construction: 'Bauauftrag',
  service: 'Dienstleistung',
  supply: 'Lieferauftrag',
  project_competition: 'Projektwettbewerb',
  idea_competition: 'Ideenwettbewerb',
  overall_performance_competition: 'Gesamtleistungswettbewerb',
  project_study: 'Projektstudienauftrag',
  idea_study: 'Ideenstudienauftrag',
  overall_performance_study: 'Gesamtleistungsstudienauftrag',
  request_for_information: 'Marktabklaerung'
}

const VERFAHREN_TEXT: Record<string, string> = {
  open: 'offenes Verfahren',
  selective: 'selektives Verfahren',
  invitation: 'Einladungsverfahren',
  direct: 'freihaendiges Verfahren',
  no_process: 'kein Beschaffungsverfahren'
}

/**
 * What the desk shows as the kind of publication.
 *
 * An unknown type keeps its raw value rather than being dropped or guessed:
 * simap can add one, and „selective_offering_phase" on the desk is still
 * usable, while a silently swallowed row is not.
 */
export function pubTypText(pubTyp: string, korrigiert = false): string {
  const name = PUBTYP_TEXT[pubTyp] ?? pubTyp
  return korrigiert ? `${name} (berichtigt)` : name
}

/** The public page for a project. Built here, never taken from a model. */
export function webLink(projektId: string): string {
  return `https://www.simap.ch/de/project-detail/${projektId}`
}

/** The inverse of `webLink` — the run needs the project id back to re-fetch. */
export function projektIdAusLink(link: string | null): string | null {
  if (link === null) return null
  const treffer = /\/project-detail\/([0-9a-f-]{36})/i.exec(link)
  return treffer?.[1] ?? null
}

/**
 * The canton of a municipality, from its district.
 *
 * `gemeinden` has no canton column: the district carries it, with a suffix for
 * the ones outside Baselland ("Dorneck (SO)", and "Basel-Stadt" for Riehen).
 * Used only as the fallback when a simap publication names no place of its own.
 */
export function kantonVonBezirk(bezirk: string): string {
  const suffix = /\(([A-Z]{2})\)\s*$/.exec(bezirk.trim())
  if (suffix?.[1] !== undefined) return suffix[1]
  if (/^basel-stadt$/i.test(bezirk.trim())) return 'BS'
  return 'BL'
}

/** A municipality as this connector needs it. */
export interface SimapGemeinde {
  id: string
  name: string
  bezirk: string
  plz: readonly string[]
}

/**
 * Which municipality a publication belongs to, by its PLACE OF PERFORMANCE.
 *
 * Anchored on the postcode, never on the city name — and that is not caution
 * but a measured necessity: Reinach AG (5734) and Reinach BL (4153) share a
 * name, as do Aesch BL (4147), Aesch LU and Aesch ZH (8904). A name match
 * would file another canton's tenders on this desk, and nothing downstream
 * would catch it.
 *
 * A publication whose place is described in prose only carries no postcode and
 * is dropped here; where the municipality itself is the buyer, the
 * procurement-office half of the run finds it anyway.
 */
export function ordneZuErfuellungsort(
  projekt: SimapProjekt,
  gemeinden: readonly SimapGemeinde[]
): SimapGemeinde | null {
  const plz = projekt.ort?.postalCode
  if (plz === null || plz === undefined || plz === '') return null
  return gemeinden.find((g) => g.plz.includes(plz)) ?? null
}

function preisText(wert: unknown): string {
  if (!istObjekt(wert)) return ''
  const betrag = wert['price']
  if (typeof betrag !== 'number') return ''
  const waehrung = zeichenkette(wert['currency']).toUpperCase() || 'CHF'
  // The amount exactly as handed — never rounded. The article prompt is
  // forbidden from doing arithmetic, so the rendering must not do any either.
  //
  // The thousands separator is normalised afterwards, because
  // toLocaleString('de-CH') uses two different ones depending on the value: a
  // narrow no-break space for whole numbers and a typographic apostrophe for
  // decimals. Two spellings of the same price in one fact sheet is exactly the
  // kind of detail that later reads as two different numbers.
  const formatiert = Number.isInteger(betrag)
    ? betrag.toLocaleString('de-CH')
    : betrag.toLocaleString('de-CH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
  const betragText = formatiert.replace(/[\u2019\u202f\u2009\u00a0]/g, "'")
  const mwst =
    zeichenkette(wert['vatType']) === 'full'
      ? ' (inkl. MwSt.)'
      : zeichenkette(wert['vatType']) === 'excluded'
        ? ' (exkl. MwSt.)'
        : ''
  return `${waehrung} ${betragText}${mwst}`
}

/** The deadline the desk sorts and cleans by. Only a tender really has one. */
export function fristAusDetail(detail: unknown): string | null {
  if (!istObjekt(detail)) return null
  const dates = detail['dates']
  if (!istObjekt(dates)) return null
  const roh =
    zeichenkette(dates['offerDeadline']) ||
    zeichenkette(dates['participationDeadline']) ||
    zeichenkette(dates['expressionOfInterestUntil'])
  if (roh === '') return null
  // "2026-10-12T16:00:00+02:00" -> "2026-10-12". Sliced, never parsed: the
  // timestamp carries its own offset, and turning it into a Date and back
  // moves a late-evening deadline to the previous day. Same lesson as
  // `erinnerung.ts`.
  return /^\d{4}-\d{2}-\d{2}/.test(roh) ? roh.slice(0, 10) : null
}

/**
 * The fact sheet a Meldung is written from.
 *
 * Deliberately the same `Angabe[]` shape the gazette produces, so the whole
 * article path — prompt, checks, chat revision — works on a simap row without
 * knowing it is one. Every number a reader could check has to be in here:
 * `zahlWarnungen` flags any digit in the text that is not.
 */
export function angabenAusDetail(detail: unknown, pubTyp: string): Angabe[] {
  if (!istObjekt(detail)) return []
  const angaben: Angabe[] = []
  const dazu = (bezeichnung: string, wert: string): void => {
    const sauber = wert.trim()
    if (sauber !== '') angaben.push({ bezeichnung, wert: sauber })
  }

  const info = istObjekt(detail['project-info']) ? detail['project-info'] : {}
  const beschaffung = istObjekt(detail['procurement'])
    ? detail['procurement']
    : {}

  const amt = istObjekt(info['procOfficeAddress'])
    ? info['procOfficeAddress']
    : {}
  const amtName = textVon(amt['name'] as Mehrsprachig)
  const amtOrt = [
    zeichenkette(amt['postalCode']),
    textVon(amt['city'] as Mehrsprachig)
  ]
    .filter((t) => t !== '')
    .join(' ')
  dazu('Auftraggeberin', [amtName, amtOrt].filter((t) => t !== '').join(', '))

  dazu('Art der Beschaffung', pubTypText(pubTyp))
  const untertyp = zeichenkette(beschaffung['orderType'])
  dazu('Auftragsart', UNTERTYP_TEXT[untertyp] ?? untertyp)
  const verfahren = zeichenkette(beschaffung['processType'])
  dazu('Verfahren', VERFAHREN_TEXT[verfahren] ?? verfahren)

  dazu(
    'Beschreibung',
    entferneMarkup(textVon(beschaffung['orderDescription'] as Mehrsprachig))
  )

  const cpv = istObjekt(beschaffung['cpvCode']) ? beschaffung['cpvCode'] : null
  if (cpv !== null)
    dazu(
      'Kategorie (CPV)',
      [textVon(cpv['label'] as Mehrsprachig), zeichenkette(cpv['code'])]
        .filter((t) => t !== '')
        .join(' ')
    )

  // --- The award: who got it, for how much, against how many others
  const entscheid = istObjekt(detail['decision']) ? detail['decision'] : null
  if (entscheid !== null) {
    const anbieter = Array.isArray(entscheid['vendors'])
      ? entscheid['vendors']
      : []
    for (const a of anbieter) {
      if (!istObjekt(a)) continue
      const ort = istObjekt(a['vendorAddress']) ? a['vendorAddress'] : {}
      dazu(
        'Zuschlag an',
        [
          zeichenkette(a['vendorName']),
          [zeichenkette(ort['postalCode']), zeichenkette(ort['city'])]
            .filter((t) => t !== '')
            .join(' '),
          preisText(a['price'])
        ]
          .filter((t) => t !== '')
          .join(', ')
      )
    }
    const eingegangen = entscheid['numberOfSubmissions']
    if (typeof eingegangen === 'number')
      dazu('Eingegangene Angebote', String(eingegangen))
    dazu('Zuschlagsdatum', zeichenkette(entscheid['awardDecisionDate']))
    dazu(
      'Begruendung des Zuschlags',
      entferneMarkup(
        textVon(entscheid['awardDecisionJustification'] as Mehrsprachig)
      )
    )
  }

  // --- The tender: the dates that are the reason it is news at all
  const dates = istObjekt(detail['dates']) ? detail['dates'] : null
  if (dates !== null) {
    const frist = fristAusDetail(detail)
    if (frist !== null) dazu('Eingabefrist fuer Angebote', frist)
    const fragen = Array.isArray(dates['qnas']) ? dates['qnas'] : []
    for (const f of fragen) {
      if (!istObjekt(f)) continue
      dazu('Frist fuer Fragen', zeichenkette(f['date']))
    }
    const ort = zeichenkette(dates['offerOpeningCity'])
    if (ort !== '') dazu('Oeffnung der Angebote', ort)
  }

  return angaben
}
