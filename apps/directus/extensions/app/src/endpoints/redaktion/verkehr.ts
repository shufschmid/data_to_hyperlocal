// The Verkehr desk's two Meldung endpoints, in the shape of the EuroAirport's:
// the stored row back into facts, one model call, the checks, and the fields
// of the `meldungen` row. The routes themselves are registered in `index.ts`;
// nothing here is a rule — the rules live in `redaktion/verkehr.ts`.

import { createError } from '@directus/errors'
import { completeJson } from '../../shared/claude'
import {
  zusammenfassung,
  type AnlageArt,
  type Kontrolle,
  type Messung
} from '../../shared/verkehr'
import {
  buildKontrollenRevision,
  buildRadarRevision,
  datengrundlageKontrollen,
  datengrundlageRadar,
  KONTROLLEN_SYSTEM_PROMPT,
  kontrollenAttributionsWarnung,
  kontrollenQuelleZeile,
  linkWarnungen,
  MELDUNG_SCHEMA,
  mitQuelle,
  ohneQuelle,
  parseVerkehrsmeldung,
  polizeiAttributionsWarnung,
  RADAR_SYSTEM_PROMPT,
  radarQuelleZeile,
  zahlWarnungenVerkehr,
  zeitWarnungen,
  type KontrollenFakten,
  type MonatsBilanz,
  type RadarFakten
} from '../../redaktion/verkehr'

export const KeinStandort = createError(
  'NOT_FOUND',
  'Diesen Standort gibt es nicht.',
  404
)

export const StandortOhneGemeinde = createError(
  'NOT_AFFECTED',
  'Dieser Standort liegt in keiner bespielten Gemeinde — dazu schreibt die Redaktion keine Meldung.',
  422
)

export const KeinMonatsblatt = createError(
  'NOT_FOUND',
  'Dieses Monatsblatt gibt es nicht.',
  404
)

export const MeldungSchonDa = createError(
  'ALREADY_WRITTEN',
  'Dazu gibt es bereits eine Meldung.',
  409
)

export const BlattOhneKontrollen = createError(
  'INCOMPLETE',
  'Dieses Monatsblatt traegt keine Kontrollzeile — daraus entsteht keine Meldung.',
  422
)

/** The public page the radar article links — the data door's path on the site the newsroom links. */
export const RADAR_SEITE =
  'https://www.baselland.ch/politik-und-behorden/direktionen/sicherheitsdirektion/polizei/standorte-radaranlagen'

/** A stored installation, structural — tests need no database. */
export interface Standortzeile {
  id: string
  art: AnlageArt
  kennung: string | null
  ab_wann: string | null
  standort: string
  plz: string | null
  ort: string | null
  strasse: string | null
  geschwindigkeit: number | null
  oertlichkeit: string | null
  publikation_am: string | null
  gemeinde: string | null
}

export function radarFaktenFuer(eingabe: {
  zeile: Standortzeile
  gemeinde: { id: string; name: string }
  /** The other active installations the sheet lists in the same municipality. */
  weitere: readonly Standortzeile[]
  seiteUrl?: string | null
}): RadarFakten {
  const z = eingabe.zeile
  return {
    gemeinde: eingabe.gemeinde.name,
    art: z.art,
    kennung: z.kennung,
    abWann: z.ab_wann,
    standort: z.standort,
    plz: z.plz,
    ort: z.ort,
    strasse: z.strasse,
    geschwindigkeit: z.geschwindigkeit,
    oertlichkeit: z.oertlichkeit,
    publiziertAm: z.publikation_am,
    weitereInGemeinde: eingabe.weitere
      .filter((w) => w.id !== z.id)
      .map((w) => ({ standort: w.standort, art: w.art, abWann: w.ab_wann })),
    seiteUrl:
      (eingabe.seiteUrl ?? '').trim() === ''
        ? RADAR_SEITE
        : (eingabe.seiteUrl as string)
  }
}

/** A stored month of speed controls, structural. */
export interface Monatszeile {
  id: string
  jahr: number
  monat: number
  stand: string | null
  polizei: string | null
  kontrollen: Kontrolle[] | null
  messungen: Messung[] | null
  hinweise: string[] | null
  quelle_url: string | null
  gemeinde: string | null
}

/** The month before, among the stored rows of the same municipality — handed as numbers, never fetched. */
export function vormonatVon(
  zeile: Pick<Monatszeile, 'jahr' | 'monat'>,
  bestand: readonly Monatszeile[]
): Monatszeile | null {
  const jahr = zeile.monat === 1 ? zeile.jahr - 1 : zeile.jahr
  const monat = zeile.monat === 1 ? 12 : zeile.monat - 1
  return bestand.find((m) => m.jahr === jahr && m.monat === monat) ?? null
}

/**
 * The stored row back into facts. The figures are recomputed from the stored
 * control lines rather than read from a summary column, so the article
 * stands on what the row holds and the two can never disagree.
 */
export function kontrollenFaktenFuer(eingabe: {
  zeile: Monatszeile
  gemeinde: { id: string; name: string }
  bestand: readonly Monatszeile[]
}): KontrollenFakten {
  const z = eingabe.zeile
  const kontrollen = z.kontrollen ?? []
  if (
    kontrollen.length === 0 ||
    z.quelle_url === null ||
    z.quelle_url.trim() === ''
  ) {
    throw new BlattOhneKontrollen()
  }
  const vor = vormonatVon(z, eingabe.bestand)
  const vormonat: MonatsBilanz | null =
    vor === null || (vor.kontrollen ?? []).length === 0
      ? null
      : {
          jahr: vor.jahr,
          monat: vor.monat,
          bilanz: zusammenfassung(vor.kontrollen ?? [])
        }
  return {
    gemeinde: eingabe.gemeinde.name,
    polizei:
      (z.polizei ?? '').trim() === ''
        ? `Gemeindepolizei ${eingabe.gemeinde.name}`
        : (z.polizei as string),
    jahr: z.jahr,
    monat: z.monat,
    stand: z.stand,
    bilanz: zusammenfassung(kontrollen),
    messungen: z.messungen ?? [],
    vormonat,
    hinweise: z.hinweise ?? [],
    quelleUrl: z.quelle_url
  }
}

export interface Meldungsentwurf {
  bericht: { titel: string; lead: string; text: string }
  warnungen: string[]
}

/**
 * One radar article, written and then measured against what it was handed.
 * The attribution is the only check with a retry: an article about a speed
 * camera that never says whose list it quotes reads as our own observation.
 */
export async function schreibeRadarmeldung(
  fakten: RadarFakten,
  prompt: string
): Promise<Meldungsentwurf> {
  let bericht = parseVerkehrsmeldung(
    await completeJson<unknown>({
      zweck: 'verkehr:radar',
      system: RADAR_SYSTEM_PROMPT,
      prompt,
      maxTokens: 1200,
      schema: MELDUNG_SCHEMA
    })
  )
  let attribution = polizeiAttributionsWarnung(
    `${bericht.lead} ${bericht.text}`
  )
  if (attribution !== null) {
    bericht = parseVerkehrsmeldung(
      await completeJson<unknown>({
        zweck: 'verkehr:radar:nachfassen',
        system: RADAR_SYSTEM_PROMPT,
        prompt: buildRadarRevision(
          fakten,
          bericht,
          'Nenne die Polizei Basel-Landschaft im Fliesstext als Quelle der Angabe, etwa "wie die Polizei Basel-Landschaft mitteilt".'
        ),
        maxTokens: 1200,
        schema: MELDUNG_SCHEMA
      })
    )
    attribution = polizeiAttributionsWarnung(`${bericht.lead} ${bericht.text}`)
  }
  const alles = `${bericht.titel} ${bericht.lead} ${bericht.text}`
  return {
    bericht,
    warnungen: [
      ...zeitWarnungen(alles),
      ...zahlWarnungenVerkehr(alles, fakten),
      ...linkWarnungen(alles),
      ...(attribution === null ? [] : [attribution])
    ]
  }
}

export async function schreibeKontrollenmeldung(
  fakten: KontrollenFakten,
  prompt: string
): Promise<Meldungsentwurf> {
  let bericht = parseVerkehrsmeldung(
    await completeJson<unknown>({
      zweck: 'verkehr:kontrollen',
      system: KONTROLLEN_SYSTEM_PROMPT,
      prompt,
      maxTokens: 1500,
      schema: MELDUNG_SCHEMA
    })
  )
  let attribution = kontrollenAttributionsWarnung(
    `${bericht.lead} ${bericht.text}`,
    fakten
  )
  if (attribution !== null) {
    bericht = parseVerkehrsmeldung(
      await completeJson<unknown>({
        zweck: 'verkehr:kontrollen:nachfassen',
        system: KONTROLLEN_SYSTEM_PROMPT,
        prompt: buildKontrollenRevision(
          fakten,
          bericht,
          `Nenne die ${fakten.polizei} im Fliesstext als Quelle der Zahlen, etwa "laut ${fakten.polizei}".`
        ),
        maxTokens: 1500,
        schema: MELDUNG_SCHEMA
      })
    )
    attribution = kontrollenAttributionsWarnung(
      `${bericht.lead} ${bericht.text}`,
      fakten
    )
  }
  const alles = `${bericht.titel} ${bericht.lead} ${bericht.text}`
  return {
    bericht,
    warnungen: [
      ...zeitWarnungen(alles),
      ...zahlWarnungenVerkehr(alles, fakten),
      ...linkWarnungen(alles),
      ...(attribution === null ? [] : [attribution])
    ]
  }
}

/** What goes into the `meldungen` row — one pure mapping per kind, shared by the first write and the revision. */
export function radarMeldungsfelder(
  entwurf: Meldungsentwurf,
  fakten: RadarFakten
): Record<string, unknown> {
  return {
    titel: entwurf.bericht.titel,
    lead: entwurf.bericht.lead,
    text: mitQuelle(entwurf.bericht.text, radarQuelleZeile(fakten)),
    zeit_warnungen: entwurf.warnungen.length > 0 ? entwurf.warnungen : null,
    verarbeitung: 'idle',
    anweisung: null,
    fehler: null
  }
}

export function kontrollenMeldungsfelder(
  entwurf: Meldungsentwurf,
  fakten: KontrollenFakten
): Record<string, unknown> {
  return {
    titel: entwurf.bericht.titel,
    lead: entwurf.bericht.lead,
    text: mitQuelle(entwurf.bericht.text, kontrollenQuelleZeile(fakten)),
    zeit_warnungen: entwurf.warnungen.length > 0 ? entwurf.warnungen : null,
    verarbeitung: 'idle',
    anweisung: null,
    fehler: null
  }
}

export { datengrundlageKontrollen, datengrundlageRadar, ohneQuelle }
