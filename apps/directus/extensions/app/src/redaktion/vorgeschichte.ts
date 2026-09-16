/**
 * The Vorgeschichte of a gazette row: what the Zettelkasten already holds about
 * the same address or the same company.
 *
 * This module is the wiring between `suchbegriffFuer` (the rule, in
 * ./amtsblatt) and `sucheVorgeschichte` (the door, in shared/zettelkasten). It
 * writes two fields on the row and nothing else.
 *
 * Everything here fails soft. A Vorgeschichte is context an editor is glad to
 * have and never something an article depends on: a door that is off, slow,
 * unreachable or refusing a token must cost the run nothing. What it must not
 * do is look like an answer — so "we did not ask" (`suche: null`), "nobody
 * connected it" (`nicht_konfiguriert`) and "it went wrong" (`fehler`) are three
 * different states on the row, and the desk shows each of them.
 *
 * The Vorgeschichte never reaches a model. It is not in any prompt, by
 * decision: a model that reads eight years of gazette entries about an address
 * writes about them, and then the newsroom has published a dossier nobody
 * checked.
 */

import {
  sucheVorgeschichte,
  type VorgeschichteErgebnis,
  type ZettelkastenKonfiguration
} from '../shared/zettelkasten'
import { suchbegriffFuer } from './amtsblatt'
import type { Vorgeschichte } from '../types/schema'

/** How far back a Vorgeschichte looks. */
const JAHRE = 5

export interface VorgeschichteRohzeile {
  id: string
  angaben: { bezeichnung: string; wert: string }[] | null
  personen: string[] | null
  gemeinde: { bfs_nummer: number | null } | null
}

export interface ErgaenzungsOptionen {
  meldungen: { updateOne(id: string, daten: unknown): Promise<unknown> }
  logger: { warn(...args: unknown[]): void }
  kontakt: string
  konfiguration: ZettelkastenKonfiguration
  /** Injected in tests; the real one is the door. */
  sucher?: typeof sucheVorgeschichte
  jetzt?: () => Date
}

/** The same day, five years earlier, as an ISO date. */
export function fuenfJahreZurueck(jetzt: Date): string {
  const von = new Date(jetzt)
  von.setUTCFullYear(von.getUTCFullYear() - JAHRE)
  return von.toISOString().slice(0, 10)
}

function leer(
  status: Vorgeschichte['status'],
  suche: string | null
): Vorgeschichte {
  return {
    status,
    suche,
    treffer: [],
    gesamt: 0,
    abgeschnitten: false,
    vorbehalt: ''
  }
}

/**
 * Fetch the Vorgeschichte for one row and write it there.
 *
 * Never throws. The caller — a run over twenty rows, or one editor pressing a
 * button — gets on with its work either way.
 */
export async function ergaenzeVorgeschichte(
  zeile: VorgeschichteRohzeile,
  optionen: ErgaenzungsOptionen
): Promise<void> {
  const jetzt = (optionen.jetzt ?? (() => new Date()))()
  const suche = suchbegriffFuer({
    angaben: zeile.angaben,
    personen: zeile.personen
  })

  let vorgeschichte: Vorgeschichte
  if (suche === null) {
    // Nothing to ask: no address, no parcel, no company. The common case for a
    // private building application, and the right one.
    vorgeschichte = leer('ok', null)
  } else {
    try {
      const sucher = optionen.sucher ?? sucheVorgeschichte
      const ergebnis: VorgeschichteErgebnis = await sucher(
        {
          suche,
          von: fuenfJahreZurueck(jetzt),
          ...(zeile.gemeinde?.bfs_nummer != null
            ? { gemeindeBfs: zeile.gemeinde.bfs_nummer }
            : {})
        },
        { ...optionen.konfiguration, kontakt: optionen.kontakt }
      )
      vorgeschichte =
        ergebnis.status === 'nicht_konfiguriert'
          ? leer('nicht_konfiguriert', suche)
          : {
              status: 'ok',
              suche,
              // Only what the desk shows. The excerpt and the raw-store
              // reference stay in the Zettelkasten: this field is a pointer to
              // its rows, not a second copy of them.
              treffer: ergebnis.treffer.map((t) => ({
                publikationsnummer: t.publikationsnummer,
                datum: t.datum,
                rubrik: t.rubrik,
                titel: t.titel,
                adresse: t.adresse
              })),
              gesamt: ergebnis.gesamt,
              abgeschnitten: ergebnis.abgeschnitten,
              vorbehalt: ergebnis.vorbehalt
            }
    } catch (fehler) {
      optionen.logger.warn(fehler, 'redaktion: Vorgeschichte nicht geholt')
      vorgeschichte = leer('fehler', suche)
    }
  }

  try {
    await optionen.meldungen.updateOne(zeile.id, {
      vorgeschichte,
      vorgeschichte_stand: jetzt.toISOString()
    })
  } catch (fehler) {
    optionen.logger.warn(fehler, 'redaktion: Vorgeschichte nicht notiert')
  }
}
