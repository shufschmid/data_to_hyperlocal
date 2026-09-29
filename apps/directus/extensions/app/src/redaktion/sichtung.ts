// The graded Sichtung answer — a grade per row instead of a yes.
//
// The two desks that grade (Gemeindeseiten, Veranstaltungen) share this
// shape; the desks that still answer yes/no (Amtsblatt, Kanton) keep
// `TRIAGE_SCHEMA` in `amtsblatt.ts`. The grade is the model's; whether it is
// a proposal is `tischeinstellungen.ts` — the newsroom's threshold.

import { stufeAus, type Stufe } from './tischeinstellungen'

export const STUFEN_SCHEMA = {
  type: 'object',
  properties: {
    urteile: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nummer: { type: 'integer' },
          stufe: { type: 'integer', enum: [1, 2, 3, 4] },
          begruendung: { type: 'string' },
          // The anyOf form, as in TRIAGE_SCHEMA: a nullable enum as type +
          // enum is rejected by the API (measured 15.09.2026).
          empfehlung: {
            anyOf: [
              { type: 'string', enum: ['weiterreichen'] },
              { type: 'null' }
            ]
          },
          empfehlung_regel: { type: ['string', 'null'] }
        },
        required: [
          'nummer',
          'stufe',
          'begruendung',
          'empfehlung',
          'empfehlung_regel'
        ],
        additionalProperties: false
      }
    }
  },
  required: ['urteile'],
  additionalProperties: false
} as const

/** The lines the two prompts share: what the four grades mean. */
export const STUFEN_ANTWORT =
  'Antworte ausschliesslich mit JSON:\n{"urteile": [{"nummer": 1, "stufe": 3, "begruendung": "...", "empfehlung": null, "empfehlung_regel": null}]}'

export interface StufenUrteil {
  id: string
  stufe: Stufe
  begruendung: string
  empfehlung: 'weiterreichen' | null
  empfehlung_regel: string | null
}

/**
 * Reads the answer against the numbered rows it was asked about. An answer
 * without `urteile` throws — the whole municipality is then "not judged" and
 * the run says so; a single malformed verdict is skipped, the rest stands.
 */
export function parseStufenSichtung(
  antwort: unknown,
  zeilen: ReadonlyArray<{ id: string }>
): StufenUrteil[] {
  const urteile = (antwort as { urteile?: unknown } | null)?.urteile
  if (!Array.isArray(urteile))
    throw new Error('Sichtung: Antwort ohne Liste "urteile".')
  const gesehen = new Set<number>()
  const ergebnis: StufenUrteil[] = []
  for (const roh of urteile) {
    if (typeof roh !== 'object' || roh === null) continue
    const u = roh as Record<string, unknown>
    const nummer = u['nummer']
    if (typeof nummer !== 'number' || !Number.isInteger(nummer)) continue
    const zeile = zeilen[nummer - 1]
    if (zeile === undefined || gesehen.has(nummer)) continue
    const stufe = stufeAus(u['stufe'])
    if (stufe === null) continue
    gesehen.add(nummer)
    const regel = u['empfehlung_regel']
    ergebnis.push({
      id: zeile.id,
      stufe,
      begruendung:
        typeof u['begruendung'] === 'string' ? u['begruendung'].trim() : '',
      empfehlung: u['empfehlung'] === 'weiterreichen' ? 'weiterreichen' : null,
      empfehlung_regel: typeof regel === 'string' ? regel : null
    })
  }
  return ergebnis
}
