import { createError } from '@directus/errors'
import { completeJson } from '../../shared/claude'
import {
  abstimmungsAttributionsWarnung,
  abstimmungsFakten,
  buildAbstimmungsPrompt,
  buildAbstimmungsRevision,
  datengrundlageAbstimmung,
  linkWarnungen,
  mitQuelle,
  ohneQuelle,
  parseAbstimmungsmeldung,
  stichfragenWarnungen,
  ABSTIMMUNGS_SYSTEM_PROMPT,
  zahlWarnungenAbstimmung,
  zeitWarnungen,
  type AbstimmungsFakten
} from '../../redaktion/abstimmung'
import type { Vorlagenteil } from '../../redaktion/abstimmunglauf'
import type {
  Abstimmung,
  Abstimmungsgemeinde,
  Gemeinde
} from '../../types/schema'

// The vote article: one model call per municipality and Vorlage.
//
// Everything is read back out of the stored row rather than re-fetched. The
// figures an article stands on have to be the ones an editor looked at when she
// pressed the button, and a vote day's rows change under the run's hands for
// hours.
//
// **The gate is `counted`, and it sits here as well as in the run.** A
// municipality one of whose rows is still open has no result — not a
// provisional one — and the endpoint refuses rather than writing a careful
// sentence about a half-counted village.

export const KeineAbstimmung = createError(
  'NOT_FOUND',
  'Diese Vorlage gibt es nicht.',
  404
)

export const GemeindeZaehltNoch = createError(
  'NOT_COUNTED',
  'Diese Gemeinde ist an diesem Abstimmungstag noch nicht fertig ausgezaehlt. Solange eine ihrer Vorlagen offen ist, wird ueber sie nichts geschrieben.',
  422
)

export const GemeindeOhneZahlen = createError(
  'NO_FIGURES',
  'Der Datensatz fuehrt diese Gemeinde an diesem Abstimmungstag nicht. Ausserkantonale Gemeinden stehen nicht darin.',
  422
)

export const AbstimmungUnvollstaendig = createError(
  'INCOMPLETE',
  'Dieser Vorlage fehlt die Adresse der amtlichen Publikation, aus der die Quellenzeile gebaut wird.',
  422
)

export const MeldungSchonDa = createError(
  'ALREADY_WRITTEN',
  'Fuer diese Gemeinde und diese Vorlage gibt es bereits eine Meldung.',
  409
)

/** The row as this module needs it — structural, so tests need no database. */
export type Abstimmungszeile = Pick<
  Abstimmung,
  | 'id'
  | 'vote_id'
  | 'datum'
  | 'titel'
  | 'ebene'
  | 'teile'
  | 'gemeindezahlen'
  | 'gemeinden_total'
  | 'gemeinden_ausgezaehlt'
  | 'ausgezaehlt'
  | 'stichfrage_gilt'
  | 'stichfrage_grund'
  | 'vergleich'
  | 'quelle_url'
>

/**
 * The stored row plus one municipality, or a refusal with a German reason.
 *
 * Three refusals, and none of them is fudged: a municipality still counting
 * (the rule this whole feed exists for), a municipality the dataset does not
 * carry at all (Riehen belongs to Basel-Stadt), and a row without the canton's
 * own address — the source line is built by code and carries exactly one.
 */
export function faktenFuer(eingabe: {
  zeile: Abstimmungszeile
  gemeinde: Pick<Gemeinde, 'name' | 'bfs_nummer'>
}): AbstimmungsFakten {
  const { zeile } = eingabe
  const bfs = String(eingabe.gemeinde.bfs_nummer)

  if (zeile.quelle_url === null || zeile.quelle_url.trim() === '') {
    throw new AbstimmungUnvollstaendig()
  }

  const zahlen = (zeile.gemeindezahlen ?? []).find(
    (eintrag: Abstimmungsgemeinde) => eintrag.bfs === bfs
  )
  if (zahlen === undefined || zahlen.ergebnisse.length === 0) {
    throw new GemeindeOhneZahlen()
  }
  if (!zahlen.ausgezaehlt) throw new GemeindeZaehltNoch()

  const vergleich = (zeile.vergleich?.gemeinden ?? []).find(
    (eintrag) => eintrag.bfs === bfs
  )

  return abstimmungsFakten({
    vorlage: {
      voteId: zeile.vote_id,
      datum: zeile.datum,
      ebene: zeile.ebene,
      titel: zeile.titel ?? '',
      teile: (zeile.teile ?? []) as Vorlagenteil[],
      quelleUrl: zeile.quelle_url
    },
    gemeinde: { ...zahlen, gemeinde: eingabe.gemeinde.name },
    stichfrage: {
      gilt: zeile.stichfrage_gilt,
      grund: zeile.stichfrage_grund ?? ''
    },
    vergleich:
      vergleich === undefined || zeile.vergleich === null
        ? null
        : { datum: zeile.vergleich.datum, beteiligung: vergleich.beteiligung }
  })
}

export interface Meldungsentwurf {
  bericht: { titel: string; lead: string; text: string }
  warnungen: string[]
}

/**
 * One article, written and then measured against what it was handed.
 *
 * The attribution is the only check with a retry: a vote result printed without
 * saying whose count it is reads as our own tally. Everything else is reported
 * to the editor and decided by her — including the Stichfrage rule, which is
 * the one a reader could never catch.
 */
export async function schreibeAbstimmungsmeldung(
  fakten: AbstimmungsFakten,
  prompt: string
): Promise<Meldungsentwurf> {
  let bericht = parseAbstimmungsmeldung(
    await completeJson<unknown>({
      system: ABSTIMMUNGS_SYSTEM_PROMPT,
      prompt,
      maxTokens: 1500
    })
  )

  let attribution = abstimmungsAttributionsWarnung(
    `${bericht.lead} ${bericht.text}`
  )
  if (attribution !== null) {
    bericht = parseAbstimmungsmeldung(
      await completeJson<unknown>({
        system: ABSTIMMUNGS_SYSTEM_PROMPT,
        prompt: buildAbstimmungsRevision(
          fakten,
          bericht,
          'Nenne den Kanton Basel-Landschaft im Fliesstext als Quelle des Ergebnisses, etwa "nach dem amtlichen Ergebnis des Kantons".'
        ),
        maxTokens: 1500
      })
    )
    attribution = abstimmungsAttributionsWarnung(
      `${bericht.lead} ${bericht.text}`
    )
  }

  const alles = `${bericht.titel} ${bericht.lead} ${bericht.text}`

  const warnungen = [
    ...zeitWarnungen(alles),
    ...zahlWarnungenAbstimmung(alles, fakten),
    ...linkWarnungen(alles),
    ...stichfragenWarnungen(alles, fakten),
    ...(attribution === null ? [] : [attribution])
  ]

  return { bericht, warnungen }
}

/** What goes into the `meldungen` row — one pure mapping, shared by both paths. */
export function meldungsfelder(
  entwurf: Meldungsentwurf,
  fakten: AbstimmungsFakten
): Record<string, unknown> {
  return {
    titel: entwurf.bericht.titel,
    lead: entwurf.bericht.lead,
    text: mitQuelle(entwurf.bericht.text, fakten),
    zeit_warnungen: entwurf.warnungen.length > 0 ? entwurf.warnungen : null,
    verarbeitung: 'idle',
    anweisung: null,
    fehler: null
  }
}

export {
  buildAbstimmungsPrompt,
  buildAbstimmungsRevision,
  datengrundlageAbstimmung,
  ohneQuelle
}
