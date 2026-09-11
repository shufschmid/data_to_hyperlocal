import { describe, expect, it } from 'vitest'
import {
  parseAbfrage,
  pruefeZugang,
  sokratesSendung,
  type SokratesEditionZeile
} from './sokrates'

describe('pruefeZugang', () => {
  it('meldet eine unkonfigurierte Schnittstelle vor allem anderen', () => {
    // Auch ein "richtiger" leerer Schluessel oeffnet nichts: leer heisst aus.
    expect(pruefeZugang('', '')).toBe('nicht_konfiguriert')
    expect(pruefeZugang(undefined, '')).toBe('nicht_konfiguriert')
  })

  it('laesst den richtigen Schluessel durch', () => {
    expect(pruefeZugang('geheim-123', 'geheim-123')).toBe('ok')
    // Ein Client, der Whitespace anschleppt, scheitert nicht daran.
    expect(pruefeZugang(' geheim-123 ', 'geheim-123')).toBe('ok')
  })

  it('verweigert falsche und fehlende Schluessel', () => {
    expect(pruefeZugang('falsch', 'geheim-123')).toBe('verweigert')
    expect(pruefeZugang(undefined, 'geheim-123')).toBe('verweigert')
    expect(pruefeZugang('', 'geheim-123')).toBe('verweigert')
    // Express liefert bei wiederholter Kopfzeile ein Array — kein String,
    // keine Pruefung, kein Zugang.
    expect(pruefeZugang(['geheim-123'], 'geheim-123')).toBe('verweigert')
    expect(pruefeZugang(42, 'geheim-123')).toBe('verweigert')
  })
})

describe('parseAbfrage', () => {
  it('liefert die Voreinstellung ohne Parameter', () => {
    expect(parseAbfrage({})).toEqual({ ab: null, limit: 3 })
  })

  it('nimmt ein gueltiges Datum und ein gueltiges Limit', () => {
    expect(parseAbfrage({ ab: '2026-09-11', limit: '5' })).toEqual({
      ab: '2026-09-11',
      limit: 5
    })
  })

  it('weist ein kaputtes Datum zurueck', () => {
    expect(parseAbfrage({ ab: '11.09.2026' })).toHaveProperty('fehler')
    expect(parseAbfrage({ ab: ['2026-09-11'] })).toHaveProperty('fehler')
  })

  it('weist ein Limit ausserhalb der Schranken zurueck', () => {
    expect(parseAbfrage({ limit: '0' })).toHaveProperty('fehler')
    expect(parseAbfrage({ limit: '11' })).toHaveProperty('fehler')
    expect(parseAbfrage({ limit: 'viele' })).toHaveProperty('fehler')
  })
})

const EDITION: SokratesEditionZeile = {
  id: 'ed-1',
  broadcast_date: '2026-09-11',
  edition_label: 'Mittag',
  headline: 'Regionaljournal Basel',
  lead: 'Die Themen vom Mittag.',
  audio_url: 'https://example.org/audio.mp3',
  date_created: '2026-09-11T14:36:02Z',
  transcript: [
    { timestamp: '00:00', seconds: 0, text: 'Begruessung und Ueberblick.' },
    {
      timestamp: '01:00',
      seconds: 60,
      text: 'Hauptbeitrag ueber die Steuern.'
    },
    {
      timestamp: '05:00',
      seconds: 300,
      text: 'Kunst in Bottmingen, ausfuehrlich.'
    }
  ],
  extra_topics: [
    {
      headline: 'Kunst in Bottmingen',
      paragraphTimestamp: '05:00',
      paragraphSeconds: 300,
      summary: 'Temporaere Kunst im Dorfkern.'
    },
    {
      headline: 'Thema ohne Passage',
      paragraphTimestamp: null,
      paragraphSeconds: null,
      summary: 'Nur die Kurzfassung der Sendung.'
    }
  ]
}

describe('sokratesSendung', () => {
  it('liefert die Abschnitte der Sichtung und das ganze Transkript', () => {
    const sendung = sokratesSendung(EDITION)

    expect(sendung.datum).toBe('2026-09-11')
    expect(sendung.ausgabe).toBe('Mittag')
    expect(sendung.eingetroffen).toBe('2026-09-11T14:36:02Z')

    // Hauptbeitrag (alles vor der ersten Themen-Grenze) + zwei Themen.
    expect(sendung.abschnitte).toHaveLength(3)
    expect(sendung.abschnitte[0]?.titel).toBe('Regionaljournal Basel')
    expect(sendung.abschnitte[0]?.text).toContain(
      'Hauptbeitrag ueber die Steuern'
    )
    expect(sendung.abschnitte[0]?.text).not.toContain(
      'Kunst in Bottmingen, ausfuehrlich'
    )

    const kunst = sendung.abschnitte[1]
    expect(kunst?.zeitmarke_sekunden).toBe(300)
    expect(kunst?.text).toContain('Kunst in Bottmingen, ausfuehrlich.')
    expect(kunst?.nur_zusammenfassung).toBe(false)

    // Ein Thema ohne auffindbare Passage traegt das ehrliche Etikett.
    const ohne = sendung.abschnitte[2]
    expect(ohne?.nur_zusammenfassung).toBe(true)
    expect(ohne?.text).toContain('Nur die Kurzfassung der Sendung.')

    // Das ganze Skript, Absatz fuer Absatz, mit Zeitmarken.
    expect(sendung.transkript).toHaveLength(3)
    expect(sendung.transkript[2]).toEqual({
      zeitmarke: '05:00',
      sekunden: 300,
      text: 'Kunst in Bottmingen, ausfuehrlich.'
    })
  })

  it('vertraegt eine Sendung ohne Transkript und ohne Themen', () => {
    const sendung = sokratesSendung({
      ...EDITION,
      transcript: null,
      extra_topics: null,
      lead: null
    })

    expect(sendung.transkript).toEqual([])
    expect(sendung.abschnitte).toHaveLength(1)
    expect(sendung.abschnitte[0]?.titel).toBe('Regionaljournal Basel')
  })
})
