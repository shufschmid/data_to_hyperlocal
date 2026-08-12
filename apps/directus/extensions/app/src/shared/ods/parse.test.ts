import { describe, expect, it } from 'vitest'
import {
  contentFingerprint,
  detectMunicipalityFields,
  parseCatalogPage,
  type OdsField,
  detectPeriodField,
  istGemeindeebene,
  istRegister
} from './parse'

// Fixtures trimmed from real data.bl.ch responses. The field shapes are
// verbatim — especially the `description` values, because that is what
// municipality detection keys on.

const ABFALL_FELDER: OdsField[] = [
  { name: 'jahr', type: 'date', label: 'Jahr', description: null },
  {
    name: 'bfs_gemeindenummer',
    type: 'text',
    label: 'BFS-Gemeindenummer',
    description:
      'conformsTo:https://register.ld.admin.ch/i14y/concept/DV_KT_BEZ_GDE_SNAP/version/2024.1.0'
  },
  { name: 'gemeinde', type: 'text', label: 'Gemeinde', description: null },
  { name: 'kategorie', type: 'text', label: 'Kategorie', description: null },
  { name: 'wert', type: 'double', label: 'Wert', description: null }
]

// The referendum dataset names the same concept completely differently.
const ABSTIMMUNG_FELDER: OdsField[] = [
  { name: 'date', type: 'date', label: 'Datum', description: null },
  {
    name: 'entity_id',
    type: 'text',
    label: 'Entity ID',
    description:
      'conformsTo:https://register.ld.admin.ch/i14y/concept/DV_KT_BEZ_GDE_SNAP/version/2024.1.0'
  },
  { name: 'name', type: 'text', label: 'Name', description: null },
  { name: 'district', type: 'text', label: 'Bezirk', description: null },
  { name: 'yeas', type: 'int', label: 'Ja-Stimmen', description: null }
]

const KANTONSWEIT_FELDER: OdsField[] = [
  { name: 'jahr', type: 'date', label: 'Jahr', description: null },
  { name: 'kanton', type: 'text', label: 'Kanton', description: null },
  { name: 'wert', type: 'double', label: 'Wert', description: null }
]

describe('detectMunicipalityFields', () => {
  // This is the point of the whole function: the two dataset families call the
  // municipality column `bfs_gemeindenummer` and `entity_id` respectively.
  // Matching on the name finds one of them and silently misses the other; both
  // carry the federal register concept, so that is what we match on.
  it('finds the column in the statistics datasets', () => {
    expect(detectMunicipalityFields(ABFALL_FELDER)).toEqual({
      bfsField: 'bfs_gemeindenummer',
      nameField: 'gemeinde'
    })
  })

  it('finds the differently named column in the referendum datasets', () => {
    expect(detectMunicipalityFields(ABSTIMMUNG_FELDER)).toEqual({
      bfsField: 'entity_id',
      nameField: 'name'
    })
  })

  it('falls back to the conventional name when nothing is annotated', () => {
    const unannotiert: OdsField[] = [
      {
        name: 'bfs_gemeindenummer',
        type: 'text',
        label: null,
        description: 'BFS_Gemeindenummer'
      },
      { name: 'gemeinde', type: 'text', label: null, description: null }
    ]
    expect(detectMunicipalityFields(unannotiert)?.bfsField).toBe(
      'bfs_gemeindenummer'
    )
  })

  it('reports nothing for a canton-wide dataset', () => {
    expect(detectMunicipalityFields(KANTONSWEIT_FELDER)).toBeNull()
  })

  it('never returns the same column twice', () => {
    const nurBfs: OdsField[] = [
      {
        name: 'gemeinde',
        type: 'text',
        label: null,
        description: 'conformsTo:…/DV_KT_BEZ_GDE_SNAP/version/2024.1.0'
      }
    ]
    const treffer = detectMunicipalityFields(nurBfs)
    expect(treffer?.bfsField).toBe('gemeinde')
    expect(treffer?.nameField).toBeNull()
  })
})

describe('parseCatalogPage', () => {
  const seite = {
    total_count: 181,
    results: [
      {
        dataset_id: '12060',
        fields: ABFALL_FELDER,
        metas: {
          default: {
            title: 'Abfallmengen nach Kategorie, Gemeinde und Jahr (seit 2017)',
            description: 'Spezifische Abfallmengen.',
            modified: '2026-07-21T07:54:14.247000+00:00',
            data_processed: '2026-07-21T07:54:14.247000+00:00',
            records_count: 12384
          }
        }
      }
    ]
  }

  it('reads the fields the scheduled check needs', () => {
    const { totalCount, datasets } = parseCatalogPage(seite)
    expect(totalCount).toBe(181)
    expect(datasets).toHaveLength(1)
    expect(datasets[0]).toMatchObject({
      datasetId: '12060',
      titel: 'Abfallmengen nach Kategorie, Gemeinde und Jahr (seit 2017)',
      recordsCount: 12384,
      dataProcessed: '2026-07-21T07:54:14.247000+00:00'
    })
    expect(datasets[0]?.fields).toHaveLength(5)
  })

  // A scheduled job must not die because one entry in a 181-item page is odd.
  it('skips unusable entries instead of throwing', () => {
    const { datasets } = parseCatalogPage({
      total_count: 3,
      results: [
        { dataset_id: 'a', metas: { default: { title: 'A' } } },
        null,
        { kein_id: true }
      ]
    })
    expect(datasets.map((d) => d.datasetId)).toEqual(['a'])
  })

  it('falls back to the id when a dataset has no title', () => {
    const { datasets } = parseCatalogPage({ results: [{ dataset_id: '999' }] })
    expect(datasets[0]?.titel).toBe('999')
  })

  it('rejects a response that is not a catalogue at all', () => {
    expect(() => parseCatalogPage({ nope: true })).toThrow()
    expect(() => parseCatalogPage('kaputt')).toThrow()
  })
})

describe('contentFingerprint', () => {
  const basis = {
    datasetId: '12060',
    titel: 'Abfallmengen',
    beschreibung: null,
    modified: '2026-07-21T07:54:14.247000+00:00',
    dataProcessed: '2026-07-21T07:54:14.247000+00:00',
    recordsCount: 12384,
    rhythmus: 'annual',
    fields: []
  }

  // The portal reports modified_updates_on_metadata_change: true, so `modified`
  // moves when someone fixes a typo. Re-running on that would produce a full set
  // of articles nobody asked for.
  it('ignores a metadata-only change', () => {
    const nurBeschreibungKorrigiert = {
      ...basis,
      modified: '2026-08-01T09:00:00.000000+00:00',
      beschreibung: 'Tippfehler behoben'
    }
    expect(contentFingerprint(nurBeschreibungKorrigiert)).toBe(
      contentFingerprint(basis)
    )
  })

  it('changes when new data arrived', () => {
    const neueDaten = {
      ...basis,
      dataProcessed: '2027-07-20T06:00:00.000000+00:00',
      recordsCount: 12900
    }
    expect(contentFingerprint(neueDaten)).not.toBe(contentFingerprint(basis))
  })

  it('changes when the row count moves but the timestamp does not', () => {
    expect(contentFingerprint({ ...basis, recordsCount: 12385 })).not.toBe(
      contentFingerprint(basis)
    )
  })

  it('falls back to modified when the portal omits data_processed', () => {
    const ohne = { ...basis, dataProcessed: null }
    expect(contentFingerprint(ohne)).toContain(
      '2026-07-21T07:54:14.247000+00:00'
    )
  })
})

describe('detectPeriodField — die Faelle aus dem echten Katalog', () => {
  const feld = (name: string, type: string): OdsField => ({
    name,
    type,
    label: null,
    description: null
  })

  // 13180 Friedensrichterwahl: einzige Datumsspalte ist das Geburtsjahr der
  // Kandidierenden. Blind genommen, wurde daraus die Periode 1997 — und ein
  // Lauf ueber eine Statistik "von 1997".
  it('haelt ein Geburtsjahr nie fuer eine Periode', () => {
    expect(
      detectPeriodField([
        feld('jahrgang', 'date'),
        feld('gemeinde', 'text'),
        feld('stimmen', 'int')
      ])
    ).toBeNull()

    expect(
      detectPeriodField([
        feld('candidate_year_of_birth', 'date'),
        feld('gemeinde', 'text')
      ])
    ).toBeNull()
  })

  // 12780 Wahlen: election_date und candidate_year_of_birth, beide date. Frueher
  // mehrdeutig, also aufgegeben — dabei ist nur eine davon eine Periode.
  it('waehlt aus zwei Datumsspalten die sprechende', () => {
    expect(
      detectPeriodField([
        feld('election_date', 'date'),
        feld('candidate_year_of_birth', 'date'),
        feld('entity_name', 'text')
      ])
    ).toBe('election_date')
  })

  // 11970 Arealstatistik nach Gemeinde seit 1982: erhebungsjahr_e ist Text.
  // Unsichtbar fuer die alte Regel, obwohl buildWhereClause Text laengst kann.
  it('nimmt eine Jahresspalte auch dann, wenn sie als Text typisiert ist', () => {
    expect(
      detectPeriodField([
        feld('erhebungsjahr_e', 'text'),
        feld('bfs_nummer', 'text'),
        feld('gemeinde', 'text'),
        feld('wert', 'int')
      ])
    ).toBe('erhebungsjahr_e')
  })

  it('nimmt weiterhin die eine echte Datumsspalte', () => {
    expect(
      detectPeriodField([feld('jahr', 'date'), feld('gemeinde', 'text')])
    ).toBe('jahr')
  })

  // 13070 Schulanlagen: ein Adressregister. Ohne Zeitachse gibt es nichts zu
  // erzaehlen, und das soll auch so bleiben.
  it('gibt null, wenn es gar keine Zeitachse gibt', () => {
    expect(
      detectPeriodField([
        feld('schulanlage_name', 'text'),
        feld('adresse', 'text'),
        feld('gemeinde', 'text')
      ])
    ).toBeNull()
  })

  // 11970 nennt dieselbe Periode zweimal: erhebungsperiode "2014/2015" und
  // erhebungsjahr_e "2014/15". Als Gleichstand behandelt, blieb die
  // Arealstatistik nach Gemeinde dauerhaft unbrauchbar — dabei taugt jede der
  // beiden. Der Jahrgang gewinnt, weil er die uebliche Periodenspalte ist.
  it('entscheidet zwischen zwei Perioden-Spalten nach dem staerkeren Namen', () => {
    expect(
      detectPeriodField([
        feld('erhebungsperiode', 'text'),
        feld('erhebungsjahr_e', 'text'),
        feld('gemeinde', 'text')
      ])
    ).toBe('erhebungsjahr_e')
  })

  it('gibt null, wenn zwei Spalten denselben Rang haben', () => {
    expect(
      detectPeriodField([
        feld('erhebungsjahr', 'text'),
        feld('meldejahr', 'text'),
        feld('gemeinde', 'text')
      ])
    ).toBeNull()
  })
})

describe('istGemeindeebene', () => {
  const bfs = new Set([2761, 2762, 2829, 2851])

  // Die beiden Datensaetze, die der Redaktion aufgefallen sind: Bezirksnummern
  // 1301–1305, mit derselben Konzept-URI annotiert wie eine Gemeindespalte.
  it('erkennt Bezirksnummern als etwas anderes', () => {
    const { treffer, gemeindeebene } = istGemeindeebene(
      ['1301', '1302', '1303', '1304', '1305'],
      bfs
    )

    expect(treffer).toBe(0)
    expect(gemeindeebene).toBe(false)
  })

  it('erkennt Gemeindenummern', () => {
    expect(istGemeindeebene(['2761', '2829'], bfs).gemeindeebene).toBe(true)
  })

  // Die Gemeindekommissionswahlen 2024 fanden in 15 Gemeinden statt,
  // Privatschulen gibt es in 15. Eine Schwelle von zwanzig haette genau die
  // weggeworfen — ein Treffer beweist die Ebene.
  it('laesst eine Teilabdeckung gelten', () => {
    expect(istGemeindeebene(['2851'], bfs).gemeindeebene).toBe(true)
  })

  it('vertraegt fuehrende Nullen, Leerzeichen und Luecken', () => {
    expect(
      istGemeindeebene([' 02761 ', null, undefined, ''], bfs).treffer
    ).toBe(1)
  })

  it('zaehlt jede Gemeinde einmal', () => {
    expect(istGemeindeebene(['2761', '2761', '2761'], bfs).treffer).toBe(1)
  })

  it('haelt Text fuer keine Nummer', () => {
    expect(
      istGemeindeebene(['Bezirk Arlesheim', 'Aesch'], bfs).gemeindeebene
    ).toBe(false)
  })
})

describe('istRegister', () => {
  // 43 der 181 Datensaetze werden taeglich oder oefter nachgefuehrt: Zefix,
  // Motorfahrzeuge, Messwerte. Sie haben keine Berichtsperiode, ueber die sich
  // schreiben liesse — und eine Meldung darueber waere am naechsten Morgen alt.
  it('erkennt die Rhythmen, die kein Berichten zulassen', () => {
    for (const r of [
      'daily',
      'hourly',
      'every fifteen minutes',
      'continuous'
    ]) {
      expect(istRegister(r)).toBe(true)
    }
  })

  it('laesst die Statistiken in Ruhe', () => {
    for (const r of [
      'annual',
      'quarterly',
      'monthly',
      'irregular',
      'as needed',
      'quinquennial'
    ]) {
      expect(istRegister(r)).toBe(false)
    }
  })

  it('vertraegt fehlende Angaben und Schreibweisen', () => {
    expect(istRegister(null)).toBe(false)
    expect(istRegister(undefined)).toBe(false)
    expect(istRegister('  Daily ')).toBe(true)
  })
})
