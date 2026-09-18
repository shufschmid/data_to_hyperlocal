import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseZeilen, type Abstimmungszeile } from '../shared/abstimmung'
import {
  gemeindeStand,
  gemeindezahlen,
  gruppiereNachVorlage,
  kantonsSumme,
  laufBilanz,
  stichfrageGilt,
  vergleichAus,
  zeilenfelder
} from './abstimmunglauf'

const FIXTURES = join(__dirname, '..', 'shared', 'abstimmung', 'fixtures')

function zeilen(name: string): Abstimmungszeile[] {
  return parseZeilen(
    JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as unknown[]
  ).zeilen
}

const OFFEN = zeilen('11990-2026-09-27-drei-gemeinden.json')
const KANTON = zeilen('11990-2026-06-14-e1-alle-gemeinden.json')
const K5 = zeilen('11990-2026-03-08-k5-aesch.json')

describe('gruppiereNachVorlage', () => {
  it('macht aus fuenf Vorlagen drei Fragen — vote_id traegt sie zusammen', () => {
    const vorlagen = gruppiereNachVorlage(OFFEN)

    expect(vorlagen.map((v) => v.voteId)).toEqual([
      '20260927_E1',
      '20260927_E2',
      '20260927_K3'
    ])
    expect(vorlagen[2]?.teile.map((t) => t.art)).toEqual([
      'vorlage',
      'gegenvorschlag',
      'stichfrage'
    ])
  })

  it('nimmt Titel und Adresse von der Vorlage selbst, nicht vom Gegenvorschlag', () => {
    const k3 = gruppiereNachVorlage(OFFEN).find(
      (v) => v.voteId === '20260927_K3'
    )

    expect(k3?.titel).toContain('Formulierte Gesetzesinitiative')
    expect(k3?.url).toBe(
      'https://vework-public.bl.ch/app/publication/2026-09-27/issues/k3a'
    )
    expect(k3?.ebene).toBe('kanton')
  })

  it('gibt jedem Teil seine eigene Adresse — gemessen: sie unterscheiden sich', () => {
    const k3 = gruppiereNachVorlage(OFFEN).find(
      (v) => v.voteId === '20260927_K3'
    )
    const adressen = k3?.teile.map((t) => t.url) ?? []

    expect(new Set(adressen).size).toBe(3)
  })
})

describe('kantonsSumme', () => {
  it('rechnet den Kanton aus allen 86 Gemeinden — und trifft die amtliche Zahl', () => {
    const [vorlage] = gruppiereNachVorlage(KANTON)
    const kanton = vorlage?.teile[0]?.kanton

    // Gegenprobe am 18.09.2026 gegen Datensatz 10500, die amtliche
    // Kantonszeile derselben Vorlage: 49'114 Ja, 62'177 Nein, 44,131151…
    // Prozent, Beteiligung 59,037150…, 192'865 Stimmberechtigte. Die Summe
    // ueber die 86 Gemeindezeilen trifft sie auf dreizehn Stellen.
    expect(kanton).not.toBeNull()
    expect(kanton?.ja).toBe(49114)
    expect(kanton?.nein).toBe(62177)
    expect(kanton?.stimmberechtigte).toBe(192865)
    expect(kanton?.leer).toBe(656)
    expect(kanton?.ungueltig).toBe(1915)
    expect(kanton?.prozentJa).toBeCloseTo(44.131151665453636, 10)
    expect(kanton?.beteiligung).toBeCloseTo(59.037150338319556, 10)
    expect(kanton?.gemeinden).toBe(86)
    expect(kanton?.antwort).toBe('abgelehnt')
  })

  it('antwortet null, solange auch nur eine Gemeinde nicht ausgezaehlt ist', () => {
    const halb = KANTON.map((z, i) =>
      i === 0 ? { ...z, ausgezaehlt: false } : z
    )

    expect(kantonsSumme(halb)).toBeNull()
  })

  it('antwortet null fuer einen Tag, an dem noch nichts gezaehlt ist', () => {
    expect(
      kantonsSumme(OFFEN.filter((z) => z.voteId === '20260927_E1'))
    ).toBeNull()
  })

  it('nennt bei einer Stichfrage die Seite, die gewonnen hat', () => {
    const kanton = kantonsSumme(K5.filter((z) => z.art === 'stichfrage'))

    // 1301 fuer die Initiative, 1665 fuer den Gegenvorschlag — und der
    // Datensatz selbst sagt «counter-proposal».
    expect(kanton?.antwort).toBe('gegenvorschlag')
  })
})

describe('gemeindeStand — die wichtigste Regel dieses Zuflusses', () => {
  it('schreibt nichts, wenn vier von fuenf Vorlagen ausgezaehlt sind', () => {
    // Aesch hat vier Zeilen fertig und eine offen. Das ist kein vorsichtig zu
    // formulierender Zwischenstand, sondern ein Nichts.
    let offenGelassen = false
    const gemischt = OFFEN.map((z) => {
      if (z.bfs !== '2761') return z
      if (!offenGelassen && z.art === 'stichfrage') {
        offenGelassen = true
        return z
      }
      return { ...z, ausgezaehlt: true }
    })

    const stand = gemeindeStand(gemischt)
    const aesch = stand.find((g) => g.bfs === '2761')

    expect(aesch?.zeilen).toBe(5)
    expect(aesch?.offen).toBe(1)
    expect(aesch?.ausgezaehlt).toBe(false)
  })

  it('schreibt erst, wenn jede Zeile dieser Gemeinde an diesem Datum steht', () => {
    const fertig = OFFEN.map((z) =>
      z.bfs === '2761' ? { ...z, ausgezaehlt: true } : z
    )
    const stand = gemeindeStand(fertig)

    expect(stand.find((g) => g.bfs === '2761')?.ausgezaehlt).toBe(true)
    expect(stand.find((g) => g.bfs === '2765')?.ausgezaehlt).toBe(false)
  })

  it('zaehlt die ganze Lage fuer das Laufergebnis', () => {
    const teilweise = OFFEN.map((z) =>
      z.bfs === '2761' ? { ...z, ausgezaehlt: true } : z
    )
    const bilanz = laufBilanz('2026-09-27', gemeindeStand(teilweise))

    expect(bilanz.ausgezaehlt).toBe(1)
    expect(bilanz.offen).toBe(2)
    expect(bilanz.satz).toContain('1 von 3')
    // Ein Lauf, der nichts schreibt, weil noch gezaehlt wird, sagt das — und
    // sieht nicht aus wie ein Fehler.
    expect(bilanz.satz).toContain('ausgezaehlt')
  })
})

describe('stichfrageGilt', () => {
  it('gilt nur, wenn der Kanton BEIDE Vorlagen angenommen hat', () => {
    const teile = [
      { art: 'vorlage' as const, kanton: { antwort: 'angenommen' } },
      { art: 'gegenvorschlag' as const, kanton: { antwort: 'angenommen' } }
    ]

    expect(stichfrageGilt(teile).gilt).toBe(true)
  })

  it('gilt nicht, wenn eine der beiden abgelehnt wurde — und sagt warum', () => {
    const teile = [
      { art: 'vorlage' as const, kanton: { antwort: 'abgelehnt' } },
      { art: 'gegenvorschlag' as const, kanton: { antwort: 'angenommen' } }
    ]
    const urteil = stichfrageGilt(teile)

    expect(urteil.gilt).toBe(false)
    expect(urteil.grund).toContain('nicht beide')
  })

  it('gilt nicht, solange der Kanton nicht fertig ausgezaehlt ist', () => {
    const teile = [
      { art: 'vorlage' as const, kanton: null },
      { art: 'gegenvorschlag' as const, kanton: null }
    ]
    const urteil = stichfrageGilt(teile)

    expect(urteil.gilt).toBe(false)
    expect(urteil.grund).toContain('Kanton')
  })

  it('gilt nicht, wenn die Frage gar keinen Gegenvorschlag hat', () => {
    const teile = [
      { art: 'vorlage' as const, kanton: { antwort: 'angenommen' } }
    ]

    expect(stichfrageGilt(teile).gilt).toBe(false)
  })
})

describe('gemeindezahlen', () => {
  it('haelt je erfasster Gemeinde ihre Zeilen fest, die anderen nicht', () => {
    const [vorlage] = gruppiereNachVorlage(KANTON)
    const zahlen = gemeindezahlen(vorlage!, KANTON, [
      { bfs: '2761', name: 'Aesch' },
      { bfs: '2765', name: 'Binningen' }
    ])

    expect(zahlen.map((g) => g.bfs)).toEqual(['2761', '2765'])
    expect(zahlen[0]?.ergebnisse[0]).toMatchObject({
      art: 'vorlage',
      ja: 1709,
      nein: 2066,
      antwort: 'abgelehnt'
    })
    expect(zahlen[0]?.ausgezaehlt).toBe(true)
  })

  it('nennt eine erfasste Gemeinde, die der Datensatz nicht kennt, mit leeren Zahlen', () => {
    const [vorlage] = gruppiereNachVorlage(KANTON)
    const zahlen = gemeindezahlen(vorlage!, KANTON, [
      { bfs: '2703', name: 'Riehen' }
    ])

    // Riehen gehoert zu Basel-Stadt und steht in diesem Datensatz nicht. Das
    // ist eine Luecke, die man sieht, kein Schweigen.
    expect(zahlen).toHaveLength(1)
    expect(zahlen[0]?.ergebnisse).toEqual([])
    expect(zahlen[0]?.ausgezaehlt).toBe(false)
  })
})

describe('vergleichAus', () => {
  it('nimmt je Gemeinde die hoechste Beteiligung des frueheren Tages', () => {
    const vergleich = vergleichAus('2026-06-14', KANTON, ['2761'])

    expect(vergleich?.datum).toBe('2026-06-14')
    expect(vergleich?.gemeinden[0]).toMatchObject({ bfs: '2761' })
    // Auf eine Nachkommastelle gerundet uebergeben: so steht sie im Text,
    // und so prueft die Ziffernpruefung sie nach.
    expect(vergleich?.gemeinden[0]?.beteiligung).toBe(54.9)
  })

  it('antwortet null, wenn es keinen frueheren Tag gibt', () => {
    expect(vergleichAus(null, [], ['2761'])).toBeNull()
  })
})

describe('zeilenfelder', () => {
  it('baut die Zeile einer Vorlage, wie sie gespeichert wird', () => {
    const [vorlage] = gruppiereNachVorlage(KANTON)
    const felder = zeilenfelder({
      vorlage: vorlage!,
      alleZeilen: KANTON,
      gemeinden: [{ bfs: '2761', name: 'Aesch' }],
      stand: '2026-06-14T18:00:00.000Z',
      hinweise: []
    })

    expect(felder['vote_id']).toBe('20260614_E1')
    expect(felder['datum']).toBe('2026-06-14')
    expect(felder['ebene']).toBe('bund')
    expect(felder['gemeinden_total']).toBe(86)
    expect(felder['gemeinden_ausgezaehlt']).toBe(86)
    expect(felder['ausgezaehlt']).toBe(true)
    expect(felder['quelle_url']).toBe(
      'https://abstimmungen.bl.ch/app/archive/de/vote/6860.html'
    )
    // Ohne Gegenvorschlag entscheidet keine Stichfrage — und die Zeile sagt es.
    expect(felder['stichfrage_gilt']).toBe(false)
    expect(String(felder['stichfrage_grund'])).toContain('Gegenvorschlag')
  })

  it('haelt fest, wie weit gezaehlt ist, ohne etwas zu beschoenigen', () => {
    const [vorlage] = gruppiereNachVorlage(OFFEN)
    const felder = zeilenfelder({
      vorlage: vorlage!,
      alleZeilen: OFFEN,
      gemeinden: [{ bfs: '2761', name: 'Aesch' }],
      stand: '2026-09-27T12:00:00.000Z',
      hinweise: ['Eine Zeile war unlesbar.']
    })

    expect(felder['gemeinden_ausgezaehlt']).toBe(0)
    expect(felder['ausgezaehlt']).toBe(false)
    expect(felder['hinweise']).toEqual(['Eine Zeile war unlesbar.'])
  })
})
