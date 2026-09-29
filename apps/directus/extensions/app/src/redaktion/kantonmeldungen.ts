// Eine Meldung je vorgeschlagener Kantonsmitteilung — geschrieben im Lauf,
// nicht erst auf Klick: dieselbe Abmachung wie bei den Gemeindeseiten
// (`gemeindemeldungen.ts`), und aus demselben Grund nur fuer die VORSCHLAEGE
// und ohne `lerne(…)`: der Entwurf lehrt nichts, die drei Entscheide tun es.
//
// Was hier anders ist als beim Gemeindetisch: der Sprecher ist der Kanton
// oder die Polizei, nie die Gemeinde — die Attribution und die Quellenzeile
// sagen es —, und eine Polizeimeldung wird ueber den Ort geschrieben, nie
// ueber eine genannte Person (`polizeiPersonenWarnungen`).

import { completeJson } from '../shared/claude'
import { alleDaten, heuteAus } from '../shared/gemeindeseite/datum'
import type { KantonQuelle } from '../types/schema'
import { heuteIso } from './feiertage'
import { schreibeEinmalMitNachfassen } from './gemeindemeldungen'
import {
  attributionsWarnung,
  buildKantonPrompt,
  buildKantonRevision,
  KANTON_MELDUNG_SYSTEM_PROMPT,
  linkWarnungen,
  mitQuelle,
  parseKantonMeldung,
  polizeiPersonenWarnungen,
  quelleNameFuer,
  ueberlappungsWarnungen,
  zahlWarnungen,
  zeitWarnungen,
  type KantonFakten
} from './kanton'
import {
  planeMitteilungTermin,
  terminVorschlagAus,
  wichtigAus,
  type Termin
} from './termin'
import { ladeWichtigkeitSignale, wichtigkeitDigest } from './wichtigkeit'

/** Wie viele Meldungen ein Lauf schreibt. Ein Modellaufruf je Stueck. */
export const KANTON_MELDUNGEN_JE_LAUF = 20

export interface KantonRohzeile {
  id: string
  url: string
  quelle: KantonQuelle
  behoerde: string | null
  titel: string
  teaser: string | null
  publiziert_am: string | null
  text: string | null
  text_abgeschnitten: boolean
  gemeinden_genannt: string[] | null
  entscheid: string
  vorschlag_begruendung: string | null
  gemeinde: { id: string; name: string }
}

export const KANTON_FELDER = [
  'id',
  'url',
  'quelle',
  'behoerde',
  'titel',
  'teaser',
  'publiziert_am',
  'text',
  'text_abgeschnitten',
  'gemeinden_genannt',
  'entscheid',
  'vorschlag_begruendung',
  'gemeinde.id',
  'gemeinde.name'
]

/** The facts the writer works from; `heute` anchors the year of dates the wording prints without one. */
export function kantonFakten(
  zeile: KantonRohzeile,
  heute: string = heuteIso()
): KantonFakten {
  const material = [zeile.titel, zeile.teaser ?? '', zeile.text ?? ''].join(
    '\n'
  )
  return {
    gemeinde: zeile.gemeinde.name,
    quelle: zeile.quelle,
    quelleName: quelleNameFuer(zeile.quelle),
    behoerde: zeile.behoerde,
    titel: zeile.titel,
    teaser: zeile.teaser,
    publiziertAm: zeile.publiziert_am,
    text: zeile.text ?? '',
    textAbgeschnitten: zeile.text_abgeschnitten,
    url: zeile.url,
    weitereGemeinden: (zeile.gemeinden_genannt ?? []).filter(
      (n) => n !== zeile.gemeinde.name
    ),
    datenImText: alleDaten(material, heuteAus(heute))
  }
}

/** Kein Artikel aus Titel und Anriss allein: er LIEST sich vollstaendig und ist es nicht. */
export function hatMaterial(fakten: Pick<KantonFakten, 'text'>): boolean {
  return fakten.text.trim() !== ''
}

export interface GeschriebeneKantonMeldung {
  bericht: { titel: string; lead: string; text: string }
  warnungen: string[]
  termin: Termin | null
  wichtig: boolean
}

function attributionsSatz(fakten: Pick<KantonFakten, 'quelle'>): string {
  return fakten.quelle === 'polizeimeldung'
    ? 'Nenne die Quelle im Fliesstext: "wie die Polizei Basel-Landschaft mitteilt".'
    : 'Nenne die Quelle im Fliesstext: "wie der Kanton Basel-Landschaft mitteilt".'
}

/**
 * The article, with the checks that make its rules real: attribution to the
 * speaker (retried once), digits against the handed material, absolute
 * dates, no self-written links, the verbatim-overlap check against the
 * canton's own text, and — for a police notice — no named private person.
 */
export async function kantonMeldungMitChecks(
  fakten: KantonFakten,
  prompt: string
): Promise<GeschriebeneKantonMeldung> {
  let antwort = await schreibeEinmalMitNachfassen(
    prompt,
    KANTON_MELDUNG_SYSTEM_PROMPT
  )
  let bericht = parseKantonMeldung(antwort)

  let attribution = attributionsWarnung(
    `${bericht.lead} ${bericht.text}`,
    fakten
  )
  if (attribution !== null) {
    antwort = await completeJson<unknown>({
      system: KANTON_MELDUNG_SYSTEM_PROMPT,
      prompt: buildKantonRevision(fakten, bericht, attributionsSatz(fakten)),
      maxTokens: 1500
    })
    bericht = parseKantonMeldung(antwort)
    attribution = attributionsWarnung(`${bericht.lead} ${bericht.text}`, fakten)
  }

  const wichtig = wichtigAus(antwort)
  const geplant = planeMitteilungTermin(
    terminVorschlagAus((antwort as Record<string, unknown>)['termin']),
    fakten.datenImText,
    wichtig
  )

  const alles = `${bericht.titel} ${bericht.lead} ${bericht.text}`
  const woher =
    fakten.quelle === 'polizeimeldung'
      ? 'aus der Meldung der Polizei'
      : 'aus der Mitteilung des Kantons'
  const warnungen = [
    ...zeitWarnungen(alles),
    ...zahlWarnungen(alles, fakten),
    ...linkWarnungen(alles),
    ...ueberlappungsWarnungen(
      `${bericht.lead} ${bericht.text}`,
      fakten.text
    ).map((w) => w.replace('aus dem Blatt', woher)),
    ...(attribution === null ? [] : [attribution]),
    ...(geplant.warnung === null ? [] : [geplant.warnung]),
    ...polizeiPersonenWarnungen(alles, fakten)
  ]

  return { bericht, warnungen, termin: geplant.termin, wichtig }
}

/** Was der Artikel dem Dorfkoenig ohne Join mitgibt — `quelle_name` und `url` sind, was `quelleVon` liest. */
export function datengrundlageVon(
  zeile: KantonRohzeile,
  fakten: KantonFakten
): Record<string, unknown> {
  return {
    quelle: 'kanton',
    quelle_name: fakten.quelleName,
    quelle_art: zeile.quelle,
    behoerde: zeile.behoerde,
    gemeinde: zeile.gemeinde.name,
    titel: zeile.titel,
    publiziert_am: zeile.publiziert_am,
    url: zeile.url,
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

export interface KantonMeldungKontext {
  mitteilungen: ItemsServiceLike
  meldungen: ItemsServiceLike
  regeln: readonly string[]
  /** `wichtigkeitDigest` of the desk — what the newsroom decided lately; '' when nothing yet. */
  wichtigkeit?: string
  logger: { info: (text: string) => void; warn: (...args: unknown[]) => void }
}

/** Eine Meldung aus einer Zeile — der eine Weg, den Knopf und Lauf teilen. */
export async function schreibeKantonMeldung(
  kontext: Pick<
    KantonMeldungKontext,
    'mitteilungen' | 'meldungen' | 'regeln' | 'wichtigkeit'
  >,
  zeile: KantonRohzeile
): Promise<{ meldung: string; warnungen: string[] }> {
  const fakten = kantonFakten(zeile)
  const { bericht, warnungen, termin, wichtig } = await kantonMeldungMitChecks(
    fakten,
    buildKantonPrompt(fakten, kontext.regeln, kontext.wichtigkeit ?? '')
  )

  const meldungId = (await kontext.meldungen.createOne({
    kantonsmitteilung: zeile.id,
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

  await kontext.mitteilungen.updateOne(zeile.id, {
    entscheid: 'uebernommen'
  })

  return { meldung: meldungId, warnungen }
}

export interface KantonMeldungenErgebnis {
  geschrieben: number
  /** Vorschlaege ohne lesbaren Text — benannt, nie still uebergangen. */
  ohneText: string[]
  /** Was der Deckel dieses Laufs liegen liess; der naechste holt es. */
  wartend: number
  fehler: string[]
}

/** Jeder Vorschlag ohne Artikel bekommt seinen — hoechstens `hoechstens` je Lauf, das Naechstliegende zuerst. */
export async function schreibeKantonMeldungen(
  kontext: KantonMeldungKontext,
  hoechstens: number = KANTON_MELDUNGEN_JE_LAUF
): Promise<KantonMeldungenErgebnis> {
  const ergebnis: KantonMeldungenErgebnis = {
    geschrieben: 0,
    ohneText: [],
    wartend: 0,
    fehler: []
  }

  const beschrieben = (await kontext.meldungen.readByQuery({
    filter: {
      kantonsmitteilung: { _nnull: true },
      status: { _neq: 'verworfen' }
    },
    fields: ['kantonsmitteilung'],
    limit: -1
  })) as Array<{ kantonsmitteilung: string | null }>
  const schonBeschrieben = new Set(
    beschrieben.flatMap((m) =>
      m.kantonsmitteilung === null ? [] : [m.kantonsmitteilung]
    )
  )

  const vorschlaege = (await kontext.mitteilungen.readByQuery({
    filter: { vorschlag: { _eq: true }, entscheid: { _eq: 'offen' } },
    fields: KANTON_FELDER,
    sort: ['-publiziert_am', '-date_created'],
    limit: -1
  })) as KantonRohzeile[]

  const offen = vorschlaege.filter((z) => !schonBeschrieben.has(z.id))
  const dran = offen.slice(0, hoechstens)
  ergebnis.wartend = offen.length - dran.length
  if (dran.length === 0) return ergebnis

  const wichtigkeit =
    kontext.wichtigkeit ??
    wichtigkeitDigest(
      await ladeWichtigkeitSignale(kontext.meldungen, 'kantonsmitteilung')
    )

  for (const zeile of dran) {
    if (!hatMaterial(kantonFakten(zeile))) {
      ergebnis.ohneText.push(`${zeile.gemeinde.name}: ${zeile.titel}`)
      continue
    }
    try {
      await schreibeKantonMeldung({ ...kontext, wichtigkeit }, zeile)
      ergebnis.geschrieben += 1
    } catch (fehler) {
      kontext.logger.warn(
        fehler,
        `kanton: Meldung zu "${zeile.titel}" fehlgeschlagen.`
      )
      ergebnis.fehler.push(
        `${zeile.gemeinde.name}: ${zeile.titel} — ${
          fehler instanceof Error ? fehler.message : 'Fehler'
        }`
      )
    }
  }

  if (ergebnis.geschrieben > 0 || ergebnis.wartend > 0) {
    kontext.logger.info(
      `kanton: ${ergebnis.geschrieben} Meldungen geschrieben, ${ergebnis.wartend} warten.`
    )
  }
  return ergebnis
}
