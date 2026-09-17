import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BasketplanFehler, holeSpielplan, istErlaubteQuelle } from './index'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

async function fixture(name: string): Promise<string> {
  return readFile(join(FIXTURES, name), 'utf-8')
}

const GRUPPE =
  'https://swiss.basketball/basketplan/showLeagueSchedule.do' +
  '?lang=de&xmlView=rss&leagueId=7&seasonId=31&daysBack=30&daysFuture=120' +
  '&totalGames=500&resultType=big&leagueHoldingId=11329'

function antwortet(
  koerper: string,
  status = 200
): { fetchImpl: typeof fetch; aufrufe: Array<{ url: string; kopf: string }> } {
  const aufrufe: Array<{ url: string; kopf: string }> = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const kopfzeilen = new Headers(init?.headers)
    aufrufe.push({
      url: String(url),
      kopf: kopfzeilen.get('user-agent') ?? ''
    })
    return new Response(koerper, {
      status,
      headers: { 'content-type': 'text/xml; charset=utf-8' }
    })
  }) as unknown as typeof fetch
  return { fetchImpl, aufrufe }
}

describe('holeSpielplan', () => {
  it('meldet sich mit Kontaktadresse und liefert den Spielplan', async () => {
    const { fetchImpl, aufrufe } = antwortet(
      await fixture('showLeagueSchedule_laufend.xml')
    )

    const plan = await holeSpielplan(GRUPPE, {
      kontakt: 'it@bajour.ch',
      fetchImpl,
      jetzt: new Date('2026-09-17T12:00:00+02:00')
    })

    expect(aufrufe).toHaveLength(1)
    expect(aufrufe[0]?.url).toBe(GRUPPE)
    expect(aufrufe[0]?.kopf).toBe(
      'DieRedaktion/1.0 (redaktioneller Monitor; Kontakt it@bajour.ch)'
    )
    expect(plan.liga).toBe('NLB Women')
    expect(plan.spiele).toHaveLength(99)
    expect(plan.abgeschnitten).toBe(false)
  })

  it('sagt es, wenn totalGames die Antwort begrenzt hat', async () => {
    const { fetchImpl } = antwortet(
      await fixture('showLeagueSchedule_laufend.xml')
    )

    const plan = await holeSpielplan(
      GRUPPE.replace('totalGames=500', 'totalGames=99'),
      {
        kontakt: 'it@bajour.ch',
        fetchImpl,
        jetzt: new Date('2026-09-17T12:00:00+02:00')
      }
    )

    expect(plan.abgeschnitten).toBe(true)
  })

  it('nimmt eine Fehlantwort als Antwort und nennt die Adresse', async () => {
    const { fetchImpl } = antwortet('nicht gefunden', 404)

    await expect(
      holeSpielplan(GRUPPE, { kontakt: 'it@bajour.ch', fetchImpl })
    ).rejects.toBeInstanceOf(BasketplanFehler)
  })

  it('ruft basketplan.ch nie ab, auch wenn die Adresse dorthin zeigt', async () => {
    const { fetchImpl, aufrufe } = antwortet('<basketplan/>')

    await expect(
      holeSpielplan('https://www.basketplan.ch/showLeagueSchedule.do?x=1', {
        kontakt: 'it@bajour.ch',
        fetchImpl
      })
    ).rejects.toBeInstanceOf(BasketplanFehler)
    expect(aufrufe).toHaveLength(0)
  })

  it('ruft findTeamById.do nie ab', async () => {
    const { fetchImpl, aufrufe } = antwortet('<basketplan/>')

    await expect(
      holeSpielplan(
        'https://swiss.basketball/basketplan/findTeamById.do?teamId=515',
        {
          kontakt: 'it@bajour.ch',
          fetchImpl
        }
      )
    ).rejects.toBeInstanceOf(BasketplanFehler)
    expect(aufrufe).toHaveLength(0)
  })
})

describe('istErlaubteQuelle', () => {
  it('erlaubt nur den Spielplan des Verbands', () => {
    expect(istErlaubteQuelle(GRUPPE)).toBe(true)
    expect(
      istErlaubteQuelle(
        'https://www.swiss.basketball/basketplan/showLeagueSchedule.do?a=1'
      )
    ).toBe(true)
    // Das Original sperrt uns per robots.txt aus (gemessen 17.09.2026).
    expect(
      istErlaubteQuelle('https://www.basketplan.ch/showLeagueSchedule.do')
    ).toBe(false)
    // Diese Antwort traegt private Kontaktdaten eines Funktionaers.
    expect(
      istErlaubteQuelle(
        'https://swiss.basketball/basketplan/findTeamById.do?teamId=515'
      )
    ).toBe(false)
    expect(istErlaubteQuelle('nicht einmal eine Adresse')).toBe(false)
  })
})
