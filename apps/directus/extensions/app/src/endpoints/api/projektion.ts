// Turning a stored article into the shape an outside reader gets — pure, and
// the reason this API is an extension rather than Directus' own `/items` door.
//
// Three things a consumer needs are NOT columns and have to be computed here:
//
//   - the municipality's KEY. `gemeinden` has a name and a BFS number, no slug;
//     the public blog slugifies in the frontend. An outside reader cannot be
//     asked to guess that «Münchenstein» is `muenchenstein`.
//   - the RUBRIK. Which of six kinds an article is shows only in which of five
//     foreign keys (or `erscheint_am`) is set.
//   - the SOURCE. Every kind stores it differently: the desks put it into
//     `datengrundlage` under different keys, statistics keep it in the dataset
//     behind the run, and sport has none at all.
//
// And one thing has to be kept OUT: `datengrundlage` itself. For a statistics
// article it holds up to sixty raw rows of the underlying dataset — the working
// material of the newsroom, not part of a published article.

import { AMT, quellenlink } from '../../redaktion/quelle'
import { seitenLink } from '../../shared/wochenblatt/parse'

export type Rubrik =
  | 'statistik'
  | 'sport'
  | 'entsorgung'
  | 'amtsblatt'
  | 'beschaffung'
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
          quelle: { typ: string | null } | string | null
          ankuendigung: { link: string | null } | string | null
        } | null
      }
    | string
    | null
  kandidat: string | null
  sendungskandidat: string | null
  amtsblattmeldung: { quelle_typ: string | null } | string | null
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
 */
export function rubrikVon(zeile: Rohzeile): Rubrik | null {
  if (zeile.lauf !== null) return 'statistik'
  if (zeile.spiel !== null) return 'sport'
  if (zeile.erscheint_am !== null) return 'entsorgung'
  if (zeile.kandidat !== null) return 'presseschau'
  if (zeile.amtsblattmeldung !== null)
    return quelleTypVon(zeile) === 'simap' ? 'beschaffung' : 'amtsblatt'
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
export function statistikUrl(lauf: Rohzeile['lauf']): string | null {
  if (lauf === null || typeof lauf === 'string') return null
  const datensatz = lauf.datensatz
  if (datensatz === null) return null

  const quelle = datensatz.quelle
  const ankuendigung = datensatz.ankuendigung
  return (
    quellenlink({
      externeId: datensatz.externe_id,
      quelleTyp:
        quelle === null || typeof quelle === 'string' ? null : quelle.typ,
      ankuendigungLink:
        ankuendigung === null || typeof ankuendigung === 'string'
          ? null
          : ankuendigung.link
    })?.url ?? null
  )
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
    case 'statistik':
      return { name: AMT, url: statistikUrl(zeile.lauf) }

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
        : null
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
