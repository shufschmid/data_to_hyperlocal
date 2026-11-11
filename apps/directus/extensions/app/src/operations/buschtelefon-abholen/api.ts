import { defineOperationApi } from '@directus/extensions-sdk'
import { reicheFundWeiter } from '../../endpoints/redaktion/buschtelefon'
import {
  abholungLaeuft,
  holeAbEinzeln,
  laeuftSchonErgebnis,
  type AbholDienste,
  type AbholErgebnis
} from '../../redaktion/buschtelefonlauf'
import { ladeRegeln } from '../../redaktion/gedaechtnis'
import {
  regelnBlock,
  SICHTUNGSREGELN_UEBERSCHRIFT
} from '../../redaktion/lernen'
import { ladeBuschtelefonSignale } from '../../redaktion/lernsignale'
import {
  STANDARD_EINSTELLUNG,
  tischeinstellungAus
} from '../../redaktion/tischeinstellungen'

// The 12:00 fetch from the Buschtelefon (13:00 and 14:00 are free retries:
// the door answers the same between two releases, and the bookmark makes a
// second read cost nothing).
//
// Thin on purpose: it builds the services and calls `holeAbEinzeln`
// (`redaktion/buschtelefonlauf.ts`), where every rule lives and is tested —
// one run at a time, process-wide, whether the Flow or the desk's button
// started it. A call that finds a run under way returns at once with
// `status: 'laeuft'`, before it reads a setting or a rule.
//
// The services are system-level — an `ItemsService` WITHOUT accountability.
// Two reasons, both deliberate: a scheduled run has no user whose
// permissions could apply, and the three Buschtelefon collections carry no
// permission rows and no revisions (`accountability: null` in the snapshot),
// because their rows are statements of private persons and a copy of them in
// `directus_revisions` would outlive the retention this run enforces.

interface Optionen {
  /** Finds per page of the door. */
  limit?: number
  /** Drafts per run. */
  entwuerfe?: number
  model?: string | null
}

export default defineOperationApi<Optionen>({
  id: 'buschtelefon-abholen',
  handler: async (
    optionen,
    { services, getSchema, logger }
  ): Promise<AbholErgebnis> => {
    if (abholungLaeuft()) return laeuftSchonErgebnis()
    const { ItemsService } = services
    const schema = await getSchema()

    // System-level on purpose — see the header.
    const funde = new ItemsService('buschtelefon_funde', { schema })
    const quellen = new ItemsService('buschtelefon_quellen', { schema })
    const stand = new ItemsService('buschtelefon_stand', { schema })
    const meldungen = new ItemsService('meldungen', { schema })
    const hinweise = new ItemsService('recherchehinweise', { schema })
    const gemeinden = new ItemsService('gemeinden', { schema })
    const wissen = new ItemsService('redaktionswissen', { schema })
    const tische = new ItemsService('tischeinstellungen', { schema })
    const warnung = { warn: (m: string) => logger.warn(m) }

    // The threshold is the newsroom's dial; a missing row is the standard.
    let schwelle: number = STANDARD_EINSTELLUNG.schwelle
    try {
      const [zeile] = (await tische.readByQuery({
        filter: { tisch: { _eq: 'buschtelefon' } },
        fields: ['schwelle'],
        limit: 1
      })) as Array<{ schwelle: number | null }>
      schwelle = tischeinstellungAus(zeile).schwelle
    } catch (fehler) {
      logger.warn(
        fehler,
        `buschtelefon: Tischeinstellung nicht lesbar — Standard (Schwelle ${schwelle}).`
      )
    }

    const regelzeilen = await ladeRegeln(
      wissen,
      { bereich: 'buschtelefon', stufe: 'sichtung' },
      warnung
    )
    const textregeln = (
      await ladeRegeln(
        wissen,
        { bereich: 'buschtelefon', stufe: 'text' },
        warnung
      )
    ).map((r) => r.regel)

    const dienste: AbholDienste = {
      funde: funde as never,
      quellen: quellen as never,
      stand: {
        lies: async () =>
          ((await stand.readSingleton({
            fields: ['folge', 'freigabe']
          })) ?? null) as never,
        schreibe: (payload) => stand.upsertSingleton(payload)
      },
      meldungen: meldungen as never,
      hinweise: hinweise as never,
      gemeinden: gemeinden as never,
      schwelle,
      regelzeilen,
      sichtungsregeln: regelnBlock(regelzeilen, SICHTUNGSREGELN_UEBERSCHRIFT),
      textregeln,
      // The desk's own decisions per municipality, as examples for its
      // Sichtung (`redaktion/lernsignale.ts`).
      ladeSignale: (gemeindeId: string, heute: string) =>
        ladeBuschtelefonSignale(
          { zeilen: funde, hinweise, meldungen },
          gemeindeId,
          heute
        ),
      // A rule the newsroom armed (`wirkung: weiterreichen`) hands a matching
      // find to the Chefredaktion by itself — the very function the desk's
      // button calls, marked `automatisch` with the rule that asked. It
      // creates a lead, never a Meldung, and «Zurück auf den Tisch» undoes it.
      reicheAutomatischWeiter: async (fundId, regel) => {
        await reicheFundWeiter(
          { funde, hinweise, meldungen },
          fundId,
          null,
          new Date().toISOString(),
          { regel: regel.id }
        )
      },
      logger: {
        info: (m: string) => logger.info(m),
        warn: (e: unknown, m?: string) => logger.warn(e, m ?? '')
      }
    }

    return holeAbEinzeln(dienste, {
      ...(typeof optionen.limit === 'number' ? { limit: optionen.limit } : {}),
      ...(typeof optionen.entwuerfe === 'number'
        ? { entwuerfe: optionen.entwuerfe }
        : {}),
      model: optionen.model ?? null
    })
  }
})
