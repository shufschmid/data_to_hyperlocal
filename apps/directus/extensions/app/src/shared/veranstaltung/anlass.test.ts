import { describe, expect, it } from 'vitest'
import type { ListenEintrag } from '../gemeindeseite/liste'
import { gruppiereAnlaesse, naechsteSeite, naechsterTermin } from './anlass'

const zeile = (
  titel: string,
  am: string | null,
  ueber: Partial<ListenEintrag> = {}
): ListenEintrag => ({
  url: `https://www.example.ch/anlass/${titel}-${am ?? 'x'}-${ueber.zeit ?? ''}`,
  titel,
  teaser: null,
  datum: null,
  datumQuelle: null,
  kategorie: null,
  direktPdf: false,
  veranstaltungAm: am,
  veranstaltungBis: null,
  zeit: null,
  lokalitaet: null,
  ort: null,
  veranstalter: null,
  serie: null,
  serieSeit: null,
  abgesagt: false,
  ...ueber
})

describe('gruppiereAnlaesse', () => {
  it('faltet eine Zeile je Tag auf einen Anlass mit Terminliste — Arlesheims INKLUSIV', () => {
    const rows = [
      zeile('INKLUSIV Arlesheim', '2026-09-21', { lokalitaet: 'Setzwerk' }),
      zeile('INKLUSIV Arlesheim', '2026-09-22', { lokalitaet: 'Setzwerk' }),
      zeile('INKLUSIV Arlesheim', '2026-09-23', { lokalitaet: 'Setzwerk' })
    ]
    const [anlass, ...rest] = gruppiereAnlaesse(rows)
    expect(rest).toHaveLength(0)
    expect(anlass).toMatchObject({
      titel: 'INKLUSIV Arlesheim',
      termine: ['2026-09-21', '2026-09-22', '2026-09-23'],
      von: '2026-09-21',
      bis: '2026-09-23',
      spanne: false,
      lokalitaet: 'Setzwerk'
    })
    expect(anlass?.url).toContain('2026-09-21')
  })

  it('haelt zwei Gruppen am selben Tag zu verschiedenen Zeiten auseinander — die Krabbelgruppe', () => {
    const rows = [
      zeile('Krabbelgruppe', '2026-09-22', {
        lokalitaet: 'OASE',
        zeit: '09:00–10:30'
      }),
      zeile('Krabbelgruppe', '2026-09-22', {
        lokalitaet: 'OASE',
        zeit: '10:45–12:00'
      }),
      zeile('Krabbelgruppe', '2026-09-29', {
        lokalitaet: 'OASE',
        zeit: '09:00–10:30'
      })
    ]
    const anlaesse = gruppiereAnlaesse(rows)
    expect(anlaesse).toHaveLength(2)
    expect(anlaesse.map((a) => a.termine.length).sort()).toEqual([1, 2])
    expect(
      anlaesse.every(
        (a) => a.schluessel.endsWith(':00') || a.schluessel.endsWith(':45')
      )
    ).toBe(true)
  })

  it('laesst eine zweitaegige Boerse mit anderen Zeiten je Tag EIN Anlass sein', () => {
    const rows = [
      zeile('Kinderartikelbörse', '2026-10-20', {
        lokalitaet: 'Pfarreiheim',
        zeit: '14:00–18:00'
      }),
      zeile('Kinderartikelbörse', '2026-10-21', {
        lokalitaet: 'Pfarreiheim',
        zeit: '09:00–12:00'
      })
    ]
    const anlaesse = gruppiereAnlaesse(rows)
    expect(anlaesse).toHaveLength(1)
    expect(anlaesse[0]?.termine).toEqual(['2026-10-20', '2026-10-21'])
  })

  it('nimmt eine Spanne als von/bis und merkt sich, dass es eine war', () => {
    const [a] = gruppiereAnlaesse([
      zeile('Alder & Bahn', '2026-08-10', { veranstaltungBis: '2027-03-21' })
    ])
    expect(a).toMatchObject({
      von: '2026-08-10',
      bis: '2027-03-21',
      spanne: true,
      termine: ['2026-08-10', '2027-03-21']
    })
  })

  it('nimmt die Serien-Id der Site als Schluessel und den ersten Serienstart', () => {
    const [a] = gruppiereAnlaesse([
      zeile('Einwohnerratssitzung', '2026-11-02', {
        serie: '2648',
        serieSeit: '2022-04-04'
      }),
      zeile('Einwohnerratssitzung', '2026-09-21', {
        serie: '2648',
        serieSeit: '2022-04-04'
      })
    ])
    expect(a).toMatchObject({
      schluessel: 'serie:2648',
      von: '2026-09-21',
      serieSeit: '2022-04-04'
    })
    expect(a?.url).toContain('2026-09-21')
  })

  it('markiert den Anlass als abgesagt, wenn eine seiner Zeilen es ist', () => {
    const [a] = gruppiereAnlaesse([
      zeile('Kinderkleiderbörse', '2026-09-18', { abgesagt: false }),
      zeile('Kinderkleiderbörse ist leider abgesagt', '2026-09-19', {
        abgesagt: true
      })
    ])
    expect(gruppiereAnlaesse([zeile('x', null)])).toHaveLength(1)
    expect(a?.abgesagt).toBe(true)
    expect(a?.termine).toHaveLength(2)
  })
})

describe('naechsterTermin', () => {
  it('nimmt den ersten Termin ab heute, sonst null', () => {
    expect(
      naechsterTermin(['2026-09-10', '2026-09-21', '2026-10-01'], '2026-09-18')
    ).toBe('2026-09-21')
    expect(naechsterTermin(['2026-09-10'], '2026-09-18')).toBeNull()
  })
})

// Der Reinacher Kalender gibt jedem Termin eine eigene Seite und nimmt eine
// vergangene vom Netz: die Adresse der Serie muss mit den Terminen wandern.
describe('naechsteSeite', () => {
  const eintraege = [
    zeile('Palais', '2026-09-22'),
    zeile('Palais', '2026-10-13'),
    zeile('Palais', '2026-10-20')
  ]
  const anlass = { url: eintraege[0]!.url, eintraege }

  it('nimmt die Seite des naechsten Termins ab heute', () => {
    expect(naechsteSeite(anlass, '2026-09-27')).toBe(eintraege[1]!.url)
    expect(naechsteSeite(anlass, '2026-10-13')).toBe(eintraege[1]!.url)
  })

  it('bleibt bei der ersten Seite, wenn kein Termin mehr vor uns liegt', () => {
    expect(naechsteSeite(anlass, '2026-11-01')).toBe(eintraege[0]!.url)
  })

  it('haelt eine laufende Spanne auf ihrer eigenen Seite', () => {
    const ausstellung = zeile('Ausstellung', '2026-09-01', {
      veranstaltungBis: '2026-10-31'
    })
    expect(
      naechsteSeite(
        { url: ausstellung.url, eintraege: [ausstellung] },
        '2026-09-27'
      )
    ).toBe(ausstellung.url)
  })
})
