import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDossier } from '../shared/smd/parse'
import {
  attributionsWarnung,
  aufraeumAktionSmd,
  buildSmdPrompt,
  buildSmdSichtungPrompt,
  kandidatenAus,
  linkFelderAus,
  linkText,
  mediumNamen,
  mitQuelle,
  ohneQuelle,
  quelleZeile,
  schluesselFuer,
  SMD_MELDUNG_SYSTEM_PROMPT,
  vorfilter,
  zahlWarnungen,
  type SmdFakten
} from './smd'

const lesung = parseDossier(
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        '..',
        'shared',
        'smd',
        'fixtures',
        'dossier-2026-10-11.json'
      ),
      'utf8'
    )
  ) as string[]
)
const GEMEINDEN = [
  { id: 'g-aesch', name: 'Aesch' },
  { id: 'g-pratteln', name: 'Pratteln' },
  { id: 'g-reinach', name: 'Reinach' },
  { id: 'g-riehen', name: 'Riehen' }
]

describe('kandidatenAus — ein Artikel ist einer, ein Blog sind seine neuen Eintraege', () => {
  it('macht aus dem Blog nur die Eintraege im Fenster, zaehlt die alten', () => {
    const blog = lesung.dokumente[0]!
    const { kandidaten, blogAlt } = kandidatenAus(blog, '2026-10-11', 3)
    expect(kandidaten.map((k) => [k.art, k.datum, k.zeit, k.titel])).toEqual([
      [
        'blogeintrag',
        '2026-10-10',
        '22:28',
        'Sm’Aesch lässt in Aarau einen Punkt liegen'
      ],
      [
        'blogeintrag',
        '2026-10-08',
        '07:42',
        'RTV Basel bezwingt Solothurn und zieht ins Achtelfinale ein'
      ]
    ])
    expect(blogAlt).toBe(1)
    expect(kandidaten[0]?.blog).toBe('Regiosport-Aktuell')
    expect(kandidaten[0]?.schluessel).toBe(
      'bzbaselch|blog|regiosportaktuell|20261010|2228|smaeschlässtinaaraueinenpunktliegen'
    )
    expect(kandidaten[0]?.text).toMatch(/^Romina Schnyder/)
  })

  it('ein Artikel ist ein Kandidat mit Lead und Autor, der Schluessel ist Medium, Tag und Titel', () => {
    const { kandidaten, blogAlt } = kandidatenAus(
      lesung.dokumente[2]!,
      '2026-10-11'
    )
    expect(blogAlt).toBe(0)
    expect(kandidaten).toHaveLength(1)
    expect(kandidaten[0]?.art).toBe('artikel')
    expect(kandidaten[0]?.autor).toBe('Nils Løvold')
    expect(kandidaten[0]?.schluessel).toBe(
      schluesselFuer([
        'bazonline.ch',
        '2026-10-11',
        "Volleyball: Sm'Aesch Pfeffingen startet mit einem Arbeitssieg in die Saison"
      ])
    )
  })
})

describe('vorfilter — wer genannt ist, entscheidet der Code mit Wortgrenzen', () => {
  it('trifft Pratteln im Kurve-Artikel und Aesch im Volleyball-Eintrag, nie Aeschenplatz', () => {
    const kurve = kandidatenAus(lesung.dokumente[1]!, '2026-10-11')
      .kandidaten[0]!
    expect(vorfilter(kurve, GEMEINDEN).map((g) => g.name)).toEqual(['Pratteln'])
    expect(
      vorfilter(
        { titel: 'Unfall am Aeschenplatz', lead: null, text: 'Am Riehenring.' },
        GEMEINDEN
      )
    ).toEqual([])
    const volley = kandidatenAus(lesung.dokumente[2]!, '2026-10-11')
      .kandidaten[0]!
    // «Sm’Aesch» is the club — a word boundary before «Aesch» after the apostrophe.
    expect(vorfilter(volley, GEMEINDEN).map((g) => g.name)).toEqual(['Aesch'])
  })
})

describe('linkFelderAus', () => {
  it('uebersetzt die vier Antworten der Tuer in die Spalten der Zeile', () => {
    expect(
      linkFelderAus({
        status: 'gefunden',
        treffer: {
          url: 'https://www.bzbasel.ch/x-ld.1',
          titel: 'X',
          abo: true,
          weg: 'sitemap-titel'
        }
      })
    ).toEqual({
      link_url: 'https://www.bzbasel.ch/x-ld.1',
      link_status: 'gefunden',
      link_abo: true,
      link_titel: 'X',
      link_hinweis: 'gefunden über sitemap-titel'
    })
    expect(linkFelderAus({ status: 'keine_tuer' }).link_status).toBe(
      'keine_tuer'
    )
    expect(
      linkFelderAus({ status: 'nicht_gefunden', hinweis: 'nix' })
    ).toMatchObject({
      link_url: null,
      link_status: 'nicht_gefunden',
      link_hinweis: 'nix'
    })
    expect(
      linkFelderAus({ status: 'fehler', hinweis: 'HTTP 503' }).link_status
    ).toBe('fehler')
  })
})

describe('buildSmdSichtungPrompt', () => {
  it('nennt Medium, Blog, Tag und die weiteren Gemeinden je Zeile', () => {
    const p = buildSmdSichtungPrompt(
      'Aesch',
      [
        {
          id: 'a',
          titel: 'Sm’Aesch lässt in Aarau einen Punkt liegen',
          auszug: 'Romina Schnyder …',
          datum: '2026-10-10',
          medium: 'bzbasel.ch',
          blog: 'Regiosport-Aktuell',
          weitereGemeinden: ['Reinach'],
          textAbgeschnitten: false
        }
      ],
      '',
      'R1: Resultatlisten nicht vorschlagen.'
    )
    expect(p).toContain(
      '1. [bzbasel.ch · Blog «Regiosport-Aktuell» · 10. Oktober 2026] "Sm’Aesch lässt in Aarau einen Punkt liegen"'
    )
    expect(p).toContain(
      '(nennt auch Reinach — beurteile nur den Bezug zu Aesch)'
    )
    expect(p).toContain('R1: Resultatlisten nicht vorschlagen.')
    expect(p).toContain('Beurteile alle 1')
  })
})

const FAKTEN: SmdFakten = {
  gemeinde: 'Aesch',
  medium: 'bazonline.ch',
  art: 'artikel',
  datum: '2026-10-11',
  zeit: null,
  blog: null,
  rubrik: 'Sport',
  titel:
    "Volleyball: Sm'Aesch Pfeffingen startet mit einem Arbeitssieg in die Saison",
  lead: 'Die verletzungsgeschwächten Baselbieterinnen ringen Aufsteiger Aarau in fünf Sätzen nieder.',
  autor: 'Nils Løvold',
  text: 'Zum Saisonauftakt mussten die Spielerinnen von Sm’Aesch Pfeffingen einen echten Kraftakt bewältigen: nach 108 Minuten stand es 3:2.',
  textAbgeschnitten: false,
  link: {
    url: 'https://www.bazonline.ch/smaesch-pfeffingen-sieg-zum-auftakt-trotz-verletzungen-957013339861',
    abo: false
  },
  weitereGemeinden: [],
  datenImText: []
}

describe('die Quellenzeile — vom Code, mit Link oder mit dem Satz der Redaktion', () => {
  it('verlinkt den Artikel, ohne «(Abo)» nur wo die Seite ihn als frei meldet', () => {
    expect(linkText(FAKTEN)).toBe('Artikel auf bazonline.ch')
    expect(linkText({ ...FAKTEN, link: { url: 'x', abo: true } })).toBe(
      'Artikel auf bazonline.ch (Abo)'
    )
    expect(linkText({ ...FAKTEN, link: { url: 'x', abo: null } })).toBe(
      'Artikel auf bazonline.ch (Abo)'
    )
    expect(quelleZeile(FAKTEN)).toBe(
      'Quelle: Beitrag von bazonline.ch vom 11. Oktober 2026 — <a href="https://www.bazonline.ch/smaesch-pfeffingen-sieg-zum-auftakt-trotz-verletzungen-957013339861">Artikel auf bazonline.ch</a>'
    )
  })

  it('sagt ohne Link «(Artikel nicht online verfügbar)», bei einem Blog-Eintrag mit Blog und Uhrzeit', () => {
    expect(
      quelleZeile({
        ...FAKTEN,
        medium: 'bzbasel.ch',
        art: 'blogeintrag',
        blog: 'Regiosport-Aktuell',
        datum: '2026-10-10',
        zeit: '22:28',
        link: null
      })
    ).toBe(
      'Quelle: Eintrag im Blog «Regiosport-Aktuell» von bzbasel.ch vom 10. Oktober 2026, 22:28 Uhr — (Artikel nicht online verfügbar)'
    )
  })

  it('haengt die Zeile an und nimmt sie fuer die Revision wieder ab', () => {
    const text = mitQuelle('Ein Absatz.\n\nNoch einer.', FAKTEN)
    expect(text).toMatch(/\n\nQuelle: Beitrag von bazonline\.ch/)
    expect(ohneQuelle(text)).toBe('Ein Absatz.\n\nNoch einer.')
    expect(ohneQuelle(null)).toBeNull()
  })
})

describe('die Checks', () => {
  it('attributionsWarnung: das Medium muss als Quelle genannt sein — Domain, Kurzname oder Marke', () => {
    expect(mediumNamen('bzbasel.ch')).toEqual([
      'bzbasel.ch',
      'bz basel',
      'bz',
      'bzbasel'
    ])
    expect(
      attributionsWarnung(
        'Wie bazonline.ch berichtet, gewann das Team.',
        FAKTEN
      )
    ).toBeNull()
    expect(
      attributionsWarnung(
        'Die Basler Zeitung schreibt von einem Kraftakt.',
        FAKTEN
      )
    ).toBeNull()
    expect(attributionsWarnung('Laut der BaZ war es knapp.', FAKTEN)).toBeNull()
    expect(attributionsWarnung('Das Team gewann 3:2.', FAKTEN)).toMatch(
      /nennt bazonline\.ch nicht/
    )
    expect(
      attributionsWarnung('bazonline.ch — das Team gewann.', FAKTEN)
    ).toMatch(/sagt nicht/)
    // «bz» inside a word is no mention.
    expect(
      attributionsWarnung('Der Abzug kam zu spät, berichtet man.', {
        medium: 'bzbasel.ch'
      })
    ).toMatch(/nennt bzbasel\.ch nicht/)
  })

  it('zahlWarnungen: Ziffern aus Titel, Lead, Datum, Uhrzeit und Text sind erlaubt, andere nicht', () => {
    expect(
      zahlWarnungen('Nach 108 Minuten 3:2, am 11. Oktober 2026.', FAKTEN)
    ).toEqual([])
    expect(zahlWarnungen('Vor 1200 Zuschauern.', FAKTEN)).toEqual([
      'Zahl "1200" steht nicht in den Angaben.'
    ])
  })

  it('der Prompt traegt das Medium zum Nennen, die Regel der Umlaute und die Fakten', () => {
    expect(SMD_MELDUNG_SYSTEM_PROMPT).toMatch(/Umlaute schreibst du als/)
    const p = buildSmdPrompt(FAKTEN, ['Keine Spielerinnen namentlich.'])
    expect(p).toContain('Medium (so im Text nennen): bazonline.ch')
    expect(p).toContain('Beitrag von bazonline.ch vom 11. Oktober 2026')
    expect(p).toContain('Autor/in laut Medium: Nils Løvold')
    expect(p).toContain('Keine Spielerinnen namentlich.')
    expect(p).not.toContain('bazonline.ch/smaesch')
  })
})

describe('aufraeumAktionSmd — die Regel des Gemeindetischs', () => {
  const zeile = (ueber: Partial<Parameters<typeof aufraeumAktionSmd>[0]>) => ({
    id: 'z',
    entscheid: 'offen',
    vorschlag: null,
    publiziert_am: '2026-10-01',
    date_created: '2026-10-01T14:45:00Z',
    ...ueber
  })
  it('loescht Unvorgeschlagenes nach sieben Tagen, laesst Vorschlaege nach vierzehn verfallen, nie im Fenster', () => {
    expect(aufraeumAktionSmd(zeile({}), '2026-10-09', 4)).toBe('loeschen')
    expect(aufraeumAktionSmd(zeile({}), '2026-10-03', 4)).toBeNull()
    expect(
      aufraeumAktionSmd(zeile({ vorschlag: true }), '2026-10-09', 4)
    ).toBeNull()
    expect(aufraeumAktionSmd(zeile({ vorschlag: true }), '2026-10-16', 4)).toBe(
      'verfallen'
    )
    expect(
      aufraeumAktionSmd(zeile({ entscheid: 'abgelehnt' }), '2026-12-01', 4)
    ).toBeNull()
  })
})
