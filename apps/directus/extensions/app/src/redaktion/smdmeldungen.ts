// Eine Meldung aus einem SMD-Beitrag — auf Klick, nicht im Lauf: der Tisch
// ist neu, und der Gemeindeseiten-Handel («der Lauf schreibt den Vorschlag
// gleich mit») gilt erst, wenn er sich bewaehrt hat. Ohne `lerne(…)`: der
// Entwurf lehrt nichts, die drei Entscheide tun es.
//
// Was hier anders ist als beim Kanton-Tisch: der Sprecher ist ein anderes
// Medium, die Meldung ist eine Presseschau in eigenen Worten (die
// 8-Gramm-Pruefung gegen den Beitrag), und die Quellenzeile traegt den
// Online-Artikel mit «(Abo)» — oder sagt «(Artikel nicht online verfügbar)».

import { completeJson } from '../shared/claude'
import { alleDaten, heuteAus } from '../shared/gemeindeseite/datum'
import type { SmdArt, SmdLinkStatus } from '../types/schema'
import { schreibeEinmalMitNachfassen } from './gemeindemeldungen'
import {
  attributionsWarnung,
  buildSmdPrompt,
  buildSmdRevision,
  linkWarnungen,
  mitQuelle,
  parseSmdMeldung,
  SMD_MELDUNG_SYSTEM_PROMPT,
  ueberlappungsWarnungen,
  zahlWarnungen,
  zeitWarnungen,
  type SmdFakten
} from './smd'
import {
  planeMitteilungTermin,
  terminVorschlagAus,
  wichtigAus,
  type Termin
} from './termin'

export interface SmdRohzeile {
  id: string
  art: SmdArt
  medium: string
  datum: string
  zeit: string | null
  blog: string | null
  rubrik: string | null
  titel: string
  lead: string | null
  autor: string | null
  text: string | null
  text_abgeschnitten: boolean
  gemeinden_genannt: string[] | null
  link_url: string | null
  link_status: SmdLinkStatus
  link_abo: boolean | null
  entscheid: string
  vorschlag_begruendung: string | null
  gemeinde: { id: string; name: string }
}

export const SMD_FELDER = [
  'id',
  'art',
  'medium',
  'datum',
  'zeit',
  'blog',
  'rubrik',
  'titel',
  'lead',
  'autor',
  'text',
  'text_abgeschnitten',
  'gemeinden_genannt',
  'link_url',
  'link_status',
  'link_abo',
  'entscheid',
  'vorschlag_begruendung',
  'gemeinde.id',
  'gemeinde.name'
]

/**
 * The facts the writer works from. Dates the piece prints without a year
 * are read forward from the PIECE's own day, not from today: a concert
 * announced on 9 October as «am 10. Oktober» is the next day, and a dossier
 * read three days late must not move it a year ahead.
 */
export function smdFakten(
  zeile: SmdRohzeile,
  heute: string = zeile.datum
): SmdFakten {
  const material = [zeile.titel, zeile.lead ?? '', zeile.text ?? ''].join('\n')
  return {
    gemeinde: zeile.gemeinde.name,
    medium: zeile.medium,
    art: zeile.art,
    datum: zeile.datum,
    zeit: zeile.zeit,
    blog: zeile.blog,
    rubrik: zeile.rubrik,
    titel: zeile.titel,
    lead: zeile.lead,
    autor: zeile.autor,
    text: zeile.text ?? '',
    textAbgeschnitten: zeile.text_abgeschnitten,
    link:
      zeile.link_url === null
        ? null
        : { url: zeile.link_url, abo: zeile.link_abo },
    weitereGemeinden: (zeile.gemeinden_genannt ?? []).filter(
      (n) => n !== zeile.gemeinde.name
    ),
    datenImText: alleDaten(material, heuteAus(heute))
  }
}

/** Kein Artikel aus Titel und Lead allein: er LIEST sich vollstaendig und ist es nicht. */
export function hatMaterial(fakten: Pick<SmdFakten, 'text'>): boolean {
  return fakten.text.trim() !== ''
}

export interface GeschriebeneSmdMeldung {
  bericht: { titel: string; lead: string; text: string }
  warnungen: string[]
  termin: Termin | null
  wichtig: boolean
}

/**
 * The article, with the checks that make its rules real: attribution to the
 * medium (retried once), digits against the handed material, absolute dates,
 * no self-written links, and the verbatim-overlap check against the piece —
 * another medium's words are its journalism, not ours.
 */
export async function smdMeldungMitChecks(
  fakten: SmdFakten,
  prompt: string
): Promise<GeschriebeneSmdMeldung> {
  let antwort = await schreibeEinmalMitNachfassen(
    prompt,
    SMD_MELDUNG_SYSTEM_PROMPT,
    'smd:meldung'
  )
  let bericht = parseSmdMeldung(antwort)
  let attribution = attributionsWarnung(
    `${bericht.lead} ${bericht.text}`,
    fakten
  )
  if (attribution !== null) {
    antwort = await completeJson<unknown>({
      zweck: 'smd:meldung:nachfassen',
      system: SMD_MELDUNG_SYSTEM_PROMPT,
      prompt: buildSmdRevision(
        fakten,
        bericht,
        `Nenne die Quelle im Fliesstext: "wie ${fakten.medium} berichtet".`
      ),
      maxTokens: 1500
    })
    bericht = parseSmdMeldung(antwort)
    attribution = attributionsWarnung(`${bericht.lead} ${bericht.text}`, fakten)
  }
  const wichtig = wichtigAus(antwort)
  const geplant = planeMitteilungTermin(
    terminVorschlagAus((antwort as Record<string, unknown>)['termin']),
    fakten.datenImText,
    wichtig
  )
  const alles = `${bericht.titel} ${bericht.lead} ${bericht.text}`
  const warnungen = [
    ...zeitWarnungen(alles),
    ...zahlWarnungen(alles, fakten),
    ...linkWarnungen(alles),
    ...ueberlappungsWarnungen(
      `${bericht.lead} ${bericht.text}`,
      `${fakten.lead ?? ''}\n${fakten.text}`
    ).map((w) =>
      w.replace('aus dem Blatt', `aus dem Beitrag von ${fakten.medium}`)
    ),
    ...(attribution === null ? [] : [attribution]),
    ...(geplant.warnung === null ? [] : [geplant.warnung])
  ]
  return { bericht, warnungen, termin: geplant.termin, wichtig }
}

/** Was der Artikel dem Dorfkoenig ohne Join mitgibt — `quelle_name` und `url` sind, was `quelleVon` liest. */
export function datengrundlageVon(
  zeile: SmdRohzeile,
  fakten: SmdFakten
): Record<string, unknown> {
  return {
    quelle: 'smd',
    quelle_name: zeile.medium,
    medium: zeile.medium,
    art: zeile.art,
    blog: zeile.blog,
    gemeinde: zeile.gemeinde.name,
    titel: zeile.titel,
    datum: zeile.datum,
    zeit: zeile.zeit,
    url: fakten.link?.url ?? null,
    link_status: zeile.link_status,
    link_abo: zeile.link_abo,
    gemeinden_genannt: zeile.gemeinden_genannt,
    text_abgeschnitten: zeile.text_abgeschnitten
  }
}

interface ItemsServiceLike {
  readByQuery(query: Record<string, unknown>): Promise<unknown[]>
  createOne(payload: Record<string, unknown>): Promise<string | number>
  updateOne(
    key: string,
    payload: Record<string, unknown>
  ): Promise<string | number>
}

export interface SmdMeldungKontext {
  beitraege: ItemsServiceLike
  meldungen: ItemsServiceLike
  regeln: readonly string[]
  /** `wichtigkeitDigest` of the desk — what the newsroom decided lately; '' when nothing yet. */
  wichtigkeit?: string
}

/** Eine Meldung aus einer Zeile — der eine Weg, den der Knopf geht. */
export async function schreibeSmdMeldung(
  kontext: SmdMeldungKontext,
  zeile: SmdRohzeile
): Promise<{ meldung: string; warnungen: string[] }> {
  const fakten = smdFakten(zeile)
  const { bericht, warnungen, termin, wichtig } = await smdMeldungMitChecks(
    fakten,
    buildSmdPrompt(fakten, kontext.regeln, kontext.wichtigkeit ?? '')
  )
  const meldungId = (await kontext.meldungen.createOne({
    smd_beitrag: zeile.id,
    gemeinde: zeile.gemeinde.id,
    titel: bericht.titel,
    lead: bericht.lead,
    text: mitQuelle(bericht.text, fakten),
    status: 'entwurf',
    verarbeitung: 'idle',
    zeit_warnungen: warnungen.length > 0 ? warnungen : null,
    termin,
    termin_vorschlag: termin,
    wichtig,
    wichtig_vorschlag: wichtig,
    datengrundlage: datengrundlageVon(zeile, fakten)
  })) as string
  await kontext.beitraege.updateOne(zeile.id, { entscheid: 'uebernommen' })
  return { meldung: meldungId, warnungen }
}
