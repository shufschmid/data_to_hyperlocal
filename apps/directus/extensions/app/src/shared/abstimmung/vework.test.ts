import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  artAusSubtyp,
  findeTag,
  liesVework,
  teileAus,
  voteIdAus,
  waehleZeilen,
  zeilenAusTeil
} from './vework'

// Echte Antworten von abstimmungen.bl.ch vom Abstimmungssonntag 27.09.2026,
// 14:25 Uhr — alle 86 Gemeinden fertig ausgezaehlt, waehrend data.bl.ch noch
// alle 430 Zeilen als «nicht ausgezaehlt» fuehrte.

const FIX = join(__dirname, 'fixtures')
const lies = (datei: string): unknown =>
  JSON.parse(readFileSync(join(FIX, datei), 'utf8'))
const TAGE = lies('vework-polling_days-2026-09-27.json')

describe('VeWork: der Abstimmungstag', () => {
  it('findet den Tag und seine fuenf Teile, mit Art und Ebene', () => {
    const tag = findeTag(TAGE, '2026-09-27')
    expect(tag).not.toBeNull()
    const teile = teileAus(tag!)
    expect(teile.map((t) => [t.frontendId, t.art, t.ebene])).toEqual([
      ['e1', 'vorlage', 'bund'],
      ['e2', 'vorlage', 'bund'],
      ['k3a', 'vorlage', 'kanton'],
      ['k3b', 'gegenvorschlag', 'kanton'],
      ['k3c', 'stichfrage', 'kanton']
    ])
  })

  it('kennt keinen Tag, den der Kanton nicht publiziert', () => {
    expect(findeTag(TAGE, '2026-10-04')).toBeNull()
  })

  it('bildet die vote_id des Portals: die drei Teile einer Frage unter einer Kennung', () => {
    expect(voteIdAus('2026-09-27', 'e1')).toBe('20260927_E1')
    expect(voteIdAus('2026-09-27', 'k3a')).toBe('20260927_K3')
    expect(voteIdAus('2026-09-27', 'k3c')).toBe('20260927_K3')
  })

  it('uebersetzt die Unterart', () => {
    expect(artAusSubtyp('initiative')).toBe('vorlage')
    expect(artAusSubtyp('counter_proposal')).toBe('gegenvorschlag')
    expect(artAusSubtyp('tie_counter_proposal')).toBe('stichfrage')
    expect(artAusSubtyp(undefined)).toBe('vorlage')
  })
})

describe('VeWork: die Resultate eines Teils', () => {
  const teile = teileAus(findeTag(TAGE, '2026-09-27')!)
  const e1 = teile.find((t) => t.frontendId === 'e1')!
  const k3c = teile.find((t) => t.frontendId === 'k3c')!

  it('liefert alle 86 Gemeinden in der Form des Portals, fertig ausgezaehlt', () => {
    const { zeilen, verworfen } = zeilenAusTeil(
      '2026-09-27',
      e1,
      lies('vework-issue-14-counting_circles.json')
    )
    expect(verworfen).toEqual([])
    expect(zeilen).toHaveLength(86)
    expect(zeilen.every((z) => z.ausgezaehlt)).toBe(true)
    const aesch = zeilen.find((z) => z.bfs === '2761')!
    expect(aesch).toMatchObject({
      voteId: '20260927_E1',
      gemeinde: 'Aesch (BL)',
      art: 'vorlage',
      ebene: 'bund',
      antwort: 'abgelehnt',
      ja: 744,
      nein: 2023,
      stimmberechtigte: 7022,
      url: 'https://vework-public.bl.ch/app/publication/2026-09-27/issues/e1'
    })
  })

  it('summiert ueber alle Gemeinden genau auf das Kantonstotal', () => {
    const { zeilen } = zeilenAusTeil(
      '2026-09-27',
      e1,
      lies('vework-issue-14-counting_circles.json')
    )
    expect(zeilen.reduce((s, z) => s + (z.ja ?? 0), 0)).toBe(21470)
    expect(zeilen.reduce((s, z) => s + (z.nein ?? 0), 0)).toBe(60942)
  })

  it('nennt bei der Stichfrage die Seite, die gewann, wie das Portal', () => {
    const { zeilen } = zeilenAusTeil(
      '2026-09-27',
      k3c,
      lies('vework-issue-18-counting_circles.json')
    )
    const aesch = zeilen.find((z) => z.bfs === '2761')!
    // 765 fuer die Initiative, 1286 fuer den Gegenvorschlag
    expect(aesch).toMatchObject({
      art: 'stichfrage',
      ja: 765,
      nein: 1286,
      antwort: 'gegenvorschlag'
    })
  })

  it('zaehlt eine noch offene Gemeinde als nicht ausgezaehlt', () => {
    const roh = lies('vework-issue-14-counting_circles.json') as {
      data: { records: Array<Record<string, unknown>> }
    }
    const offen = {
      data: {
        ...roh.data,
        records: [{ ...roh.data.records[0], finished: false }]
      }
    }
    expect(zeilenAusTeil('2026-09-27', e1, offen).zeilen[0]?.ausgezaehlt).toBe(
      false
    )
  })
})

describe('liesVework', () => {
  it('liest die Liste und je Teil die Resultate, nacheinander', async () => {
    const aufrufe: string[] = []
    const doFetch = async (url: string): Promise<Response> => {
      aufrufe.push(url)
      const datei = url.endsWith('polling_days.json')
        ? 'vework-polling_days-2026-09-27.json'
        : `vework-issue-${/issues\/(\d+)\//.exec(url)?.[1] === '15' ? 14 : /issues\/(\d+)\//.exec(url)?.[1]}-counting_circles.json`
      return new Response(readFileSync(join(FIX, datei), 'utf8'), {
        status: 200
      })
    }
    const gelesen = await liesVework(
      'https://abstimmungen.bl.ch/data/publication',
      '2026-09-27',
      doFetch
    )
    expect(aufrufe).toHaveLength(6)
    expect(gelesen?.zeilen).toHaveLength(5 * 86)
  })

  it('sagt null, wenn der Kanton den Tag nicht publiziert — ein Abruf', async () => {
    let n = 0
    const doFetch = async (): Promise<Response> => {
      n += 1
      return new Response(
        readFileSync(join(FIX, 'vework-polling_days-2026-09-27.json'), 'utf8')
      )
    }
    expect(await liesVework('https://x', '2026-10-04', doFetch)).toBeNull()
    expect(n).toBe(1)
  })

  it('bricht laut ab, wenn ein Teil nicht antwortet', async () => {
    const doFetch = async (url: string): Promise<Response> =>
      url.endsWith('polling_days.json')
        ? new Response(
            readFileSync(
              join(FIX, 'vework-polling_days-2026-09-27.json'),
              'utf8'
            )
          )
        : new Response('nein', { status: 503 })
    await expect(
      liesVework('https://x', '2026-09-27', doFetch)
    ).rejects.toThrow('503')
  })
})

describe('waehleZeilen', () => {
  const teil = teileAus(findeTag(TAGE, '2026-09-27')!).find(
    (t) => t.frontendId === 'e1'
  )!
  const live = zeilenAusTeil(
    '2026-09-27',
    teil,
    lies('vework-issue-14-counting_circles.json')
  )
  const portalOffen = {
    zeilen: live.zeilen.map((z) => ({ ...z, ausgezaehlt: false, ja: null })),
    verworfen: []
  }

  it('nimmt die Live-Publikation, wenn sie weiter ausgezaehlt ist — der Sonntag vom 27.09.2026', () => {
    expect(waehleZeilen(portalOffen, live).quelle).toBe('live')
  })

  it('bleibt beim Portal, sobald es gleichauf ist, und wenn die Live-Seite schweigt', () => {
    expect(waehleZeilen(live, live).quelle).toBe('portal')
    expect(waehleZeilen(portalOffen, null).quelle).toBe('portal')
  })

  it('nimmt die Live-Publikation, wo das Portal den Tag noch gar nicht fuehrt', () => {
    expect(waehleZeilen({ zeilen: [], verworfen: [] }, live).quelle).toBe(
      'live'
    )
  })
})
