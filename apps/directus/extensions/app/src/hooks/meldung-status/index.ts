import { createError } from '@directus/errors'
import { defineHook } from '@directus/extensions-sdk'
import { gelernteZahlen } from '../../redaktion/spielbericht'
import {
  inhaltGeaendert,
  pruefeUebergang,
  ruecksetzungNachAenderung,
  stempel,
  type MeldungZustand
} from '../../redaktion/status'
import type { MeldungStatus } from '../../types/schema'

// Enforces the editorial state machine on every write path.
//
// A hook and not endpoint logic, because the endpoints are not the only door.
// Sämi is an administrator: he can open a message in the Directus admin UI and
// set `status` to `publiziert` by hand. A rule checked only where we happen to
// call it is not a rule — it is a convention, and this one is load-bearing:
// it is what stands between "sent out for checking" and "published without
// anyone approving it".
//
// `filter` rather than `action`: this is the last point at which the write can
// still be refused or amended.

const UebergangError = createError<{ grund: string }>(
  'MELDUNG_STATUS',
  ({ grund }) => grund,
  422
)

interface MeldungenService {
  readMany(keys: string[], query?: Record<string, unknown>): Promise<unknown[]>
  updateOne(
    key: string,
    payload: Record<string, unknown>
  ): Promise<string | number>
}

export default defineHook(({ filter, action }, { services, logger }) => {
  const ItemsService = services.ItemsService as new (
    collection: string,
    options: unknown
  ) => MeldungenService

  filter('meldungen.items.update', async (payload, meta, context) => {
    const daten = payload as Record<string, unknown>
    const keys = (meta['keys'] as string[] | undefined) ?? []
    if (keys.length === 0) return payload

    const meldungen = new ItemsService('meldungen', {
      schema: context.schema,
      // Deliberately without accountability: this validates an invariant and
      // must see the real current state, not the caller's filtered view.
      knex: context.database
    })

    const aktuelle = (await meldungen.readMany(keys, {
      fields: [
        'id',
        'status',
        'titel',
        'lead',
        'text',
        'entscheidung',
        'freigegeben_am',
        'kandidat',
        'spiel'
      ]
    })) as (MeldungZustand & { id: string; kandidat: string | null })[]

    let ergebnis = daten

    // The Perle verdict lives on the CANDIDATE — the Chefredaktion may decide
    // it before any Meldung exists. A published Meldung carries a copy for
    // downstream readers, stamped here so the admin UI path mirrors too.
    // Batch updates are left alone: one shared payload cannot carry per-item
    // verdicts, and publishing is a per-item act everywhere in this app.
    if (
      ergebnis['status'] === 'publiziert' &&
      ergebnis['perle'] === undefined &&
      aktuelle.length === 1 &&
      aktuelle[0] !== undefined &&
      aktuelle[0].kandidat !== null
    ) {
      const kandidaten = new ItemsService('wochenblattkandidaten', {
        schema: context.schema,
        knex: context.database
      })
      const [kandidat] = (await kandidaten.readMany([aktuelle[0].kandidat], {
        fields: ['perle']
      })) as { perle: boolean | null }[]
      if (kandidat !== undefined && kandidat.perle !== null) {
        ergebnis = { ...ergebnis, perle: kandidat.perle }
      }
    }

    for (const aktuell of aktuelle) {
      // A Perle is carried only by a PUBLISHED press review — nothing else.
      // The rule lives here because an administrator can set the flag in the
      // admin UI, which no endpoint sees.
      if (ergebnis['perle'] === true) {
        const zielStatus =
          typeof ergebnis['status'] === 'string'
            ? ergebnis['status']
            : aktuell.status
        if (aktuell.kandidat === null) {
          throw new UebergangError({
            grund: 'Nur Presseschau-Meldungen koennen Perlen sein.'
          })
        }
        if (zielStatus !== 'publiziert') {
          throw new UebergangError({
            grund:
              'Eine Perle traegt nur eine publizierte Meldung — den Entscheid faellt die Chefredaktion am Kandidaten.'
          })
        }
      }
      // An edit to the text invalidates an approval that was given for the
      // old text. Checked before the transition, so the reset is part of the
      // same write rather than a second one that could fail on its own.
      if (inhaltGeaendert(aktuell, daten)) {
        const zuruecksetzen = ruecksetzungNachAenderung(aktuell)
        if (zuruecksetzen !== null) {
          ergebnis = { ...zuruecksetzen, ...ergebnis }
          // The caller did not ask for a status change, so the reset decides.
          if (!('status' in daten)) {
            ergebnis = { ...ergebnis, status: zuruecksetzen['status'] }
          }
        }
      }

      const gewuenscht = ergebnis['status']
      if (typeof gewuenscht !== 'string') continue

      const pruefung = pruefeUebergang(aktuell, gewuenscht as MeldungStatus)
      if (!pruefung.erlaubt) {
        throw new UebergangError({
          grund: pruefung.grund ?? 'Der Statuswechsel ist nicht zulaessig.'
        })
      }
    }

    // Stamp the moments the state machine relies on, so they can never be
    // missing when a later transition checks for them.
    const jetzt = new Date().toISOString()
    if (
      ergebnis['status'] === 'publiziert' &&
      ergebnis['publiziert_am'] === undefined
    ) {
      ergebnis = { ...ergebnis, publiziert_am: jetzt }
    }
    // Who signed, and when a publication was taken back. The signature is a
    // property of the write itself; the retraction mark depends on where a row
    // is coming FROM, so a batch update stamps it as soon as one of its rows
    // was published — which is what a retraction is, whatever else the batch
    // touched. An explicit value in the payload always wins over both.
    const akteur = { user: context.accountability?.user ?? null, jetzt }
    for (const aktuell of aktuelle) {
      ergebnis = { ...stempel(ergebnis, aktuell, akteur), ...ergebnis }
    }
    // Approving directly is a real path since the waste-collection reminders:
    // they are approved weeks ahead and published by the scheduled run, which
    // refuses to publish an approval with no timestamp behind it. Until then
    // only the counter-check answer set this, so the gap was unreachable.
    if (
      ergebnis['status'] === 'freigegeben' &&
      ergebnis['freigegeben_am'] === undefined
    ) {
      ergebnis = { ...ergebnis, freigegeben_am: new Date().toISOString() }
    }

    return ergebnis
  })

  // Learning, after the fact: a match report PUBLISHED with a number warning
  // still on it is the editor's verdict that the number is fine — the year in
  // the club's name is the measured case. The verdict lands on the club
  // (`vereine.akzeptierte_zahlen`), and the next report is not flagged for the
  // same thing. Only number warnings learn; a relative time reference is wrong
  // afresh every time.
  //
  // An `action`, not part of the filter above, on purpose: it runs after the
  // write went through, and remembering a lesson must never be able to block
  // or fail the publish itself.
  action('meldungen.items.update', async (meta, context) => {
    const daten = meta['payload'] as Record<string, unknown>
    if (daten['status'] !== 'publiziert') return
    const keys = (meta['keys'] as string[] | undefined) ?? []
    if (keys.length === 0) return

    try {
      const optionen = { schema: context.schema, knex: context.database }
      const meldungen = new ItemsService('meldungen', optionen)
      const zeilen = (await meldungen.readMany(keys, {
        fields: ['spiel', 'zeit_warnungen']
      })) as Array<{ spiel: string | null; zeit_warnungen: string[] | null }>

      for (const zeile of zeilen) {
        if (zeile.spiel === null) continue
        const zahlen = gelernteZahlen(zeile.zeit_warnungen)
        if (zahlen.length === 0) continue

        const spiele = new ItemsService('spiele', optionen)
        const [spiel] = (await spiele.readMany([zeile.spiel], {
          fields: ['verein']
        })) as Array<{ verein: string | null }>
        if (spiel === undefined || spiel.verein === null) continue

        const vereine = new ItemsService('vereine', optionen)
        const [verein] = (await vereine.readMany([spiel.verein], {
          fields: ['akzeptierte_zahlen']
        })) as Array<{ akzeptierte_zahlen: string[] | null }>
        const bisher = Array.isArray(verein?.akzeptierte_zahlen)
          ? verein.akzeptierte_zahlen
          : []

        const zusammen = [...new Set([...bisher, ...zahlen])]
        if (zusammen.length === bisher.length) continue
        await vereine.updateOne(spiel.verein, {
          akzeptierte_zahlen: zusammen
        })
      }
    } catch (fehler) {
      // A lost lesson costs one repeated warning — never the publish.
      logger.warn(fehler, 'meldung-status: Zahlen nicht gelernt.')
    }
  })
})
