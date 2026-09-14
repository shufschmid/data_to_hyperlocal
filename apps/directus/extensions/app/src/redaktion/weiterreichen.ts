// Handing a desk row up to the Chefredaktion — one rule for three desks.
//
// A candidate, a gazette publication or a broadcast contribution that is good
// but not verifiable today becomes a research lead instead of a Meldung: same
// collection as the inventory's own leads, so the chief editor has one pile.
// The three endpoints used to build that lead inline, three times, and the
// lead never knew which row it came from. Now the lead carries its ORIGIN
// (`kandidat` / `amtsblattmeldung` / `sendungskandidat`), which is what lets
// the digests read a hand-up by her verdict, and what "Zurück auf den Tisch"
// needs to find the row.
//
// Pure mappers plus one small writer with injected services, so the whole
// thing is unit-tested without a database. The Sichtungen call `reicheWeiter`
// too when a learned rule tells them to (automatic hand-ups); the mappers are
// the same, only `automatisch` and `regel` differ.

import { SENDUNGEN, type SendungsQuelle } from './sendung'

/** The fields a new lead is created with — the same shape from every desk. */
export interface HinweisFelder {
  ausgabe?: string
  gemeinde: string | null
  titel: string
  fundort: string
  seite?: number | null
  begruendung: string | null
  quelltext: string | null
  status: 'offen'
  kandidat?: string
  amtsblattmeldung?: string
  sendungskandidat?: string
}

export function kandidatAlsHinweis(
  kandidat: {
    id: string
    titel: string
    seite: number | null
    warum_exklusiv: string | null
    gemeinde: string | null
    ausgabe: { id: string; seiten_texte: string[] | null }
  },
  begruendung: string | null
): HinweisFelder {
  return {
    ausgabe: kandidat.ausgabe.id,
    gemeinde: kandidat.gemeinde,
    titel: kandidat.titel,
    fundort:
      `Beitrag "${kandidat.titel}"` +
      (kandidat.seite === null ? '' : `, S. ${kandidat.seite}`),
    seite: kandidat.seite,
    begruendung: begruendung ?? kandidat.warum_exklusiv,
    // The page's own text travels with the lead, so checking it never
    // depends on the issue row staying around.
    quelltext:
      kandidat.seite === null
        ? null
        : (kandidat.ausgabe.seiten_texte?.[kandidat.seite - 1] ?? null),
    status: 'offen',
    kandidat: kandidat.id
  }
}

export function publikationAlsHinweis(
  zeile: {
    id: string
    titel: string
    publikations_id: string
    rubrik_name: string | null
    amt: string | null
    frist: string | null
    angaben: { bezeichnung: string; wert: string }[] | null
    planbefunde: string[] | null
    pdf_url: string | null
    vorschlag_begruendung: string | null
    gemeinde: { id: string }
  },
  begruendung: string | null
): HinweisFelder {
  return {
    gemeinde: zeile.gemeinde.id,
    titel: zeile.titel,
    fundort: `Amtliche Publikation ${zeile.publikations_id}${
      zeile.rubrik_name === null ? '' : ` (${zeile.rubrik_name})`
    }`,
    begruendung: begruendung ?? zeile.vorschlag_begruendung ?? null,
    // The facts travel with the lead, so it outlives the row it came from.
    quelltext: [
      zeile.titel,
      zeile.amt === null ? '' : `Publiziert von: ${zeile.amt}`,
      zeile.frist === null ? '' : `Frist: ${zeile.frist}`,
      ...(zeile.angaben ?? []).map((a) => `${a.bezeichnung}: ${a.wert}`),
      ...(zeile.planbefunde ?? []).map((b) => `Aus den Plaenen: ${b}`),
      zeile.pdf_url ?? ''
    ]
      .filter((z) => z !== '')
      .join('\n'),
    status: 'offen',
    amtsblattmeldung: zeile.id
  }
}

export function sendungAlsHinweis(
  zeile: {
    id: string
    titel: string
    quelle: SendungsQuelle
    begruendung: string | null
    zusammenfassung: string | null
    gemeinde: { id: string }
    /** "31. August 2026" — rendered by the caller, never here. */
    datum: string
  },
  begruendung: string | null
): HinweisFelder {
  return {
    gemeinde: zeile.gemeinde.id,
    titel: zeile.titel,
    fundort: `${SENDUNGEN[zeile.quelle].name} vom ${zeile.datum}`,
    begruendung: begruendung ?? zeile.begruendung,
    // The facts travel with the lead in `quelltext`, so it outlives the
    // broadcast row the daily cleanup will eventually retire.
    quelltext: zeile.zusammenfassung,
    status: 'offen',
    sendungskandidat: zeile.id
  }
}

export interface WeiterreichDienste {
  hinweise: { createOne(payload: Record<string, unknown>): Promise<unknown> }
  ursprung: {
    updateOne(key: string, payload: Record<string, unknown>): Promise<unknown>
  }
}

/**
 * Creates the lead, then marks the origin row `weitergereicht`.
 *
 * In that order on purpose: a row marked without its lead would be a decision
 * with nothing on the chief editor's desk, while a lead without its mark only
 * lets the editor hand the same piece up twice — which the desk shows.
 *
 * `weitergereicht` is its own decision value, never `abgelehnt`: rejecting
 * would teach the Sichtung "don't propose such pieces", the opposite of the
 * truth. What the Chefredaktion then makes of it is read back by her verdict.
 */
export async function reicheWeiter(
  dienste: WeiterreichDienste,
  auftrag: {
    ursprungId: string
    felder: HinweisFelder
    automatisch?: boolean
    regel?: string | null
  }
): Promise<string> {
  const hinweisId = (await dienste.hinweise.createOne({
    ...auftrag.felder,
    automatisch: auftrag.automatisch === true,
    ...(auftrag.regel == null ? {} : { regel: auftrag.regel })
  })) as string

  await dienste.ursprung.updateOne(auftrag.ursprungId, {
    entscheid: 'weitergereicht'
  })

  return hinweisId
}
