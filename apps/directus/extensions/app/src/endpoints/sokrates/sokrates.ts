import { createHash, timingSafeEqual } from 'node:crypto'
import { beitraegeAusEdition } from '../../redaktion/sendunglauf'
import type { ExtraTopic, TranscriptParagraph } from '../../types/schema'

// The rules of the Sokrates door, testable without a database.
//
// Sokrates is a program: an AI that helps the newsroom formulate the "Frage
// des Tages" and needs the day's Regionaljournal UNREVIEWED and fast. The
// Dorfkoenig API deliberately carries only published articles, so this module
// serves the broadcast itself instead — each Sendung prepared as the same
// Abschnitte the Sichtung judges (`beitraegeAusEdition`), plus the whole
// transcript.

export type Zugang = 'ok' | 'nicht_konfiguriert' | 'verweigert'

/**
 * The gate. An empty key means the door is not configured — 503, never a
 * silent yes (the same stance as `BLOG_API_OFFEN`). A configured key is
 * compared timing-safe: both sides are hashed to a fixed length first, so
 * neither content nor length leaks through the comparison time.
 *
 * The key travels in `X-Sokrates-Key`, NOT in `Authorization` — measured on
 * the running instance: Directus' own auth middleware runs before every custom
 * endpoint and rejects any Bearer token it cannot resolve as one of its own,
 * so a foreign key in that header never reaches this code (401
 * INVALID_CREDENTIALS from Directus itself).
 */
export function pruefeZugang(kopfzeile: unknown, schluessel: string): Zugang {
  if (schluessel === '') return 'nicht_konfiguriert'
  if (typeof kopfzeile !== 'string' || kopfzeile === '') return 'verweigert'
  return gleich(kopfzeile.trim(), schluessel) ? 'ok' : 'verweigert'
}

function gleich(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export interface SokratesAbfrage {
  /** Only Sendungen broadcast on or after this day, `YYYY-MM-DD`. */
  ab: string | null
  limit: number
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/

/**
 * Query parameters, validated before they reach a database. The limit's
 * ceiling is deliberate: every Sendung carries its full transcript, and ten of
 * them is already more history than a daily question needs.
 */
export function parseAbfrage(
  query: Record<string, unknown>
): SokratesAbfrage | { fehler: string } {
  let ab: string | null = null
  const abRoh = query['ab']
  if (abRoh !== undefined) {
    if (typeof abRoh !== 'string' || !DATUM.test(abRoh)) {
      return { fehler: 'ab muss ein Datum im Format JJJJ-MM-TT sein.' }
    }
    ab = abRoh
  }

  let limit = 3
  const limitRoh = query['limit']
  if (limitRoh !== undefined) {
    const zahl = Number(limitRoh)
    if (!Number.isInteger(zahl) || zahl < 1 || zahl > 10) {
      return { fehler: 'limit muss eine ganze Zahl zwischen 1 und 10 sein.' }
    }
    limit = zahl
  }

  return { ab, limit }
}

/** The columns the projection reads — nothing else leaves the collection. */
export interface SokratesEditionZeile {
  id: string
  broadcast_date: string
  edition_label: string | null
  headline: string
  lead: string | null
  audio_url: string | null
  transcript: TranscriptParagraph[] | null
  extra_topics: ExtraTopic[] | null
  date_created: string | null
}

export interface SokratesAbschnitt {
  titel: string
  text: string
  zeitmarke_sekunden: number | null
  /**
   * True when no transcript passage could be located for the topic and `text`
   * is only headline plus the show's own short summary — the same honest label
   * the Sichtung gets, so Sokrates knows what it is standing on.
   */
  nur_zusammenfassung: boolean
}

export interface SokratesSendung {
  id: string
  datum: string
  ausgabe: string | null
  titel: string
  lead: string | null
  audio_url: string | null
  /** When the transcript arrived here — Sokrates' "is this new?" anchor. */
  eingetroffen: string | null
  abschnitte: SokratesAbschnitt[]
  transkript: Array<{ zeitmarke: string; sekunden: number; text: string }>
}

/**
 * One Sendung as Sokrates reads it: the Abschnitte are exactly the slices the
 * municipality Sichtung judges — the broadcast's shape (trail, topics, recap)
 * already respected — and the transcript rides along whole, because a question
 * of the day may hang on a passage no topic claimed.
 */
export function sokratesSendung(zeile: SokratesEditionZeile): SokratesSendung {
  return {
    id: zeile.id,
    datum: zeile.broadcast_date,
    ausgabe: zeile.edition_label,
    titel: zeile.headline,
    lead: zeile.lead,
    audio_url: zeile.audio_url,
    eingetroffen: zeile.date_created,
    abschnitte: beitraegeAusEdition(zeile).map((beitrag) => ({
      titel: beitrag.titel,
      text: beitrag.text,
      zeitmarke_sekunden: beitrag.zeitmarkeSekunden,
      nur_zusammenfassung: beitrag.nurZusammenfassung ?? false
    })),
    transkript: (zeile.transcript ?? []).map((absatz) => ({
      zeitmarke: absatz.timestamp,
      sekunden: absatz.seconds,
      text: absatz.text
    }))
  }
}
