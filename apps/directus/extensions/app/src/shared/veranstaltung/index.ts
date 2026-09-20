// Reading ONE Anlass: its detail page, its documents, and — for a Gremium —
// the agenda, which sits on the same page (i-web) or one link away
// (Backslash). Everything goes through the same polite reader as the
// overview; the pure parsing lives next door.

import type { DetailFamilie } from '../gemeindeseite/erkennung'
import { type Heute } from '../gemeindeseite/datum'
import type { Transport } from '../crawler/fallback'
import {
  liesAnhaenge,
  type Anhang,
  type Leser,
  type PdfText
} from '../gemeindeseite'
import { gleicheSite, normalisiereUrl } from '../gemeindeseite/url'
import {
  parseAnlassDetail,
  parseTraktanden,
  type AnlassDetail,
  type Traktanden
} from './detail'

export * from './anker'
export * from './anlass'
export * from './detail'
export * from './rhythmus'
export * from './schluessel'

export interface GeleseneAnlass {
  detail: AnlassDetail
  anhaenge: Anhang[]
  /** The agenda, with the page it came from; null when the page carried none and linked none. */
  traktanden: (Traktanden & { url: string }) | null
  transport: Transport
  /** How many pages this read cost — the budget counts a Gremium's agenda page too. */
  anfragen: number
}

/**
 * Opens the page of an Anlass. A Gremium's agenda is looked for on the page
 * itself first; where the page only links a sessions page on the same site,
 * that page is read too and the day picks its section. A foreign site is
 * never followed (Constraint 4).
 */
export async function liesAnlass(
  leser: Leser,
  anlass: { url: string; termin: string | null },
  familie: DetailFamilie,
  siteVon: string,
  heute: Heute,
  optionen: {
    gremium: boolean
    anhaengeMax?: number
    anhangMaxBytes?: number
    pdfText?: PdfText
  }
): Promise<GeleseneAnlass> {
  const seite = await leser.liesSeite(
    anlass.url,
    siteVon,
    optionen.anhangMaxBytes
  )
  if (seite.art === 'pdf') {
    throw new Error('Die Seite des Anlasses ist ein Dokument, keine Seite.')
  }
  let anfragen = 1
  const detail = parseAnlassDetail(seite.html, familie, seite.url, heute)
  const gelandet = normalisiereUrl(seite.url, seite.url)
  if (detail.kanonisch === null && gelandet !== null && gelandet !== anlass.url)
    detail.kanonisch = gelandet

  const anhaenge = await liesAnhaenge(leser, detail.dokumente, siteVon, {
    anhaengeMax: optionen.anhaengeMax,
    anhangMaxBytes: optionen.anhangMaxBytes,
    pdfText: optionen.pdfText
  })

  let traktanden: GeleseneAnlass['traktanden'] = null
  if (optionen.gremium) {
    const eigene = parseTraktanden(seite.html, anlass.termin)
    if (eigene.liste.length > 0) {
      traktanden = { ...eigene, url: detail.kanonisch ?? seite.url }
    } else if (
      detail.traktandenLink !== null &&
      gleicheSite(detail.traktandenLink, siteVon)
    ) {
      const sitzung = await leser.liesSeite(detail.traktandenLink, siteVon)
      anfragen += 1
      if (sitzung.art === 'html') {
        const gelesen = parseTraktanden(sitzung.html, anlass.termin)
        if (gelesen.liste.length > 0)
          traktanden = { ...gelesen, url: detail.traktandenLink }
      }
    }
  }

  return { detail, anhaenge, traktanden, transport: seite.transport, anfragen }
}
