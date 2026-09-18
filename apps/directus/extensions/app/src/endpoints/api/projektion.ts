// Turning a stored article into the shape an outside reader gets — pure, and
// the reason this API is an extension rather than Directus' own `/items` door.
//
// Three things a consumer needs are NOT columns and have to be computed here:
//
//   - the municipality's KEY. `gemeinden` has a name and a BFS number, no slug;
//     the public blog slugifies in the frontend. An outside reader cannot be
//     asked to guess that «Münchenstein» is `muenchenstein`.
//   - the RUBRIK. Which of seven kinds an article is shows only in which of six
//     foreign keys (or `erscheint_am`) is set.
//   - the SOURCE. Every kind stores it differently: the desks put it into
//     `datengrundlage` under different keys, statistics keep it in the dataset
//     behind the run, and sport has none at all.
//
// And one thing has to be kept OUT: `datengrundlage` itself. For a statistics
// article it holds up to sixty raw rows of the underlying dataset — the working
// material of the newsroom, not part of a published article.

import { AMT, quellenlink, type Quellenlink } from '../../redaktion/quelle'
import { lesePortalKonfiguration } from '../../redaktion/portale'
import { istZahlwarnung, istZeitwarnung } from '../../redaktion/warnungen'
import { seitenLink } from '../../shared/wochenblatt/parse'
import type { Entscheidung, Publikationsakteur } from '../../types/schema'

export type Rubrik =
  | 'statistik'
  | 'sport'
  | 'entsorgung'
  | 'amtsblatt'
  | 'beschaffung'
  | 'gemeinde'
  | 'presseschau'
  | 'sendung'

/** A row as the query below reads it — deliberately narrower than `Meldung`. */
export interface Rohzeile {
  id: string
  titel: string | null
  lead: string | null
  text: string | null
  publiziert_am: string | null
  erscheint_am: string | null
  perle: boolean | null
  /**
   * The statistics run, with the dataset behind it — that is where a statistics
   * article's address comes from. Read as a relation rather than fished out of
   * the text: measured on the real articles, the model often writes no source
   * line at all, so the text is not a reliable carrier. `quellenlink()` builds
   * the same address the newsroom's own check verifies against.
   */
  lauf:
    | {
        datensatz: {
          externe_id: string | null
          quelle:
            | {
                typ: string | null
                /** The portal this dataset came from — one row per portal. */
                basis_url?: string | null
                /** Its adapter options, where the office's name lives. */
                konfiguration?: unknown
              }
            | string
            | null
          ankuendigung: { link: string | null } | string | null
        } | null
      }
    | string
    | null
  kandidat: string | null
  sendungskandidat: string | null
  /** Set for an article written from a month of the EuroAirport's ILS-33 sheet. */
  suedanflugquote: string | null
  /** Set for an article written from one Vorlage of one vote day. */
  abstimmung: string | null
  amtsblattmeldung: { quelle_typ: string | null } | string | null
  /** Set for articles written from a municipality's own news page. */
  gemeindemitteilung: string | null
  spiel: {
    sportart: string | null
    wettbewerb: string | null
    heim: string | null
    gast: string | null
    tore_heim: number | null
    tore_gast: number | null
    datum: string | null
  } | null
  gemeinde: { id: string; name: string; bfs_nummer: number } | null
  datengrundlage: unknown
  /** Every complaint a check raised, in the editor's own German. */
  zeit_warnungen: string[] | null
  /** The counter-check's answer, or null when none was asked for. */
  entscheidung: Entscheidung | null
  freigegeben_am: string | null
  publiziert_durch: Publikationsakteur | null
}

export interface ApiSport {
  sportart: string | null
  wettbewerb: string | null
  heim: string | null
  gast: string | null
  tore_heim: number | null
  tore_gast: number | null
  datum: string | null
}

export interface ApiArtikel {
  id: string
  gemeinde: string | null
  gemeinde_name: string | null
  bfs_nummer: number | null
  rubrik: Rubrik | null
  titel: string | null
  lead: string | null
  text: string | null
  publiziert_am: string | null
  erscheint_am: string | null
  perle: boolean
  quelle_name: string | null
  quelle_url: string | null
  sport: ApiSport | null
  pruefsiegel: Pruefsiegel
}

/** The checks, split by which one spoke — see `redaktion/warnungen.ts`. */
export interface Pruefungen {
  zeitbezug: string[]
  zahlen: string[]
  weitere: string[]
}

export type Gegenpruefung = Entscheidung | 'keine'

/**
 * Whose signature stands under the publication.
 *
 * Two of them are real (R1 of the Richtungswechsel): `redaktion` is a person
 * clicking publish, `freigegeben_dann_zeitlauf` an approval given by hand and
 * carried out by the scheduled run days later — a waste-collection reminder is
 * always the second kind. `unbekannt` is the honest answer for the articles
 * that were published before the mark existed, and for the case the state
 * machine does not allow but a future one might: the run publishing something
 * nobody ever approved.
 */
export type Freigabestufe =
  | 'redaktion'
  | 'freigegeben_dann_zeitlauf'
  | 'unbekannt'

export interface Pruefsiegel {
  pruefungen: Pruefungen
  /** True when no check has anything open. */
  bestanden: boolean
  gegenpruefung: Gegenpruefung
  freigabe: Freigabestufe
  freigegeben_am: string | null
  publiziert_am: string | null
  herkunft: {
    rubrik: Rubrik | null
    quelle_name: string | null
    quelle_url: string | null
  }
}

/**
 * The municipality's key, byte-for-byte what the public blog uses
 * (`apps/front/src/lib/redaktion.ts`).
 *
 * Deliberately duplicated across the two apps rather than shared: they are
 * separate npm packages with no hoisting (root CLAUDE.md), and a slug that
 * drifted between the blog's own links and this API would break both at once.
 * The test pins the cases that matter.
 */
export function gemeindeSlug(name: string): string {
  return name
    .toLocaleLowerCase('de-CH')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export interface GemeindeZeile {
  id: string
  name: string
  bfs_nummer: number
  bezirk: string | null
}

/** Slug → municipality, for resolving the `?gemeinde=` filter. */
export function buildSlugMap(
  gemeinden: readonly GemeindeZeile[]
): Map<string, GemeindeZeile> {
  return new Map(gemeinden.map((g) => [gemeindeSlug(g.name), g]))
}

function objekt(wert: unknown): Record<string, unknown> {
  return typeof wert === 'object' && wert !== null
    ? (wert as Record<string, unknown>)
    : {}
}

function text(wert: unknown): string | null {
  return typeof wert === 'string' && wert.trim() !== '' ? wert : null
}

function quelleTypVon(zeile: Rohzeile): string | null {
  const roh = zeile.amtsblattmeldung
  if (roh === null) return null
  // The query asks for the nested field, but a plain uuid arrives when someone
  // reads this collection without the relation expanded.
  if (typeof roh === 'string') return null
  return roh.quelle_typ
}

/**
 * Which kind of article this is.
 *
 * The markers are mutually exclusive by construction — each writer sets exactly
 * one — so the order below is documentation, not a tie-breaker. `null` means an
 * article carrying none of them, which no writer produces today; reporting it
 * honestly beats guessing a rubrik.
 *
 * `beschaffung` comes from the RELATION, not from `datengrundlage`: the gazette
 * desk stores `quelle: 'amtsblatt'` for simap rows too, so only
 * `amtsblattmeldungen.quelle_typ` tells the two apart.
 *
 * The south-approach quota is `statistik` and deliberately not a rubrik of its
 * own. A consumer that already knows the seven values would have to learn an
 * eighth for one municipality's aircraft, and a new rubrik is a decision for
 * the consumer's side of this contract, not a side effect of building the
 * feed. What tells it apart is `quelle_name: 'EuroAirport'`. A VOTE result is
 * the same decision a second time: it is a figure per municipality from the
 * canton's own office, so it is `statistik`, and `quelle_name: 'Kanton
 * Basel-Landschaft'` with the canton's publication as `quelle_url` tells it
 * apart.
 */
export function rubrikVon(zeile: Rohzeile): Rubrik | null {
  if (zeile.lauf !== null) return 'statistik'
  if (zeile.suedanflugquote !== null) return 'statistik'
  if (zeile.abstimmung !== null) return 'statistik'
  if (zeile.spiel !== null) return 'sport'
  if (zeile.erscheint_am !== null) return 'entsorgung'
  if (zeile.kandidat !== null) return 'presseschau'
  if (zeile.amtsblattmeldung !== null)
    return quelleTypVon(zeile) === 'simap' ? 'beschaffung' : 'amtsblatt'
  if (zeile.gemeindemitteilung !== null) return 'gemeinde'
  if (zeile.sendungskandidat !== null) return 'sendung'
  return null
}

/**
 * The address of a statistics article, built from the dataset behind its run.
 *
 * NOT read out of the text, and that was a correction the real data forced:
 * `repariereQuellenlink` only repairs an anchor the model wrote, and measured
 * on the published statistics articles it often wrote none — the text simply
 * ends with the prose. `quellenlink()` derives the address from the portal id
 * instead, which is the same function the newsroom's own source check verifies
 * an article against, so the API and the article can never name two different
 * places.
 */
export function statistikQuelle(lauf: Rohzeile['lauf']): Quellenlink | null {
  if (lauf === null || typeof lauf === 'string') return null
  const datensatz = lauf.datensatz
  if (datensatz === null) return null

  const quelle = datensatz.quelle
  const portal = quelle === null || typeof quelle === 'string' ? null : quelle
  const ankuendigung = datensatz.ankuendigung

  return quellenlink({
    externeId: datensatz.externe_id,
    quelleTyp: portal?.typ ?? null,
    portalUrl: portal?.basis_url ?? null,
    amt: lesePortalKonfiguration(portal?.konfiguration).amt,
    ankuendigungLink:
      ankuendigung === null || typeof ankuendigung === 'string'
        ? null
        : ankuendigung.link
  })
}

/** Just the address — the shape the door delivered before the second portal. */
export function statistikUrl(lauf: Rohzeile['lauf']): string | null {
  return statistikQuelle(lauf)?.url ?? null
}

export interface Quelle {
  name: string | null
  url: string | null
}

/**
 * Where the article's facts come from — R11: a resource without provenance is
 * an assertion.
 *
 * `null` is a legitimate answer and better than a fabricated one: a match
 * report has no stable public per-match address (the association's "what's on"
 * page rotates daily — see the root CLAUDE.md), and a waste calendar that was
 * uploaded as a file rather than registered by address has none either.
 */
export function quelleVon(zeile: Rohzeile, rubrik: Rubrik | null): Quelle {
  const daten = objekt(zeile.datengrundlage)

  switch (rubrik) {
    case 'statistik': {
      // Two kinds of statistics article share this rubrik, and they have
      // nothing in common but the word. The south-approach one names the
      // airport and carries the month's own PDF, written into
      // `datengrundlage` by the desk for exactly this reader; the portal one
      // derives its address from the dataset behind its run.
      if (zeile.suedanflugquote !== null) {
        return {
          name: text(daten['quelle_name']) ?? 'EuroAirport',
          url: text(daten['url'])
        }
      }

      // A vote article carries the canton's own publication of its Vorlage,
      // written into `datengrundlage` by the desk for exactly this reader.
      if (zeile.abstimmung !== null) {
        return {
          name: text(daten['quelle_name']) ?? 'Kanton Basel-Landschaft',
          url: text(daten['url'])
        }
      }

      // Name and address from the same call: a second portal that delivered
      // its own address under the first portal's office would be worse than
      // either error alone.
      const statistik = statistikQuelle(zeile.lauf)
      return {
        name: statistik?.bezeichnung ?? AMT,
        url: statistik?.url ?? null
      }
    }

    case 'sport':
      return { name: 'Match-Center', url: null }

    case 'entsorgung': {
      const gemeinde = text(daten['gemeinde']) ?? zeile.gemeinde?.name ?? ''
      const jahr = daten['jahr']
      const teile = [
        'Abfuhrkalender',
        gemeinde,
        jahr === undefined || jahr === null ? '' : String(jahr)
      ]
      const quellen = daten['quellen']
      const erste = Array.isArray(quellen) ? text(quellen[0]) : null
      return {
        name: teile.filter((t) => t !== '').join(' '),
        url: erste
      }
    }

    case 'amtsblatt':
      return {
        name: text(daten['amt']) ?? 'Amtliche Publikation',
        url: text(daten['pdf_url'])
      }

    case 'beschaffung':
      return { name: 'simap.ch', url: text(daten['pdf_url']) }

    // The desk writes `quelle_name` and `url` into `datengrundlage` for exactly
    // this reader; the joined municipality is only the fallback for a row
    // written before that contract.
    case 'gemeinde':
      return {
        name:
          text(daten['quelle_name']) ??
          (zeile.gemeinde === null ? null : `Gemeinde ${zeile.gemeinde.name}`),
        url: text(daten['url'])
      }

    case 'presseschau': {
      const pdf = text(daten['pdf_url'])
      const seite = daten['seite']
      return {
        name: text(daten['blatt']),
        url:
          pdf === null
            ? null
            : typeof seite === 'number'
              ? seitenLink(pdf, seite)
              : pdf
      }
    }

    case 'sendung': {
      const url = text(daten['quell_url'])
      if (url === null) return { name: text(daten['sendung']), url: null }
      // Rebuilt here because the stored address has no time marker: the show's
      // own `quelleZeile` appends it, and the two players want different
      // separators — SRF's podcast takes `#t=`, telebasel's page `?t=`.
      const marke = daten['zeitmarke_sekunden']
      if (typeof marke !== 'number' || marke <= 0)
        return { name: text(daten['sendung']), url }
      const trenner = daten['quelle'] === 'punkt6' ? '?t=' : '#t='
      return {
        name: text(daten['sendung']),
        url: `${url}${trenner}${Math.round(marke)}`
      }
    }

    default:
      return { name: null, url: null }
  }
}

/**
 * The one warning column, split by the check that wrote it.
 *
 * Sorted rather than parsed: every entry leaves unchanged, in the German the
 * editor reads. A consumer shows them; it never reads a number back out of
 * one. The classification is an exact match against the wordings the writers
 * build from (`redaktion/warnungen.ts`), so a desk that invents a new warning
 * lands under `weitere` — visible and uncategorised, never silently dropped.
 */
export function sortiereWarnungen(
  warnungen: readonly string[] | null
): Pruefungen {
  const sortiert: Pruefungen = { zeitbezug: [], zahlen: [], weitere: [] }
  for (const warnung of warnungen ?? []) {
    if (istZeitwarnung(warnung)) sortiert.zeitbezug.push(warnung)
    else if (istZahlwarnung(warnung)) sortiert.zahlen.push(warnung)
    else sortiert.weitere.push(warnung)
  }
  return sortiert
}

/**
 * What was checked, who signed, and where the facts came from — computed, never
 * stored.
 *
 * Every part of it already lies in the row: the warnings in `zeit_warnungen`,
 * the counter-check in `entscheidung`, the signature in `publiziert_durch` and
 * `freigegeben_am`, the provenance in the same computation the article itself
 * uses. A stored seal would be a second copy that can go stale the moment a
 * revision rewrites the text; a computed one cannot.
 *
 * It carries no prose of its own and no working material — only the warnings
 * as they stand, three moments and the source the article already names.
 */
export function pruefsiegel(zeile: Rohzeile): Pruefsiegel {
  const pruefungen = sortiereWarnungen(zeile.zeit_warnungen)
  const rubrik = rubrikVon(zeile)
  const quelle = quelleVon(zeile, rubrik)

  const freigabe: Freigabestufe =
    zeile.publiziert_durch === 'redaktion'
      ? 'redaktion'
      : zeile.publiziert_durch === 'zeitlauf' && zeile.freigegeben_am !== null
        ? 'freigegeben_dann_zeitlauf'
        : 'unbekannt'

  return {
    pruefungen,
    bestanden:
      pruefungen.zeitbezug.length === 0 &&
      pruefungen.zahlen.length === 0 &&
      pruefungen.weitere.length === 0,
    gegenpruefung: zeile.entscheidung ?? 'keine',
    freigabe,
    freigegeben_am: alsUtc(zeile.freigegeben_am),
    publiziert_am: alsUtc(zeile.publiziert_am),
    herkunft: {
      rubrik,
      quelle_name: quelle.name,
      quelle_url: quelle.url
    }
  }
}

/** Timestamps leave in UTC, whatever the database handed over (R12). */
function alsUtc(wert: string | null): string | null {
  if (wert === null) return null
  const instant = new Date(wert)
  return Number.isNaN(instant.getTime()) ? wert : instant.toISOString()
}

export function projektion(zeile: Rohzeile): ApiArtikel {
  const rubrik = rubrikVon(zeile)
  const quelle = quelleVon(zeile, rubrik)

  return {
    id: zeile.id,
    gemeinde:
      zeile.gemeinde === null ? null : gemeindeSlug(zeile.gemeinde.name),
    gemeinde_name: zeile.gemeinde?.name ?? null,
    bfs_nummer: zeile.gemeinde?.bfs_nummer ?? null,
    rubrik,
    titel: zeile.titel,
    lead: zeile.lead,
    text: zeile.text,
    publiziert_am: alsUtc(zeile.publiziert_am),
    erscheint_am: zeile.erscheint_am,
    // A boolean a consumer can branch on without a null check; only ever true
    // on a press review the chief editor marked.
    perle: zeile.perle === true,
    quelle_name: quelle.name,
    quelle_url: quelle.url,
    sport:
      rubrik === 'sport' && zeile.spiel !== null
        ? {
            sportart: zeile.spiel.sportart,
            wettbewerb: zeile.spiel.wettbewerb,
            heim: zeile.spiel.heim,
            gast: zeile.spiel.gast,
            tore_heim: zeile.spiel.tore_heim,
            tore_gast: zeile.spiel.tore_gast,
            datum: alsUtc(zeile.spiel.datum)
          }
        : null,
    pruefsiegel: pruefsiegel(zeile)
  }
}

/**
 * A retraction, as the row carries it — deliberately narrower than `Rohzeile`.
 *
 * No `text`, no `lead`, and the query does not read them: what was pulled back
 * does not leave the house a second time, not even as evidence of itself.
 */
export interface Korrekturzeile {
  id: string
  titel: string | null
  status: 'entwurf' | 'verworfen'
  publiziert_am: string | null
  zurueckgezogen_am: string | null
  gemeinde: { id: string; name: string; bfs_nummer: number } | null
}

export interface ApiKorrektur {
  id: string
  gemeinde: string | null
  titel: string | null
  publiziert_am: string | null
  zurueckgezogen_am: string | null
  status: 'entwurf' | 'verworfen'
}

/**
 * What a consumer needs to retract what it already carried: the same id it
 * fetched the article under, and when the newsroom took it back.
 *
 * `status` says which of the two ways it went — back to the desk (`entwurf`,
 * a revision is likely) or dropped (`verworfen`) — because they mean different
 * things to somebody who published it: one may come back, the other will not.
 */
export function korrektur(zeile: Korrekturzeile): ApiKorrektur {
  return {
    id: zeile.id,
    gemeinde:
      zeile.gemeinde === null ? null : gemeindeSlug(zeile.gemeinde.name),
    titel: zeile.titel,
    publiziert_am: alsUtc(zeile.publiziert_am),
    zurueckgezogen_am: alsUtc(zeile.zurueckgezogen_am),
    status: zeile.status
  }
}

/** The list envelope of R8 — same five counters for every collection. */
export function liste<T>(
  sachname: string,
  eintraege: readonly T[],
  zaehlung: { gesamt: number; versatz: number; grenze: number }
): Record<string, unknown> {
  return {
    anzahl: eintraege.length,
    gesamt: zaehlung.gesamt,
    versatz: zaehlung.versatz,
    grenze: zaehlung.grenze,
    weitere: zaehlung.versatz + eintraege.length < zaehlung.gesamt,
    [sachname]: eintraege
  }
}
