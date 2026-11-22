import { eingangskorb, meldungenZu, type KorbMeldung } from './eingang'
import { istAbgelegt, type ZeitleistenEintrag } from './redaktion'

const HEUTE = '2026-11-22'

function e(id: string, ueber: Partial<ZeitleistenEintrag> = {}): ZeitleistenEintrag {
  return {
    id,
    herkunft: 'datensatz',
    datum: '2026-11-20',
    titel: id,
    hinweis: null,
    datensatzId: `d-${id}`,
    laufId: null,
    pfad: null,
    link: null,
    quartal: null,
    beschreibung: null,
    rhythmus: null,
    zeilen: null,
    quoteId: null,
    vorschlag: false,
    befunde: [],
    abstimmungId: null,
    abstimmungsgemeinden: [],
    abstimmungIds: [],
    ...ueber
  }
}

const m = (status: string, am = '2026-11-20'): KorbMeldung => ({
  status,
  publiziert_am: status === 'publiziert' ? `${am}T10:00:00Z` : null,
  date_created: `${am}T08:00:00Z`
})

const korb = (
  datiert: ZeitleistenEintrag[],
  mehr: Partial<Parameters<typeof eingangskorb>[0]> = {}
): ReturnType<typeof eingangskorb> => eingangskorb({ datiert, ohneDatum: [], heute: HEUTE, ...mehr })

const ids = (liste: ZeitleistenEintrag[]) => liste.map((x) => x.id)

describe('istAbgelegt', () => {
  it('gilt nur bis zum Datum des Eintrags — ein spaeterer Stand kommt wieder', () => {
    expect(istAbgelegt({ datum: '2026-11-20', abgelegtAm: '2026-11-21' })).toBe(true)
    expect(istAbgelegt({ datum: '2026-11-21', abgelegtAm: '2026-11-21' })).toBe(true)
    expect(istAbgelegt({ datum: '2026-11-22', abgelegtAm: '2026-11-21' })).toBe(false)
    expect(istAbgelegt({ datum: '2026-11-20', abgelegtAm: null })).toBe(false)
    expect(istAbgelegt({ datum: '2026-11-20' })).toBe(false)
  })
})

describe('eingangskorb', () => {
  it('legt ins Fach «Neu», was ohne Entscheid und hoechstens vierzehn Tage alt ist', () => {
    const k = korb([e('frisch'), e('grenze', { datum: '2026-11-08' }), e('alt', { datum: '2026-11-07' })])
    expect(ids(k.neu)).toEqual(['frisch', 'grenze'])
    expect(ids(k.liegenGeblieben)).toEqual(['alt'])
    expect(k.anmerkungen.get('alt')).toBe('ohne Entscheid')
  })

  it('zaehlt in Arbeit, was geschrieben und noch nicht ganz draussen ist', () => {
    const k = korb([e('lauf', { laufId: 'l1' })], {
      zuLauf: new Map([['l1', [m('entwurf'), m('publiziert'), m('in_pruefung')]]])
    })
    expect(ids(k.inArbeit)).toEqual(['lauf'])
    expect(k.anmerkungen.get('lauf')).toBe('2 von 3 offen')
    expect(k.neu).toEqual([])
  })

  it('sagt von einem Lauf ohne Meldungen, dass er gerade schreibt', () => {
    const k = korb([e('lauf', { laufId: 'l1' })])
    expect(ids(k.inArbeit)).toEqual(['lauf'])
    expect(k.anmerkungen.get('lauf')).toBe('wird geschrieben')
  })

  it('schiebt nach unten, was ganz publiziert oder verworfen ist', () => {
    const k = korb([e('fertig', { laufId: 'l1' }), e('weg', { laufId: 'l2' })], {
      zuLauf: new Map([
        ['l1', [m('publiziert'), m('verworfen')]],
        ['l2', [m('verworfen')]]
      ])
    })
    expect(ids(k.erledigt).sort()).toEqual(['fertig', 'weg'])
    expect(k.anmerkungen.get('fertig')).toBe('1 von 2 publiziert')
    expect(k.anmerkungen.get('weg')).toBe('alle verworfen')
    expect(k.inArbeit).toEqual([])
  })

  it('zeigt Erledigtes vierzehn Tage, das Neueste zuerst, den Rest auf Verlangen', () => {
    const k = korb(
      [
        e('gestern', { laufId: 'l1', datum: '2026-09-01' }),
        e('vorhin', { laufId: 'l2', datum: '2026-09-01' }),
        e('lange-her', { laufId: 'l3', datum: '2026-09-01' })
      ],
      {
        zuLauf: new Map([
          ['l1', [m('publiziert', '2026-11-19')]],
          ['l2', [m('publiziert', '2026-11-21')]],
          ['l3', [m('publiziert', '2026-10-01')]]
        ])
      }
    )
    expect(ids(k.erledigt)).toEqual(['vorhin', 'gestern'])
    expect(ids(k.erledigtAelter)).toEqual(['lange-her'])
  })

  it('nimmt einen Lauf aus der Arbeit, dessen Entwuerfe vierzehn Tage niemand anfasste', () => {
    const k = korb([e('liegt', { laufId: 'l1' })], {
      zuLauf: new Map([['l1', [m('entwurf', '2026-10-30'), m('publiziert', '2026-10-31')]]])
    })
    expect(ids(k.liegenGeblieben)).toEqual(['liegt'])
    expect(k.anmerkungen.get('liegt')).toBe('1 von 2 offen · seit 31.10. unberührt')
    expect(k.inArbeit).toEqual([])
  })

  it('haelt bereit, was erst kommt — in der Reihenfolge, in der es kommt', () => {
    const k = korb([
      e('agenda-spaeter', { herkunft: 'agenda', datum: '2026-12-10', datensatzId: null }),
      e('termin', { herkunft: 'abstimmungstermin', datum: '2026-11-29', datensatzId: null })
    ])
    expect(ids(k.demnaechst)).toEqual(['termin', 'agenda-spaeter'])
    expect(k.neu).toEqual([])
  })

  it('reicht die Eintraege ohne Termin unveraendert durch', () => {
    const ohne = e('ohne', { herkunft: 'agenda', datum: null, quartal: '4. Quartal 2026' })
    expect(ids(korb([], { ohneDatum: [ohne] }).ohneTermin)).toEqual(['ohne'])
  })

  describe('Suedanflug', () => {
    const monat = (id: string, datum: string, ueber: Partial<ZeitleistenEintrag> = {}) =>
      e(id, { herkunft: 'suedanflug', datum, datensatzId: null, quoteId: `q-${id}`, ...ueber })

    it('laesst nur den neuesten Monat neu sein, die frueheren sind Verlauf', () => {
      const k = korb([
        monat('okt', '2026-11-20'),
        monat('sep', '2026-10-20', { vorschlag: true }),
        monat('aug', '2026-09-20')
      ])
      expect(ids(k.neu)).toEqual(['okt'])
      expect(ids(k.suedanflugVerlauf)).toEqual(['sep', 'aug'])
      expect(k.liegenGeblieben).toEqual([])
    })

    it('fuehrt einen Monat mit Meldungen wie jeden anderen Eintrag', () => {
      const k = korb([monat('okt', '2026-11-20'), monat('sep', '2026-10-20')], {
        zuSuedanflug: new Map([
          ['q-okt', [m('entwurf')]],
          ['q-sep', [m('publiziert', '2026-11-15')]]
        ])
      })
      expect(ids(k.inArbeit)).toEqual(['okt'])
      expect(ids(k.erledigt)).toEqual(['sep'])
    })
  })

  describe('«Vergiss es» ohne Datensatz', () => {
    it('legt den Eintrag ab — und holt ihn zurueck, sobald sein Datum vorrueckt', () => {
      const zweig = (datum: string) =>
        e('zweig', { herkunft: 'portal', datum, datensatzId: null, abgelegtAm: '2026-11-21' })
      const abgelegt = korb([zweig('2026-11-20')])
      expect(ids(abgelegt.erledigt)).toEqual(['zweig'])
      expect(abgelegt.anmerkungen.get('zweig')).toBe('abgelegt')
      expect(abgelegt.neu).toEqual([])

      expect(ids(korb([zweig('2026-11-22')]).neu)).toEqual(['zweig'])
    })
  })

  it('fuehrt einen Abstimmungssonntag ueber die Meldungen ALLER seiner Vorlagen', () => {
    const sonntag = e('so', {
      herkunft: 'abstimmung',
      datum: '2026-11-15',
      datensatzId: null,
      abstimmungId: 'v1',
      abstimmungIds: ['v1', 'v2']
    })
    const quellen = { zuAbstimmung: new Map([['v2', [m('entwurf')]]]) }
    expect(meldungenZu(sonntag, quellen)).toHaveLength(1)
    expect(ids(korb([sonntag], quellen).inArbeit)).toEqual(['so'])
    expect(ids(korb([sonntag]).neu)).toEqual(['so'])
  })
})
