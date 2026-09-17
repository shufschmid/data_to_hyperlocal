import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  oeffentlicheLigaseite,
  ordneBasketballZu,
  parseSpielplan
} from './parse'

// Both fixtures are real answers of `showLeagueSchedule.do`, fetched on
// 17 September 2026 with `xmlView=rss`. The `referees` attributes were removed
// before the files were stored — they name natural persons, and nothing here
// is allowed to carry them. Everything else is verbatim: team and club names
// are organisations, venues are addresses of halls.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

async function fixture(name: string): Promise<string> {
  return readFile(join(FIXTURES, name), 'utf-8')
}

/** Season 2025/26, NL1 Men group East — every match played, every score there. */
const VORSAISON = 'showLeagueSchedule_vorsaison.xml'
/** Season 2026/27, NLB Women — first tip-off 26 September, so not one score. */
const LAUFEND = 'showLeagueSchedule_laufend.xml'

/** After the last match of the previous season, so everything counts as played. */
const SPAETER = new Date('2026-09-17T12:00:00+02:00')

describe('parseSpielplan', () => {
  it('liest die Gruppe und alle Spiele der Vorsaison', async () => {
    const plan = parseSpielplan(await fixture(VORSAISON), SPAETER)

    expect(plan.liga).toBe('NL1 Men')
    expect(plan.gruppe).toBe('Preliminary phase group East')
    expect(plan.spiele).toHaveLength(110)
  })

  it('nimmt die Identitaet an der Quelle aus GameRSS/@id', async () => {
    const plan = parseSpielplan(await fixture(VORSAISON), SPAETER)
    const spiel = plan.spiele.find((s) => s.spielnummer === '348301')

    expect(spiel).toBeDefined()
    // Heim und Gast in Spielreihenfolge, nicht in der des XML: dort steht der
    // Gast zuerst.
    expect(spiel?.heim).toBe('BC Alte Kanti Aarau')
    expect(spiel?.gast).toBe('DDV Wild Ducks')
    expect(spiel?.heimTeam).toBe('1043')
    expect(spiel?.gastTeam).toBe('6511')
    expect(spiel?.heimClub).toBe('87')
    expect(spiel?.gastClub).toBe('22')
    expect(spiel?.toreHeim).toBe(85)
    expect(spiel?.toreGast).toBe(42)
    expect(spiel?.datum).toBe('2025-09-27T14:30:00')
    expect(spiel?.ort).toBe('Sportanlage Telli Spielhalle, Aarau 4 Telli')
    expect(spiel?.videoLink).toBe('https://www.youtube.com/watch?v=u2E_iV41VFo')
  })

  it('laesst ein ungespieltes Spiel ohne Resultat, nicht bei 0:0', async () => {
    const plan = parseSpielplan(await fixture(LAUFEND), SPAETER)

    expect(plan.liga).toBe('NLB Women')
    expect(plan.spiele).toHaveLength(99)
    expect(plan.spiele.every((s) => s.toreHeim === null)).toBe(true)
    expect(plan.spiele.every((s) => s.toreGast === null)).toBe(true)
  })

  it('liest ein Resultat erst, wenn das Spiel vorbei ist', async () => {
    // Zwei Tage vor dem ersten Spieltag der Vorsaison: die Zahlen stehen im
    // XML, der Anpfiff liegt in der Zukunft. Dann zaehlt die Uhr, nicht das
    // Attribut — dieselbe Regel wie beim Handball.
    const frueh = parseSpielplan(
      await fixture(VORSAISON),
      new Date('2025-09-25T12:00:00+02:00')
    )
    const spiel = frueh.spiele.find((s) => s.spielnummer === '348301')

    expect(spiel?.toreHeim).toBeNull()
    expect(spiel?.toreGast).toBeNull()
  })

  it('traegt Schiedsrichternamen in kein Ergebnisobjekt', async () => {
    // Die Fixture ist ohne `referees` abgelegt. Damit der Test die GRENZE
    // prueft und nicht bloss die Fixture, wird das Attribut hier kuenstlich
    // wieder eingesetzt.
    const roh = await fixture(VORSAISON)
    const mitNamen = roh.replace(
      /<GameRSS /g,
      '<GameRSS referees="Muster Hans/Beispiel Anna" '
    )

    const plan = parseSpielplan(mitNamen, SPAETER)

    expect(plan.spiele).toHaveLength(110)
    expect(JSON.stringify(plan)).not.toMatch(/referees|Muster|Beispiel/)
  })

  it('loest XML-Entities im Ort auf', async () => {
    const plan = parseSpielplan(await fixture(LAUFEND), SPAETER)
    const orte = plan.spiele.map((s) => s.ort ?? '')

    expect(orte.some((o) => o.startsWith('Bahyse IV A&B'))).toBe(true)
    expect(orte.every((o) => !o.includes('&amp;'))).toBe(true)
  })

  it('nimmt eine leere Antwort als gueltig', () => {
    const leer = parseSpielplan(
      '<?xml version="1.0" encoding="UTF-8"?>\n<basketplan version="2.0"/>',
      SPAETER
    )

    expect(leer.liga).toBeNull()
    expect(leer.gruppe).toBeNull()
    expect(leer.spiele).toEqual([])
  })

  it('ueberspringt ein Spiel, dem eine Mannschaft fehlt', () => {
    const halb = `<basketplan>
      <LeagueHoldingRSS id="1" leagueName="NLB Women" name="Preliminary phase">
        <GameRSS date="2026-09-26" id="1" time="14:00">
          <guestTeam clubId="7" gender="F" id="8" name="Riva Basket"/>
        </GameRSS>
      </LeagueHoldingRSS>
    </basketplan>`

    expect(parseSpielplan(halb, SPAETER).spiele).toEqual([])
  })
})

describe('ordneBasketballZu', () => {
  const spiel = (spielnummer: string, heimTeam: string, gastTeam: string) => ({
    spielnummer,
    datum: '2026-09-26T14:00:00',
    heim: 'Heim',
    gast: 'Gast',
    heimTeam,
    gastTeam,
    heimClub: '0',
    gastClub: '0',
    toreHeim: null,
    toreGast: null,
    ort: null,
    videoLink: null
  })

  const arlesheim = { id: 'v-arlesheim', externe_id: '515' }
  const allschwil = { id: 'v-allschwil', externe_id: '6495' }

  it('ordnet ueber die Mannschaftskennung an der Quelle zu', () => {
    const { zugeordnet, ohneVerein } = ordneBasketballZu(
      [spiel('1', '515', '999'), spiel('2', '999', '6495')],
      [arlesheim, allschwil]
    )

    expect(zugeordnet.map((z) => z.verein.id)).toEqual([
      'v-arlesheim',
      'v-allschwil'
    ])
    expect(ohneVerein).toBe(0)
  })

  it('zaehlt ein Spiel ohne bekannten Verein, statt es zu speichern', () => {
    const { zugeordnet, ohneVerein } = ordneBasketballZu(
      [spiel('1', '111', '222')],
      [arlesheim]
    )

    expect(zugeordnet).toEqual([])
    expect(ohneVerein).toBe(1)
  })

  it('gibt ein Derby der Heimmannschaft, damit es einmal gespeichert wird', () => {
    // `spiele.spielnummer` ist eindeutig: zwei unserer Vereine in einem Spiel
    // duerfen nicht zwei Zeilen werden. Das Fussball-Muster entscheidet gleich.
    const { zugeordnet } = ordneBasketballZu(
      [spiel('1', '6495', '515')],
      [arlesheim, allschwil]
    )

    expect(zugeordnet).toHaveLength(1)
    expect(zugeordnet[0]?.verein.id).toBe('v-allschwil')
  })

  it('uebergeht einen Verein ohne Kennung, statt jedes Spiel zu nehmen', () => {
    const { zugeordnet, ohneVerein } = ordneBasketballZu(
      [spiel('1', '515', '999')],
      [{ id: 'v-ohne', externe_id: null }]
    )

    expect(zugeordnet).toEqual([])
    expect(ohneVerein).toBe(1)
  })
})

describe('oeffentlicheLigaseite', () => {
  it('nennt die Seite, die eine Leserin oeffnen kann', () => {
    // Gemessen am 17.09.2026: die Navigation von swiss.basketball fuehrt
    // genau diese sechs Ligaseiten.
    expect(oeffentlicheLigaseite('NLB Women')).toBe(
      'https://swiss.basketball/de/national-competitions/nlb/women'
    )
    expect(oeffentlicheLigaseite('NL1 Men')).toBe(
      'https://swiss.basketball/de/national-competitions/nl1/men'
    )
    expect(oeffentlicheLigaseite('SBL Men')).toBe(
      'https://swiss.basketball/de/national-competitions/sbl/men'
    )
  })

  it('erfindet keine Adresse fuer eine unbekannte Liga', () => {
    expect(oeffentlicheLigaseite('U16 Boys')).toBeNull()
    expect(oeffentlicheLigaseite(null)).toBeNull()
  })
})
