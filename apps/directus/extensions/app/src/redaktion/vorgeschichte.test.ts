import { describe, expect, it, vi } from 'vitest'
import {
  ergaenzeVorgeschichte,
  type VorgeschichteRohzeile
} from './vorgeschichte'
import { ZettelkastenFehler } from '../shared/zettelkasten'
import type { Vorgeschichte } from '../types/schema'

const JETZT = new Date('2026-09-16T10:00:00.000Z')

interface Daten {
  vorgeschichte: Vorgeschichte
  vorgeschichte_stand: string
}

function zeile(
  ueber: Partial<VorgeschichteRohzeile> = {}
): VorgeschichteRohzeile {
  return {
    id: 'meldung-1',
    angaben: [
      {
        bezeichnung: 'Parzelle Nr. / Strassenname',
        wert: '800 - Hauptstrasse 3'
      }
    ],
    personen: [],
    gemeinde: { bfs_nummer: 2770 },
    ...ueber
  }
}

function umgebung(sucher: unknown) {
  const updateOne = vi.fn().mockResolvedValue(undefined)
  const warn = vi.fn()
  return {
    optionen: {
      meldungen: { updateOne },
      logger: { warn },
      kontakt: 'redaktion@example.ch',
      konfiguration: {
        url: 'https://zettelkasten-tuer.example.ch',
        token: 'geheim',
        mandant: 'bajour'
      },
      sucher: sucher as never,
      jetzt: () => JETZT
    },
    updateOne,
    warn
  }
}

const ANTWORT = {
  status: 'ok' as const,
  treffer: [
    {
      publikationsnummer: 'BP-BL05-0000006774',
      datum: '2026-08-06',
      rubrik: 'BP-BL05',
      titel: 'Entscheid in Bausachen, Muttenz',
      adresse: 'https://amtsblattportal.ch/api/v1/publications/abc/pdf',
      gemeindeBfs: 2770
    }
  ],
  gesamt: 1,
  abgeschnitten: false,
  vorbehalt: 'Belegt ist: diese Publikation ist amtlich erschienen.'
}

describe('ergaenzeVorgeschichte', () => {
  it('fragt mit Suchbegriff, Gemeinde und den letzten fuenf Jahren', async () => {
    const sucher = vi.fn().mockResolvedValue(ANTWORT)
    const { optionen, updateOne } = umgebung(sucher)

    await ergaenzeVorgeschichte(zeile(), optionen)

    const [frage] = sucher.mock.calls[0] as [
      { suche: string; von: string; gemeindeBfs?: number }
    ]
    expect(frage.suche).toBe('"Hauptstrasse" AND "3"')
    expect(frage.gemeindeBfs).toBe(2770)
    expect(frage.von).toBe('2021-09-16')

    const [id, daten] = updateOne.mock.calls[0] as [string, Daten]
    expect(id).toBe('meldung-1')
    expect(daten.vorgeschichte.status).toBe('ok')
    expect(daten.vorgeschichte.suche).toBe('"Hauptstrasse" AND "3"')
    expect(daten.vorgeschichte.treffer).toHaveLength(1)
    expect(daten.vorgeschichte_stand).toBe(JETZT.toISOString())
  })

  it('haelt vom Treffer nur, was am Tisch steht', async () => {
    const sucher = vi.fn().mockResolvedValue(ANTWORT)
    const { optionen, updateOne } = umgebung(sucher)

    await ergaenzeVorgeschichte(zeile(), optionen)

    const [, daten] = updateOne.mock.calls[0] as [string, Daten]
    expect(Object.keys(daten.vorgeschichte.treffer[0] ?? {}).sort()).toEqual([
      'adresse',
      'datum',
      'publikationsnummer',
      'rubrik',
      'titel'
    ])
  })

  it('fragt gar nicht, wenn die Meldung keinen Suchbegriff hergibt', async () => {
    const sucher = vi.fn()
    const { optionen, updateOne } = umgebung(sucher)

    await ergaenzeVorgeschichte(
      zeile({
        angaben: [{ bezeichnung: 'Bauherrschaft', wert: 'Peter Muster' }]
      }),
      optionen
    )

    expect(sucher).not.toHaveBeenCalled()
    const [, daten] = updateOne.mock.calls[0] as [string, Daten]
    // Gefragt wurde nichts, und genau das steht da: `suche: null` mit einem
    // Stand. Leer und nie gefragt sind zwei verschiedene Antworten.
    expect(daten.vorgeschichte.suche).toBeNull()
    expect(daten.vorgeschichte.treffer).toEqual([])
    expect(daten.vorgeschichte_stand).toBe(JETZT.toISOString())
  })

  it('haelt fest, dass der Zettelkasten nicht angeschlossen ist', async () => {
    const sucher = vi.fn().mockResolvedValue({ status: 'nicht_konfiguriert' })
    const { optionen, updateOne } = umgebung(sucher)

    await ergaenzeVorgeschichte(zeile(), optionen)

    const [, daten] = updateOne.mock.calls[0] as [string, Daten]
    expect(daten.vorgeschichte.status).toBe('nicht_konfiguriert')
    expect(daten.vorgeschichte.treffer).toEqual([])
  })

  it('schluckt einen Fehler der Tuer, notiert ihn und laeuft weiter', async () => {
    const sucher = vi
      .fn()
      .mockRejectedValue(new ZettelkastenFehler('Die Kanarie ist gefallen.'))
    const { optionen, updateOne, warn } = umgebung(sucher)

    await expect(
      ergaenzeVorgeschichte(zeile(), optionen)
    ).resolves.toBeUndefined()

    const [, daten] = updateOne.mock.calls[0] as [string, Daten]
    expect(daten.vorgeschichte.status).toBe('fehler')
    expect(warn).toHaveBeenCalled()
  })

  it('laesst die Zeile in Ruhe, wenn auch das Schreiben scheitert', async () => {
    const sucher = vi.fn().mockResolvedValue(ANTWORT)
    const { optionen, warn } = umgebung(sucher)
    optionen.meldungen.updateOne = vi
      .fn()
      .mockRejectedValue(new Error('Datenbank weg'))

    // Eine Vorgeschichte ist Beigabe. Sie darf einen Lauf nie umbringen.
    await expect(
      ergaenzeVorgeschichte(zeile(), optionen)
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })
})
