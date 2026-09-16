// Reading the Zettelkasten — the pure half.
//
// The Zettelkasten is We.Publish's evidence-bound knowledge layer: every
// official publication of both Basel gazettes since 3 September 2018, kept as
// dated files with a checksum, plus the raw fetch each row came from. Bajour's
// desk already sees today's gazette; what it cannot see is what happened at the
// same address, or to the same company, in the five years before. That is what
// this adapter fetches, and the only thing it fetches.
//
// Two rules the shape of this module follows from:
//
//   1. **Organisations only.** A Vorgeschichte is shown next to a row an editor
//      is looking at, so it must never widen what the desk knows about a
//      natural person. The line is not drawn here: `shared/amtsblatt/parse.ts`
//      already sorts every rubric into a group, and `personen` is exactly the
//      rubrics that name private people in a private matter. An unknown rubric
//      is dropped too — an allow-list, because the portal adds rubrics and a
//      new one may well be private.
//   2. **The Vorbehalt travels.** Every answer of the door carries one
//      sentence saying what its rows prove and what they do not. It is passed
//      through unchanged to the desk instead of being summarised: the point of
//      a caveat is its exact wording.
//
// The network half lives in ./index.

import { gruppeVon } from '../amtsblatt/parse'

export class ZettelkastenFehler extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZettelkastenFehler'
  }
}

/** One earlier publication, as the desk shows it. */
export interface Vorgeschichte {
  /** The gazette's own number, e.g. `BP-BL05-0000006774`. */
  publikationsnummer: string
  /** Publication date, ISO. */
  datum: string
  /** The SUB-rubric, e.g. `BP-BL05` — the rubric is derived (`rubrikVon`). */
  rubrik: string
  titel: string
  /**
   * The canton's own rendering of the publication, as a PDF.
   *
   * This is the address to link, never ours: the gazette portal states that a
   * publication loses its legal force when it is re-rendered from the XML. The
   * Zettelkasten hands the address out per row since 16 September 2026; before
   * that it was only inside the text, so `null` is a possible answer and means
   * the fetch did not carry one — not that there is none.
   */
  adresse: string | null
  /** BFS number of the municipality, when the publication names one. */
  gemeindeBfs: number | null
}

export interface Vorgeschichten {
  treffer: Vorgeschichte[]
  /** How many the door found, which can exceed what it returned. */
  gesamt: number
  /** True when the door has more rows than it returned. */
  weitere: boolean
  /** The door's caveat, unchanged. */
  vorbehalt: string
}

function istObjekt(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function text(x: unknown): string {
  return typeof x === 'string' ? x : ''
}

function zahlOderNull(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}

function textOderNull(x: unknown): string | null {
  return typeof x === 'string' && x.trim() !== '' ? x : null
}

/**
 * The door's answer as rows.
 *
 * An error answer becomes a thrown `ZettelkastenFehler` rather than an empty
 * result: a fallen canary or an expired token must not look like "nothing
 * happened here before".
 */
export function parseTreffer(json: unknown): Vorgeschichten {
  if (!istObjekt(json))
    throw new ZettelkastenFehler(
      'Der Zettelkasten antwortete nicht mit einem Objekt.'
    )
  if (typeof json.fehler === 'string') throw new ZettelkastenFehler(json.fehler)
  if (!Array.isArray(json.treffer))
    throw new ZettelkastenFehler(
      'Die Antwort des Zettelkastens hat kein Feld "treffer".'
    )

  const treffer: Vorgeschichte[] = []
  for (const roh of json.treffer) {
    if (!istObjekt(roh)) continue
    const publikationsnummer = text(roh.publikationsnummer)
    const rubrik = text(roh.rubrik)
    // Without a number and a rubric a row can neither be cited nor sorted into
    // a group, and an unsorted row is one this adapter must not show.
    if (publikationsnummer === '' || rubrik === '') continue
    treffer.push({
      publikationsnummer,
      datum: text(roh.datum),
      rubrik,
      titel: text(roh.titel),
      adresse: textOderNull(roh.adresse),
      gemeindeBfs: zahlOderNull(roh.gemeinde_bfs)
    })
  }

  return {
    treffer,
    gesamt: zahlOderNull(json.gesamt) ?? treffer.length,
    weitere: json.weitere === true,
    vorbehalt: text(json.vorbehalt)
  }
}

/**
 * The rubric of a sub-rubric: `BP-BL05` → `BP-BL`, `KK01` → `KK`.
 *
 * The gazette numbers its sub-rubrics by appending digits, and the group map in
 * `shared/amtsblatt/parse.ts` is keyed on both. Cutting the digits off is the
 * whole rule; a rubric that carries none (`AB`) is already the rubric.
 */
export function rubrikVon(unterrubrik: string): string {
  return unterrubrik.replace(/\d+$/, '')
}

/**
 * Only rows whose rubric is a matter of organisations.
 *
 * Both directions matter: `personen` is dropped because those publications name
 * private people, and an unmapped rubric is dropped because nobody has said
 * what it is.
 */
export function nurOrganisationen(
  treffer: readonly Vorgeschichte[]
): Vorgeschichte[] {
  return treffer.filter((t) => {
    const gruppe = gruppeVon(rubrikVon(t.rubrik), t.rubrik)
    return gruppe !== null && gruppe !== 'personen'
  })
}
