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

import type { BuschtelefonFund } from '../types/schema'
import { datumDeutsch } from './amtsblatt'
import { bildTexte, istOeffentlich, quellenName } from './buschtelefon'
import { gekuerzt } from './presseschau'
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
  gemeindemitteilung?: string
  kantonsmitteilung?: string
  sendungskandidat?: string
  veranstaltung?: string
  smd_beitrag?: string
  buschtelefon_fund?: string
}

/** An Anlass handed up: its fields and description travel with the lead. */
export function anlassAlsHinweis(
  zeile: {
    id: string
    titel: string
    url: string
    url_kanonisch: string | null
    von: string
    bis: string | null
    zeit: string | null
    lokalitaet: string | null
    ort: string | null
    veranstalter: string | null
    anker: string | null
    beschreibung: string | null
    traktanden: string[] | null
    dokumente: Array<{ bezeichnung: string; gelesen: boolean }> | null
    vorschlag_begruendung: string | null
    gemeinde: { id: string }
  },
  begruendung: string | null
): HinweisFelder {
  const wann =
    zeile.bis === null || zeile.bis === zeile.von
      ? datumDeutsch(zeile.von)
      : `${datumDeutsch(zeile.von)} bis ${datumDeutsch(zeile.bis)}`
  return {
    gemeinde: zeile.gemeinde.id,
    titel: zeile.titel,
    fundort: `Veranstaltungskalender der Gemeinde, Termin ${wann}${zeile.anker === null ? '' : ` (${zeile.anker})`}`,
    begruendung: begruendung ?? zeile.vorschlag_begruendung ?? null,
    quelltext: [
      zeile.titel,
      [wann, zeile.zeit, zeile.lokalitaet, zeile.ort]
        .filter((t): t is string => t !== null && t !== '')
        .join(' · '),
      zeile.veranstalter === null ? '' : `Veranstalter: ${zeile.veranstalter}`,
      gekuerzt(zeile.beschreibung ?? '', 12_000),
      ...(zeile.traktanden ?? []).map((t) => `Traktandum: ${t}`),
      ...(zeile.dokumente ?? [])
        .filter((d) => d.gelesen)
        .map((d) => `Dokument: ${d.bezeichnung}`),
      zeile.url_kanonisch ?? zeile.url
    ]
      .filter((z) => z.trim() !== '')
      .join('\n'),
    status: 'offen',
    veranstaltung: zeile.id
  }
}

/** A municipal-news item handed up: the whole text travels with the lead. */
export function mitteilungAlsHinweis(
  zeile: {
    id: string
    titel: string
    url: string
    url_kanonisch: string | null
    publiziert_am: string | null
    kategorie: string | null
    teaser: string | null
    text: string | null
    anhaenge: Array<{ bezeichnung: string; gelesen: boolean }> | null
    vorschlag_begruendung: string | null
    gemeinde: { id: string }
  },
  begruendung: string | null
): HinweisFelder {
  const datum =
    zeile.publiziert_am === null
      ? ''
      : ` vom ${datumDeutsch(zeile.publiziert_am)}`
  return {
    gemeinde: zeile.gemeinde.id,
    titel: zeile.titel,
    fundort: `Mitteilung auf der Gemeindewebsite${datum}${zeile.kategorie === null ? '' : ` (${zeile.kategorie})`}`,
    begruendung: begruendung ?? zeile.vorschlag_begruendung ?? null,
    // The item's own words travel with the lead, so it outlives the row the
    // desk's cleanup will eventually retire.
    quelltext: [
      zeile.titel,
      zeile.teaser ?? '',
      gekuerzt(zeile.text ?? '', 12_000),
      ...(zeile.anhaenge ?? [])
        .filter((a) => a.gelesen)
        .map((a) => `Anhang: ${a.bezeichnung}`),
      zeile.url_kanonisch ?? zeile.url
    ]
      .filter((z) => z.trim() !== '')
      .join('\n'),
    status: 'offen',
    gemeindemitteilung: zeile.id
  }
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
    /**
     * More columns for the origin row, written in the same update as the
     * mark — the Buschtelefon desk stamps `entschieden_am`, which its
     * retention counts from.
     */
    ursprungFelder?: Record<string, unknown>
  }
): Promise<string> {
  const hinweisId = (await dienste.hinweise.createOne({
    ...auftrag.felder,
    automatisch: auftrag.automatisch === true,
    ...(auftrag.regel == null ? {} : { regel: auftrag.regel })
  })) as string

  await dienste.ursprung.updateOne(auftrag.ursprungId, {
    ...(auftrag.ursprungFelder ?? {}),
    entscheid: 'weitergereicht'
  })

  return hinweisId
}

/** A cantonal notice the editor (or a rule) hands to the Chefredaktion. */
export function kantonsmitteilungAlsHinweis(
  zeile: {
    id: string
    titel: string
    url: string
    quelle: 'medienmitteilung' | 'polizeimeldung'
    behoerde: string | null
    publiziert_am: string | null
    teaser: string | null
    text: string | null
    vorschlag_begruendung: string | null
    gemeinde: { id: string }
  },
  begruendung: string | null
): HinweisFelder {
  const datum =
    zeile.publiziert_am === null
      ? ''
      : ` vom ${datumDeutsch(zeile.publiziert_am)}`
  const fundort =
    zeile.quelle === 'polizeimeldung'
      ? `Polizeimeldung der Polizei Basel-Landschaft${datum}`
      : `Medienmitteilung des Kantons Basel-Landschaft${datum}${zeile.behoerde === null ? '' : ` (${zeile.behoerde})`}`
  return {
    gemeinde: zeile.gemeinde.id,
    titel: zeile.titel,
    fundort,
    begruendung: begruendung ?? zeile.vorschlag_begruendung ?? null,
    quelltext: [
      zeile.titel,
      zeile.teaser ?? '',
      gekuerzt(zeile.text ?? '', 12_000),
      zeile.url
    ]
      .filter((z) => z.trim() !== '')
      .join('\n'),
    status: 'offen',
    kantonsmitteilung: zeile.id
  }
}

/** Another medium's piece from the SMD dossier, handed to the Chefredaktion — with its online address where one was found. */
export function smdBeitragAlsHinweis(
  zeile: {
    id: string
    titel: string
    medium: string
    art: 'artikel' | 'blogeintrag'
    blog: string | null
    datum: string
    zeit: string | null
    lead: string | null
    text: string | null
    link_url: string | null
    vorschlag_begruendung: string | null
    gemeinde: { id: string }
  },
  begruendung: string | null
): HinweisFelder {
  const wann =
    zeile.zeit === null
      ? datumDeutsch(zeile.datum)
      : `${datumDeutsch(zeile.datum)}, ${zeile.zeit} Uhr`
  const fundort =
    zeile.art === 'blogeintrag'
      ? `${zeile.medium}, Blog «${zeile.blog ?? ''}», Eintrag vom ${wann} (SMD)`
      : `${zeile.medium} vom ${wann} (SMD)`
  return {
    gemeinde: zeile.gemeinde.id,
    titel: zeile.titel,
    fundort,
    begruendung: begruendung ?? zeile.vorschlag_begruendung ?? null,
    quelltext: [
      zeile.titel,
      zeile.lead ?? '',
      gekuerzt(zeile.text ?? '', 12_000),
      zeile.link_url ?? '(Artikel nicht online verfügbar)'
    ]
      .filter((z) => z.trim() !== '')
      .join('\n'),
    status: 'offen',
    smd_beitrag: zeile.id
  }
}

/** How long a find's display line may be before it is cut — the first line of a post, never the whole of it. */
export const FUND_TITEL_ZEICHEN = 90

/**
 * The display line of a find: a Facebook post has no title, so it is the
 * start of its own text — else of the first read image text, else of what it
 * shares — and where no words are left, the source and the day. It IS
 * wording, so it goes only where retention reaches (a Sichtung's prompt, an
 * example read fresh from the row) — never into a lead or a rule's `beleg`.
 */
export function fundTitel(
  zeile: Pick<
    BuschtelefonFund,
    | 'kanal'
    | 'quelle_art'
    | 'quelle_name'
    | 'veroeffentlicht_tag'
    | 'text'
    | 'bilder'
    | 'geteilt'
  >
): string {
  const kandidaten = [
    zeile.text ?? '',
    ...bildTexte(zeile.bilder),
    zeile.geteilt?.text ?? ''
  ]
  for (const kandidat of kandidaten) {
    const zeileEins = kandidat
      .split('\n')
      .map((z) => z.replace(/\s+/g, ' ').trim())
      .find((z) => z !== '')
    if (zeileEins === undefined) continue
    return zeileEins.length <= FUND_TITEL_ZEICHEN
      ? zeileEins
      : `${zeileEins.slice(0, FUND_TITEL_ZEICHEN - 1).trimEnd()}…`
  }
  return fundOhneWortlaut(zeile)
}

/** A find named WITHOUT its wording — what may stand where the row's retention does not reach (a rule's `beleg`, a lead's `titel`). */
export function fundOhneWortlaut(
  zeile: Pick<
    BuschtelefonFund,
    'kanal' | 'quelle_art' | 'quelle_name' | 'veroeffentlicht_tag'
  >
): string {
  const tag =
    zeile.veroeffentlicht_tag === null
      ? ''
      : ` vom ${datumDeutsch(zeile.veroeffentlicht_tag)}`
  return `Beitrag aus ${quellenName(zeile)}${tag}`
}

/**
 * A find from a village's social-network group, handed to the Chefredaktion.
 *
 * The lead carries NO WORDING — neither in `titel` nor in `quelltext` —
 * unlike every other desk's lead. A lead lives in `recherchehinweise`, which
 * keeps revisions: the verdict and «Zurück auf den Tisch» are written with
 * the caller's accountability, and each such update snapshots the whole
 * item into `directus_revisions`, where neither the door's tombstone nor
 * this desk's retention ever reaches. A private person's post, its image
 * texts and its commenters' first names must not land there. So the lead
 * names the find by source and day (`fundOhneWortlaut`), says «geschlossene
 * Gruppe» where it is one, and points at the find through
 * `buschtelefon_fund`; the Chefredaktion's view reads the material LIVE
 * through that key from `buschtelefon_funde` (no revisions), so the
 * retention that empties the find empties the lead's view with it.
 *
 * `begruendung` is the editor's own Begründung, else the Sichtung's
 * `vorschlag_begruendung` — a paraphrase by the model, not the material,
 * and accepted as such (decision of 11 November 2026).
 */
export function buschtelefonFundAlsHinweis(
  zeile: Pick<
    BuschtelefonFund,
    | 'id'
    | 'kanal'
    | 'quelle_art'
    | 'quelle_name'
    | 'quelle_sichtbarkeit'
    | 'veroeffentlicht_tag'
    | 'vorschlag_begruendung'
  > & { gemeinde: { id: string } | null },
  begruendung: string | null
): HinweisFelder {
  const name = fundOhneWortlaut(zeile)
  return {
    gemeinde: zeile.gemeinde?.id ?? null,
    titel: name,
    fundort:
      `${name}${istOeffentlich(zeile) ? '' : ' — geschlossene Gruppe'} (Buschtelefon)`.slice(
        0,
        300
      ),
    begruendung: begruendung ?? zeile.vorschlag_begruendung ?? null,
    quelltext: null,
    status: 'offen',
    buschtelefon_fund: zeile.id
  }
}
