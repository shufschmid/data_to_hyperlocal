// The pure half of the events routes: which fields a row is read with, how it
// becomes the facts an article is written from, and what the Dauerangebot
// switch accepts. The wiring is in `index.ts`.

import type { Anker, Zugang } from '../../types/schema'
import type { AnlassFakten } from '../../redaktion/veranstaltung'

export interface AnlassRohzeile {
  id: string
  titel: string
  termine: string[] | null
  von: string
  bis: string | null
  zeit: string | null
  lokalitaet: string | null
  adresse: string | null
  ort: string | null
  veranstalter: string | null
  kategorie: string | null
  preis: string | null
  anmeldung: string | null
  frist_am: string | null
  beschreibung: string | null
  text_abgeschnitten: boolean
  dokumente: Array<{
    bezeichnung: string
    url: string
    typ: 'pdf' | 'link'
    gelesen: boolean
    text?: string | null
    grund?: string
  }> | null
  traktanden: string[] | null
  traktanden_url: string | null
  anker: Anker | null
  zugang: Zugang
  url: string
  url_kanonisch: string | null
  /** Die im HTML erkannte Vorlage — sie sagt, welcher Detailparser gilt. */
  plattform: string | null
  entscheid: string
  vorschlag_begruendung: string | null
  dauerangebot: string | null
  gemeinde: { id: string; name: string }
  quelle: { id: string; name: string; url: string }
}

export const ANLASS_FELDER = [
  'id',
  'titel',
  'termine',
  'von',
  'bis',
  'zeit',
  'lokalitaet',
  'adresse',
  'ort',
  'veranstalter',
  'kategorie',
  'preis',
  'anmeldung',
  'frist_am',
  'beschreibung',
  'text_abgeschnitten',
  'dokumente',
  'traktanden',
  'traktanden_url',
  'anker',
  'zugang',
  'url',
  'url_kanonisch',
  'plattform',
  'entscheid',
  'vorschlag_begruendung',
  'dauerangebot',
  'gemeinde.id',
  'gemeinde.name',
  'quelle.id',
  'quelle.name',
  'quelle.url'
]

/**
 * Ob aus dieser Zeile ueberhaupt ein Artikel werden kann.
 *
 * Ein Anlass ohne Beschreibung, ohne gelesenes Dokument und ohne Traktanden
 * traegt nichts, woraus sich schreiben liesse. Bevor das eine Absage wird,
 * liest der Endpunkt die Detailseite nach — ein Dauerangebot kann vorgelegt
 * worden sein, bevor der Lauf je dazu kam.
 */
export function hatAnlassMaterial(fakten: AnlassFakten): boolean {
  if (fakten.beschreibung.trim() !== '') return true
  if (fakten.traktanden.length > 0) return true
  return fakten.dokumente.some((d) => d.gelesen && (d.text ?? '').trim() !== '')
}

/** The row as the writer sees it. `heute` is the day the article is written — the Stand line names it. */
export function anlassFakten(
  zeile: AnlassRohzeile,
  heute: string
): AnlassFakten {
  return {
    gemeinde: zeile.gemeinde.name,
    quelleName: zeile.quelle.name,
    titel: zeile.titel,
    termine: zeile.termine ?? [zeile.von],
    von: zeile.von,
    bis: zeile.bis,
    zeit: zeile.zeit,
    lokalitaet: zeile.lokalitaet,
    adresse: zeile.adresse,
    ort: zeile.ort,
    veranstalter: zeile.veranstalter,
    kategorie: zeile.kategorie,
    preis: zeile.preis,
    anmeldung: zeile.anmeldung,
    fristAm: zeile.frist_am,
    beschreibung: zeile.beschreibung ?? '',
    textAbgeschnitten: zeile.text_abgeschnitten,
    dokumente: (zeile.dokumente ?? []).map((d) => ({
      bezeichnung: d.bezeichnung,
      url: d.url,
      typ: d.typ,
      gelesen: d.gelesen,
      text: d.text ?? null,
      grund: d.grund ?? null
    })),
    traktanden: zeile.traktanden ?? [],
    traktandenUrl: zeile.traktanden_url,
    anker: zeile.anker ?? 'einmalig',
    zugang: zeile.zugang,
    dauerangebot: zeile.anker === 'dauerangebot',
    url: zeile.url_kanonisch ?? zeile.url,
    heute
  }
}

export type DauerangebotModus = 'nie' | 'intervall' | 'jetzt'

/** The three positions of the switch on a routine row; anything else is refused. */
export function pruefeDauerangebotModus(
  koerper: unknown
): DauerangebotModus | null {
  const modus = (koerper as { modus?: unknown } | null)?.modus
  return modus === 'nie' || modus === 'intervall' || modus === 'jetzt'
    ? modus
    : null
}

/** What "jetzt vorschlagen" writes: a proposal without a model call, dated today. */
export function dauerangebotJetzt(heute: string): Record<string, unknown> {
  return {
    anker: 'dauerangebot',
    anker_am: heute,
    anker_grund: 'Von der Redaktion als Dauerangebot vorgelegt.',
    vorschlag: true,
    vorschlag_begruendung: 'Von der Redaktion als Dauerangebot vorgelegt.',
    zuletzt_vorgelegt_am: heute,
    entscheid: 'offen'
  }
}
