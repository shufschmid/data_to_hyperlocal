import { describe, expect, it } from 'vitest'
import {
  kandidatAlsHinweis,
  publikationAlsHinweis,
  reicheWeiter,
  sendungAlsHinweis
} from './weiterreichen'

describe('kandidatAlsHinweis', () => {
  const kandidat = {
    id: 'k-1',
    titel: 'Steiner-Schule spart',
    seite: 3,
    warum_exklusiv: 'Nur hier recherchiert.',
    gemeinde: 'g-1',
    ausgabe: {
      id: 'a-1',
      seiten_texte: ['Front', 'Zwei', 'Wortlaut Seite drei']
    }
  }

  it('baut die Faehrte wie bisher und haengt den Kandidaten als Herkunft an', () => {
    const felder = kandidatAlsHinweis(kandidat, null)

    expect(felder).toEqual({
      ausgabe: 'a-1',
      gemeinde: 'g-1',
      titel: 'Steiner-Schule spart',
      fundort: 'Beitrag "Steiner-Schule spart", S. 3',
      seite: 3,
      begruendung: 'Nur hier recherchiert.',
      quelltext: 'Wortlaut Seite drei',
      status: 'offen',
      kandidat: 'k-1'
    })
  })

  it('zieht die Begruendung des Editors dem Modell vor und kommt ohne Seite aus', () => {
    const felder = kandidatAlsHinweis(
      { ...kandidat, seite: null },
      'Zahlen zuerst verifizieren'
    )
    expect(felder.begruendung).toBe('Zahlen zuerst verifizieren')
    expect(felder.fundort).toBe('Beitrag "Steiner-Schule spart"')
    expect(felder.quelltext).toBeNull()
  })
})

describe('publikationAlsHinweis', () => {
  it('nimmt die Fakten in den Quelltext und haengt die Publikation als Herkunft an', () => {
    const felder = publikationAlsHinweis(
      {
        id: 'p-1',
        titel: 'Deponie Erweiterung',
        publikations_id: 'BL01-0000123',
        rubrik_name: 'Planauflage',
        amt: 'Bauverwaltung',
        frist: '2026-09-30',
        angaben: [{ bezeichnung: 'Parzelle', wert: '1234' }],
        planbefunde: ['Blatt 2: neue Zufahrt'],
        pdf_url: 'https://amtsblattportal.ch/x.pdf',
        vorschlag_begruendung: 'Wirkt ueber die Parzelle hinaus.',
        gemeinde: { id: 'g-1' }
      },
      null
    )

    expect(felder.fundort).toBe(
      'Amtliche Publikation BL01-0000123 (Planauflage)'
    )
    expect(felder.begruendung).toBe('Wirkt ueber die Parzelle hinaus.')
    expect(felder.quelltext).toBe(
      [
        'Deponie Erweiterung',
        'Publiziert von: Bauverwaltung',
        'Frist: 2026-09-30',
        'Parzelle: 1234',
        'Aus den Plaenen: Blatt 2: neue Zufahrt',
        'https://amtsblattportal.ch/x.pdf'
      ].join('\n')
    )
    expect(felder.amtsblattmeldung).toBe('p-1')
    expect(felder.ausgabe).toBeUndefined()
  })
})

describe('sendungAlsHinweis', () => {
  it('nennt die Sendung im Fundort und haengt den Kandidaten als Herkunft an', () => {
    const felder = sendungAlsHinweis(
      {
        id: 's-1',
        titel: 'Tramumbau Muttenz',
        quelle: 'regionaljournal',
        begruendung: 'Betrifft den Bahnhofplatz.',
        zusammenfassung: 'Die BLT baut um.',
        gemeinde: { id: 'g-2' },
        datum: '31. August 2026'
      },
      'Kosten nachfragen'
    )

    expect(felder.fundort).toBe(
      'Regionaljournal Basel Baselland vom 31. August 2026'
    )
    expect(felder.begruendung).toBe('Kosten nachfragen')
    expect(felder.quelltext).toBe('Die BLT baut um.')
    expect(felder.sendungskandidat).toBe('s-1')
  })
})

describe('reicheWeiter', () => {
  it('legt zuerst die Faehrte an und markiert dann den Ursprung', async () => {
    const reihenfolge: string[] = []
    const hinweise = {
      createOne: async (payload: Record<string, unknown>) => {
        reihenfolge.push(`create:${String(payload['automatisch'])}`)
        return 'h-1'
      }
    }
    const ursprung = {
      updateOne: async (key: string, payload: Record<string, unknown>) => {
        reihenfolge.push(`update:${key}:${String(payload['entscheid'])}`)
        return key
      }
    }

    const id = await reicheWeiter(
      { hinweise, ursprung },
      {
        ursprungId: 'k-1',
        felder: kandidatAlsHinweis(
          {
            id: 'k-1',
            titel: 'T',
            seite: null,
            warum_exklusiv: null,
            gemeinde: null,
            ausgabe: { id: 'a-1', seiten_texte: null }
          },
          null
        )
      }
    )

    expect(id).toBe('h-1')
    expect(reihenfolge).toEqual(['create:false', 'update:k-1:weitergereicht'])
  })

  it('traegt bei einer automatischen Weitergabe die Regel mit', async () => {
    let gespeichert: Record<string, unknown> | null = null
    const hinweise = {
      createOne: async (payload: Record<string, unknown>) => {
        gespeichert = payload
        return 'h-2'
      }
    }
    const ursprung = { updateOne: async () => undefined }

    await reicheWeiter(
      { hinweise, ursprung },
      {
        ursprungId: 'p-1',
        felder: {
          gemeinde: 'g-1',
          titel: 'T',
          fundort: 'F',
          begruendung: null,
          quelltext: null,
          status: 'offen',
          amtsblattmeldung: 'p-1'
        },
        automatisch: true,
        regel: 'r-1'
      }
    )

    expect(gespeichert).toMatchObject({ automatisch: true, regel: 'r-1' })
  })
})
