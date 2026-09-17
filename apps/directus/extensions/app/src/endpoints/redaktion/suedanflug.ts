import { createError } from '@directus/errors'
import { completeJson } from '../../shared/claude'
import {
  buildSuedanflugPrompt,
  buildSuedanflugRevision,
  datengrundlageSuedanflug,
  leseSchwellen,
  bewerteMonat,
  linkWarnungen,
  mitQuelle,
  ohneQuelle,
  ortsWarnungen,
  parseSuedanflugmeldung,
  provisorikWarnung,
  suedanflugAttributionsWarnung,
  suedanflugFakten,
  SUEDANFLUG_SYSTEM_PROMPT,
  zahlWarnungenSuedanflug,
  zeitWarnungen,
  type SuedanflugFakten
} from '../../redaktion/suedanflug'
import type { GespeicherterMonat } from '../../redaktion/suedanfluglauf'
import type { Monatsblatt, Tag } from '../../shared/euroairport'
import type { Gemeinde, Quelle, Suedanflugquote } from '../../types/schema'

// The south-approach Meldung: one model call per municipality, and the checks.
//
// The month's row is read back out of the database rather than re-fetched: the
// figures the article stands on have to be the ones an editor looked at when
// she pressed the button, and the sheet may have been re-uploaded in between.
// The revision watchdog is what notices when they move afterwards.
//
// Everything this file does with a model is one `completeJson` through
// `shared/claude.ts`, plus at most one retry when the article forgot to name
// its source. The rules themselves live next door in `redaktion/suedanflug.ts`,
// pure and tested.

export const KeineQuotenzeile = createError(
  'NOT_FOUND',
  'Dieses Monatsblatt gibt es nicht.',
  404
)

export const GemeindeNichtBetroffen = createError(
  'NOT_AFFECTED',
  'Diese Gemeinde ist nicht als Suedanflug-Gemeinde erfasst. Trage sie in der Gemeinden-Karte ein, wenn sie unter der Anflugschneise liegt.',
  422
)

export const MeldungSchonDa = createError(
  'ALREADY_WRITTEN',
  'Fuer diese Gemeinde und diesen Monat gibt es bereits eine Meldung.',
  409
)

export const QuoteUnvollstaendig = createError(
  'INCOMPLETE',
  'Diesem Monatsblatt fehlen die Zahlen, aus denen eine Meldung entstehen koennte.',
  422
)

/** The row as this module needs it — structural, so tests need no database. */
export type Quotenzeile = Pick<
  Suedanflugquote,
  | 'id'
  | 'jahr'
  | 'monat'
  | 'anfluege'
  | 'suedlandungen'
  | 'quote'
  | 'aktualisiert_am'
  | 'provisorisch'
  | 'tage'
  | 'befunde'
  | 'quelle_url'
>

/**
 * The stored row back in the shape the pure functions want.
 *
 * `bewerteMonat` judges a freshly parsed sheet; a stored month carries the same
 * material in columns. Rebuilding it here rather than re-fetching the PDF is
 * deliberate: the article must stand on the figures the editor saw.
 */
export function blattAusZeile(zeile: Quotenzeile): Monatsblatt {
  if (zeile.anfluege === null || zeile.suedlandungen === null) {
    throw new QuoteUnvollstaendig()
  }
  // The source line is built by code and carries exactly one address: this
  // month's PDF. Without it the article would go out naming a source a reader
  // cannot open, so the honest answer is to refuse rather than to write half
  // a line.
  if (zeile.quelle_url === null || zeile.quelle_url.trim() === '') {
    throw new QuoteUnvollstaendig()
  }
  return {
    jahr: zeile.jahr,
    monat: zeile.monat,
    tage: (zeile.tage ?? []) as Tag[],
    anfluege: zeile.anfluege,
    suedlandungen: zeile.suedlandungen,
    quote: zeile.quote,
    aktualisiert_am: zeile.aktualisiert_am,
    provisorisch: zeile.provisorisch,
    befunde: zeile.befunde ?? []
  }
}

export function faktenFuer(eingabe: {
  zeile: Quotenzeile
  gemeinde: Pick<Gemeinde, 'name' | 'suedanflug'>
  bestand: readonly GespeicherterMonat[]
  quelle: Pick<Quelle, 'konfiguration'> | null
}): SuedanflugFakten {
  if (!eingabe.gemeinde.suedanflug) throw new GemeindeNichtBetroffen()

  const blatt = blattAusZeile(eingabe.zeile)
  const schwellen = leseSchwellen(eingabe.quelle?.konfiguration ?? null)

  return suedanflugFakten({
    blatt,
    gemeinde: eingabe.gemeinde.name,
    quelleUrl: eingabe.zeile.quelle_url ?? '',
    bewertung: bewerteMonat(blatt, eingabe.bestand, schwellen),
    schwellen
  })
}

export interface Meldungsentwurf {
  bericht: { titel: string; lead: string; text: string }
  warnungen: string[]
}

/**
 * One article, written and then measured against what it was handed.
 *
 * The attribution is the only check with a retry: an article about aircraft
 * over a village that never says whose count it quotes reads as our own
 * measurement, and we take no measurements. Everything else is reported to the
 * editor and decided by her — including the place rule, which is the one a
 * reader could never catch.
 */
export async function schreibeSuedanflugmeldung(
  fakten: SuedanflugFakten,
  prompt: string
): Promise<Meldungsentwurf> {
  let bericht = parseSuedanflugmeldung(
    await completeJson<unknown>({
      system: SUEDANFLUG_SYSTEM_PROMPT,
      prompt,
      maxTokens: 1500
    })
  )

  let attribution = suedanflugAttributionsWarnung(
    `${bericht.lead} ${bericht.text}`,
    fakten
  )
  if (attribution !== null) {
    bericht = parseSuedanflugmeldung(
      await completeJson<unknown>({
        system: SUEDANFLUG_SYSTEM_PROMPT,
        prompt: buildSuedanflugRevision(
          fakten,
          bericht,
          'Nenne den EuroAirport im Fliesstext als Quelle der Zahl, etwa "wie der EuroAirport meldet".'
        ),
        maxTokens: 1500
      })
    )
    attribution = suedanflugAttributionsWarnung(
      `${bericht.lead} ${bericht.text}`,
      fakten
    )
  }

  const alles = `${bericht.titel} ${bericht.lead} ${bericht.text}`
  const provisorik = provisorikWarnung(alles, fakten)

  const warnungen = [
    ...zeitWarnungen(alles),
    ...zahlWarnungenSuedanflug(alles, fakten),
    ...linkWarnungen(alles),
    ...ortsWarnungen(alles, fakten),
    ...(provisorik === null ? [] : [provisorik]),
    ...(attribution === null ? [] : [attribution])
  ]

  return { bericht, warnungen }
}

/** What goes into the `meldungen` row — one pure mapping, shared by both paths. */
export function meldungsfelder(
  entwurf: Meldungsentwurf,
  fakten: SuedanflugFakten
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
  buildSuedanflugPrompt,
  buildSuedanflugRevision,
  datengrundlageSuedanflug,
  ohneQuelle
}
