import {
  angabenAusDetail,
  fetchDetail,
  fristAusDetail,
  kantonVonBezirk,
  ordneZuErfuellungsort,
  pubTypText,
  webLink,
  type AbrufOptionen,
  type SimapGemeinde,
  type SimapProjekt
} from '../shared/simap'
import type { Angabe } from '../shared/amtsblatt'

// Turning simap.ch publications into desk rows — the newsroom's own half of
// the procurement feed, next to `amtsblattlauf.ts` and for the same reason:
// the scheduled run and the editor's button must produce identical rows, so
// the mapping lives in one function both call.
//
// The rows land in `amtsblattmeldungen` as group `beschaffung`, marked
// `quelle_typ: 'simap'`. They then travel the whole existing path — triage,
// the three decisions, the article with its checks — without any of it knowing
// where they came from, except where the source has to be named.

interface ItemsServiceLike {
  updateOne(
    key: string,
    payload: Record<string, unknown>
  ): Promise<string | number>
}

/** Everything a new desk row needs, keyed as the collection's columns. */
export interface SimapZeilenwerte {
  publikations_id: string
  quelle_typ: 'simap'
  publikationsnummer: string | null
  gemeinde: string
  kanton: string
  gruppe: 'beschaffung'
  rubrik: string
  unterrubrik: string
  rubrik_name: string
  titel: string
  publiziert_am: string
  frist: string | null
  amt: string
  pdf_url: string
  angaben: Angabe[]
  /**
   * `nicht_lesbar`, and that is a statement rather than a placeholder: simap
   * publishes no plan sheets to read. It is also what keeps these rows out of
   * the run's plan-reading query (which asks for `plan_status = 'offen'`) and
   * hides the "Unterlagen lesen" button on the desk.
   */
  plan_status: 'nicht_lesbar'
}

/**
 * One publication, mapped onto the desk's columns.
 *
 * The detail document is optional: without it the row still stands with title,
 * date, office and link — the editor sees it and the triage can judge it — and
 * the facts are fetched later, either by the next run or by the button. A row
 * that exists without its facts is recoverable; a publication nobody sees is not.
 */
export function baueSimapZeile(
  projekt: SimapProjekt,
  gemeinde: SimapGemeinde,
  detail: unknown | null
): SimapZeilenwerte {
  return {
    publikations_id: projekt.publicationId,
    quelle_typ: 'simap',
    publikationsnummer: projekt.publikationsnummer || null,
    gemeinde: gemeinde.id,
    // The place of performance decides, because that is where the work happens;
    // only where simap named none does the municipality's own canton stand in.
    kanton: projekt.ort?.cantonId ?? kantonVonBezirk(gemeinde.bezirk),
    gruppe: 'beschaffung',
    rubrik: projekt.pubTyp,
    unterrubrik: projekt.projektUnterTyp,
    rubrik_name: pubTypText(projekt.pubTyp, projekt.korrigiert),
    titel: projekt.titel,
    publiziert_am: projekt.publiziertAm,
    frist: detail === null ? null : fristAusDetail(detail),
    amt: projekt.vergabestelle,
    pdf_url: webLink(projekt.id),
    angaben: detail === null ? [] : angabenAusDetail(detail, projekt.pubTyp),
    plan_status: 'nicht_lesbar'
  }
}

/**
 * Which municipality a publication belongs to.
 *
 * The procurement-office half hands the municipality in (one request per
 * municipality, so the attribution is certain — see `fetchVergabestellen`);
 * the place-of-performance half has to find it by postcode.
 */
export function ordneProjektZu(
  projekt: SimapProjekt,
  gemeinden: readonly SimapGemeinde[],
  vorgegeben: SimapGemeinde | null
): SimapGemeinde | null {
  return vorgegeben ?? ordneZuErfuellungsort(projekt, gemeinden)
}

export interface SimapLaufKontext {
  meldungen: ItemsServiceLike
  logger: { warn: (e: unknown, m?: string) => void }
  abruf: AbrufOptionen
}

/**
 * Fetches the facts for a row that has none — the fallback for a publication
 * whose detail request failed while it was being collected.
 *
 * The gazette's equivalent (`ergaenzeZeile`) would ask amtsblattportal.ch with
 * a simap uuid and get a 404, which is exactly why this exists and why the
 * endpoint branches on `quelle_typ` before choosing between the two.
 */
export async function ergaenzeSimapZeile(
  zeile: {
    id: string
    publikations_id: string
    pdf_url: string | null
    rubrik: string | null
  },
  projektId: string,
  kontext: SimapLaufKontext
): Promise<{ angaben: Angabe[]; frist: string | null } | null> {
  try {
    const detail = await fetchDetail(
      projektId,
      zeile.publikations_id,
      kontext.abruf
    )
    const angaben = angabenAusDetail(detail, zeile.rubrik ?? '')
    const frist = fristAusDetail(detail)
    await kontext.meldungen.updateOne(zeile.id, {
      angaben,
      ...(frist === null ? {} : { frist })
    })
    return { angaben, frist }
  } catch (fehler) {
    kontext.logger.warn(
      fehler,
      `simap: Angaben zu ${zeile.publikations_id} nicht geholt`
    )
    return null
  }
}
