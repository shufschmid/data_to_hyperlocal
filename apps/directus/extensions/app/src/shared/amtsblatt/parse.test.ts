import { describe, expect, it } from 'vitest'
import {
  GRUPPEN_TEXT,
  gruppeVon,
  parseCsv,
  parseInhalt,
  parseListe,
  planBilder,
  quellenlink,
  rubrikName
} from './parse'

// The shape the portal actually answers with, shortened. The `legalRemedy`
// column is the one that matters: real appeal instructions, with a newline and
// a semicolon inside the quotes.
const CSV = [
  'id;rubric;subRubric;registrationOfficeDisplayName;publicationNumber;publicationState;publicationDate;primaryTenantCode;legalRemedy;cantons;titleDe',
  '"870fa75b";"BP-BL";"BP-BL05";"Kanton Basel-Landschaft - Bauinspektorat";"BP-BL05-0000006880";PUBLISHED;"2026-08-27";kabbl;"<b>Einsprachen</b><br />',
  'Wer gegen ein Bauvorhaben Einwendungen hat, kann Einsprache erheben; sie sind zu begruenden.";BL;"Baugesuch - Um- und Ausbau, Pratteln"',
  '"459e7daf";"HR";"HR01";"Handelsregisteramt";"HR01-0001";PUBLISHED;"2026-08-18";shab;;BL;"Neueintragung Caliskan Folientechnik, Binningen"'
].join('\n')

describe('parseCsv', () => {
  // The bug this exists for: a line-based reader tore the appeal instructions
  // apart, every column after them shifted, and Zurich fire bans arrived as
  // Riehen news.
  it('haelt eine Zeile zusammen, die einen Zeilenumbruch im Feld hat', () => {
    const zeilen = parseCsv(CSV)

    expect(zeilen).toHaveLength(3)
    expect(zeilen[1]?.[0]).toBe('870fa75b')
    expect(zeilen[1]?.[9]).toBe('BL')
    expect(zeilen[1]?.[8]).toContain(
      'Einsprache erheben; sie sind zu begruenden.'
    )
  })

  it('liest eine verdoppelte Anfuehrung als ein Zeichen', () => {
    expect(parseCsv('a;"er sagte ""ja""";c')).toEqual([
      ['a', 'er sagte "ja"', 'c']
    ])
  })

  it('kommt mit CRLF zurecht', () => {
    expect(parseCsv('a;b\r\nc;d')).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ])
  })
})

describe('parseListe', () => {
  it('liest beide Zeilen mit ihren Feldern', () => {
    const treffer = parseListe(CSV)

    expect(treffer).toHaveLength(2)
    expect(treffer[0]).toMatchObject({
      id: '870fa75b',
      rubrik: 'BP-BL',
      unterrubrik: 'BP-BL05',
      kanton: 'BL',
      mandant: 'kabbl',
      titel: 'Baugesuch - Um- und Ausbau, Pratteln'
    })
    expect(treffer[1]?.mandant).toBe('shab')
  })

  // Columns by name, never by index: the portal versions its schema (1.25,
  // 1.26 …) and the order moves with it.
  it('findet die Spalten auch in anderer Reihenfolge', () => {
    const gedreht = [
      'titleDe;id;rubric;subRubric',
      '"Titel";"abc";"HR";"HR02"'
    ].join('\n')

    expect(parseListe(gedreht)[0]).toMatchObject({
      id: 'abc',
      titel: 'Titel',
      rubrik: 'HR'
    })
  })

  it('antwortet leer auf eine leere Ausgabe', () => {
    expect(parseListe('')).toEqual([])
  })
})

describe('gruppeVon', () => {
  it('ordnet die Rubriken den sechs Gruppen zu', () => {
    expect(gruppeVon('BP-BL', 'BP-BL05')).toBe('bauen')
    expect(gruppeVon('HR', 'HR01')).toBe('wirtschaft')
    expect(gruppeVon('RS-BS', 'RS-BS65')).toBe('behoerden')
    expect(gruppeVon('GR-BL', 'GR-BL10')).toBe('grundbuch')
    expect(gruppeVon('KK', 'KK01')).toBe('personen')
    // Basel-Stadt publiziert seine Beschaffungen im Amtsblatt. Die Rubrik
    // gehoert darum zum simap-Feed und nicht zu den Behoerden — sonst liegt
    // dieselbe Ausschreibung je nach Kanton in zwei verschiedenen Stapeln.
    expect(gruppeVon('OB-BS', 'OB-BS10')).toBe('beschaffung')
  })

  // The measured trap: Solothurn files property transfers inside the building
  // rubric, where both Basel cantons give the land registry its own. Mapping on
  // the rubric alone would file the same event under two headings.
  it('nimmt die Unterrubrik ernst, wo sie von der Rubrik abweicht', () => {
    expect(gruppeVon('BA-SO', 'BA-SO05')).toBe('bauen')
    expect(gruppeVon('BA-SO', 'BA-SO35')).toBe('grundbuch')
    expect(gruppeVon('WB-BL', 'WB-BL80')).toBe('bauen')
    expect(gruppeVon('WB-BL', 'WB-BL50')).toBe('behoerden')
  })

  it('laesst unbekannte Rubriken fallen, statt sie zu erfinden', () => {
    expect(gruppeVon('AZ', 'AZ10')).toBeNull()
    expect(gruppeVon('EK', '')).toBeNull()
  })

  it('hat fuer jede Gruppe einen deutschen Namen', () => {
    for (const gruppe of [
      'bauen',
      'wirtschaft',
      'behoerden',
      'grundbuch',
      'personen'
    ] as const) {
      expect(GRUPPEN_TEXT[gruppe]).not.toBe('')
    }
  })
})

describe('rubrikName', () => {
  it('bevorzugt die genauere Unterrubrik', () => {
    expect(rubrikName('RS-BS', 'RS-BS65')).toBe('Beschluss der Gemeinde Riehen')
    expect(rubrikName('HR', 'HR01')).toBe('Neueintragung')
  })

  it('faellt auf die Rubrik zurueck, dann auf den Code', () => {
    expect(rubrikName('BP-BS', 'BP-BS10')).toBe(
      'Baupublikationen und Nutzungsgesuche'
    )
    expect(rubrikName('XX-YY', 'XX-YY10')).toBe('XX-YY')
  })
})

describe('quellenlink', () => {
  // Built, never written — the same rule as `quelle.ts`. The official PDF and
  // not the portal's single-page app: one stable address, no JavaScript.
  it('zeigt auf das amtliche PDF', () => {
    expect(quellenlink('abc-123')).toBe(
      'https://amtsblattportal.ch/api/v1/publications/abc-123/pdf'
    )
  })
})

const BAUGESUCH_XML = `<?xml version='1.0' encoding='UTF-8'?>
<BP-BL05:publication>
<meta><id>4dc2b146</id><legalRemedy>Wer Einwendungen hat, kann bis 2099-01-01 Einsprache erheben.</legalRemedy></meta>
<content>
  <businessCase>
    <primary><element><valueType>text</valueType><term><de>Titel des Bauprojekts</de></term>
      <valueText><term><de>Solaranlage</de></term></valueText></element></primary>
    <secondary><element><key>CaseNo</key><term><de>Dossier-Nr.</de></term>
      <valueTextNeutral>1197/2026</valueTextNeutral></element></secondary>
    <secondary><element><key>parcel</key><term><de>Parzelle Nr. / Strassenname</de></term>
      <valueText><term><de>800 - Hauptstrasse 3</de></term></valueText></element></secondary>
    <secondary><element><key>buildingContractor</key><term><de>Bauherrschaft</de></term>
      <legalEntity><selectType>naturalPerson</selectType>
        <person><prename>Anna</prename><name>Lehmann</name></person></legalEntity></element></secondary>
    <secondary><element><key>externalProjectInformation</key><term><de>Unterlagen</de></term>
      <url><de>https://bgauflage.bl.ch/pages/1197_2026.html</de></url></element></secondary>
    <secondary><element><key>geoview</key><term><de>Geoview</de></term>
      <url><de>https://geoview.bl.ch/?map_x=2612300</de></url></element></secondary>
    <deadline><selectType>date</selectType><term><de>Auflagefrist</de></term><date>2026-09-07</date></deadline>
  </businessCase>
</content></BP-BL05:publication>`

describe('parseInhalt', () => {
  it('liest die beschrifteten Angaben', () => {
    const inhalt = parseInhalt(BAUGESUCH_XML)

    expect(inhalt.angaben).toContainEqual({
      bezeichnung: 'Titel des Bauprojekts',
      wert: 'Solaranlage'
    })
    expect(inhalt.angaben).toContainEqual({
      bezeichnung: 'Parzelle Nr. / Strassenname',
      wert: '800 - Hauptstrasse 3'
    })
  })

  it('holt die Frist als Datum heraus', () => {
    expect(parseInhalt(BAUGESUCH_XML).frist).toBe('2026-09-07')
  })

  // The deadline lives in `<content>`; the appeal instructions in `<meta>` are
  // boilerplate and their dates are nobody's deadline.
  it('nimmt kein Datum aus der Rechtsmittelbelehrung', () => {
    expect(parseInhalt(BAUGESUCH_XML).frist).not.toBe('2099-01-01')
  })

  it('sammelt die Namen natuerlicher Personen, damit sie draussen bleiben', () => {
    expect(parseInhalt(BAUGESUCH_XML).personen).toEqual(['Anna Lehmann'])
  })

  it('unterscheidet lesbare Plaene von blossen Kartenlinks', () => {
    const unterlagen = parseInhalt(BAUGESUCH_XML).unterlagen

    expect(unterlagen).toContainEqual({
      art: 'plaene',
      bezeichnung: 'Baugesuchsplaene',
      url: 'https://bgauflage.bl.ch/pages/1197_2026.html',
      lesbar: true
    })
    expect(unterlagen.find((u) => u.art === 'karte')?.lesbar).toBe(false)
  })

  it('erkennt die Solothurner und die Starkstrom-Unterlagen als nicht lesbar', () => {
    const xml = `<content><a><de>https://portal-ebau.so.ch/public-instances/31012</de></a>
      <b><de>https://esti-consultation.ch/pub/7596/71039781a8</de></b></content>`
    const arten = parseInhalt(xml).unterlagen.map((u) => `${u.art}:${u.lesbar}`)

    expect(arten).toEqual(['ebau:false', 'akten:false'])
  })

  it('liest die Prosa-Rubriken, die keine Elemente haben', () => {
    const xml = `<content><enactmentTitle>Beschluss des Einwohnerrats</enactmentTitle>
      <enactment>&lt;p>Der Einwohnerrat bewilligt CHF 1'180'000.&lt;/p></enactment>
      <dateDecision>2026-06-24</dateDecision></content>`
    const angaben = parseInhalt(xml).angaben

    expect(angaben).toContainEqual({
      bezeichnung: 'enactmentTitle',
      wert: 'Beschluss des Einwohnerrats'
    })
    expect(angaben.find((a) => a.bezeichnung === 'enactment')?.wert).toBe(
      "Der Einwohnerrat bewilligt CHF 1'180'000."
    )
  })
})

describe('planBilder', () => {
  // The viewer declares its sheets in one inline array with paths relative to
  // the page — measured on Baugesuch 1197/2026, four JPEGs.
  const HTML = `<script>
    const images = [
{img: '../images/1011418.jpg'},{img: '../images/1011411.jpg'}];
  </script>`

  it('macht aus den relativen Pfaden absolute Adressen', () => {
    expect(
      planBilder(HTML, 'https://bgauflage.bl.ch/pages/1197_2026.html')
    ).toEqual([
      'https://bgauflage.bl.ch/images/1011418.jpg',
      'https://bgauflage.bl.ch/images/1011411.jpg'
    ])
  })

  // A redesign that drops the array must read as "no plans", not as a crash.
  it('antwortet leer, wenn die Seite anders aufgebaut ist', () => {
    expect(
      planBilder(
        '<html><body>nichts</body></html>',
        'https://bgauflage.bl.ch/pages/x.html'
      )
    ).toEqual([])
  })
})
