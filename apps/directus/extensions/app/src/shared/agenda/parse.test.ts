import { describe, expect, it } from 'vitest'
import { agendaSchluessel, decodeEntities, parseAgenda } from './parse'

// Markup copied verbatim from the real agenda page, trimmed to the parts that
// matter. Keeping it literal is the point: if the office changes their layout,
// this fixture stops matching reality and the test that catches it is the one
// that runs against the live page.
const SEITE = `
<p>
<span class="text-nowrap">
<strong>1. Quartal: Januar&ndash;M&auml;rz<br>
</strong>26.01.2026 <a href="https://statistik.bl.ch/web_portal/14_4" rel="noopener" target="_blank">Sozialmedizinische Institutionen 2024</a>
<br>
</span>
<span class="text-nowrap"><strong>3. Quartal: Juli&ndash;September</strong></span>
<span class="text-nowrap">
<br>07.07.2026 <a href="/politik-und-behorden/direktionen/finanz-und-kirchendirektion/daten-statistik/abteilung-statistik/publikationen-und-statistiken/raum-und-umwelt/webartikel-vom-07-07-2026-landwirtschaft-2025">Landwirtschaft 2025</a>
<br>07.07.2026 <a href="/politik-und-behorden/direktionen/finanz-und-kirchendirektion/daten-statistik/abteilung-statistik/publikationen-und-statistiken/bildung/webartikel-vom-07-07-2026-bildungsabschluesse-2025">Bildungsabschlüsse 2025</a>
<br>07.07.2026 <a href="https://statistik.bl.ch/web_portal/2_9" rel="noopener" target="_blank">Abfallstatistik 2025</a>
<br>
</span>
<span class="text-nowrap">Bau- und Wohnbaustatistik 2025<br>Sozialhilfestatistik 2025<br>Gemeindefinanzen 2025<br>Arealstatistik 2020/2025<br></span>
<span class="text-nowrap">Bevölkerungsstatistik, 2. Quartal 2026<strong><br></strong></span>
</p>
<p>
<span class="text-nowrap"><strong>4. Quartal: Oktober&ndash;Dezember</strong></span>
<span class="text-nowrap">
<br>23.06.2026 <a href="https://statistik.bl.ch/web_portal/18_5?year=2026">Finanzausgleich 2026</a>
<br>
</span>
</p>
`

const BASIS = 'https://www.baselland.ch'

describe('parseAgenda — publizierte Eintraege', () => {
  const eintraege = parseAgenda(SEITE, BASIS)
  const publiziert = eintraege.filter((e) => e.status === 'publiziert')

  it('liest Datum, Titel und Link', () => {
    expect(publiziert).toHaveLength(5)
  })

  // The first quarter wraps a <br> inside its <strong> and puts the heading and
  // the first entry in one block. Both cost an entry when handled naively.
  it('verliert den ersten Eintrag nicht, wenn er neben der Ueberschrift steht', () => {
    const erster = publiziert.find(
      (e) => e.titel === 'Sozialmedizinische Institutionen 2024'
    )

    expect(erster).toEqual({
      datum: '2026-01-26',
      quartal: '1. Quartal: Januar–März',
      titel: 'Sozialmedizinische Institutionen 2024',
      link: 'https://statistik.bl.ch/web_portal/14_4',
      status: 'publiziert'
    })
  })

  // The entry this connector was built for.
  it('findet die Abfallstatistik mit dem Portal-Link', () => {
    const abfall = publiziert.find((e) => e.titel === 'Abfallstatistik 2025')

    expect(abfall).toEqual({
      datum: '2026-07-07',
      quartal: '3. Quartal: Juli–September',
      titel: 'Abfallstatistik 2025',
      link: 'https://statistik.bl.ch/web_portal/2_9',
      status: 'publiziert'
    })
  })

  it('macht relative Links absolut', () => {
    const landwirtschaft = publiziert.find(
      (e) => e.titel === 'Landwirtschaft 2025'
    )
    expect(landwirtschaft?.link).toBe(
      `${BASIS}/politik-und-behorden/direktionen/finanz-und-kirchendirektion/daten-statistik/abteilung-statistik/publikationen-und-statistiken/raum-und-umwelt/webartikel-vom-07-07-2026-landwirtschaft-2025`
    )
  })

  it('laesst absolute Links unveraendert, samt Query', () => {
    const finanzausgleich = publiziert.find(
      (e) => e.titel === 'Finanzausgleich 2026'
    )
    expect(finanzausgleich?.link).toBe(
      'https://statistik.bl.ch/web_portal/18_5?year=2026'
    )
  })

  it('behaelt Umlaute im Titel', () => {
    expect(publiziert.map((e) => e.titel)).toContain('Bildungsabschlüsse 2025')
  })

  it('ordnet jeden Eintrag seinem Quartal zu', () => {
    const abfall = publiziert.find((e) => e.titel === 'Abfallstatistik 2025')
    const finanzausgleich = publiziert.find(
      (e) => e.titel === 'Finanzausgleich 2026'
    )

    expect(abfall?.quartal).toBe('3. Quartal: Juli–September')
    expect(finanzausgleich?.quartal).toBe('4. Quartal: Oktober–Dezember')
  })
})

describe('parseAgenda — geplante Eintraege', () => {
  const geplant = parseAgenda(SEITE, BASIS).filter(
    (e) => e.status === 'geplant'
  )

  // These are the whole reason for this connector: a statistic announced for a
  // quarter, with no date and no dataset yet.
  it('erfasst angekuendigte Titel ohne Datum und ohne Link', () => {
    expect(geplant.map((e) => e.titel)).toEqual(
      expect.arrayContaining([
        'Bau- und Wohnbaustatistik 2025',
        'Sozialhilfestatistik 2025',
        'Gemeindefinanzen 2025',
        'Arealstatistik 2020/2025'
      ])
    )
    for (const eintrag of geplant) {
      expect(eintrag.datum).toBeNull()
      expect(eintrag.link).toBeNull()
    }
  })

  it('haengt sie ans richtige Quartal', () => {
    const sozialhilfe = geplant.find(
      (e) => e.titel === 'Sozialhilfestatistik 2025'
    )
    expect(sozialhilfe?.quartal).toBe('3. Quartal: Juli–September')
  })

  // "Bevölkerungsstatistik, 2. Quartal 2026" contains the word that marks a
  // section heading. It is still an entry.
  it('verwechselt einen Titel mit "Quartal" darin nicht mit einer Ueberschrift', () => {
    expect(geplant.map((e) => e.titel)).toContain(
      'Bevölkerungsstatistik, 2. Quartal 2026'
    )
  })

  it('nimmt keine Ueberschrift als Eintrag auf', () => {
    expect(geplant.map((e) => e.titel)).not.toContain(
      '3. Quartal: Juli–September'
    )
    expect(geplant.map((e) => e.titel)).not.toContain(
      '4. Quartal: Oktober–Dezember'
    )
  })
})

describe('decodeEntities', () => {
  it('loest benannte und numerische Entitaeten auf', () => {
    expect(decodeEntities('Juli&ndash;September')).toBe('Juli–September')
    expect(decodeEntities('Bau &amp; Wohnen')).toBe('Bau & Wohnen')
    expect(decodeEntities('&#8211;')).toBe('–')
    expect(decodeEntities('&#x2013;')).toBe('–')
  })

  it('loest deutsche Umlaut-Entitaeten auf', () => {
    expect(decodeEntities('M&auml;rz')).toBe('März')
    expect(decodeEntities('Gr&ouml;sse, Stra&szlig;e')).toBe('Grösse, Straße')
  })

  // Named entities are case-sensitive. Folding the lookup to lower case would
  // turn every capital umlaut into a small one — silently, and only in titles
  // that happen to start with one.
  it('unterscheidet grosse und kleine Umlaut-Entitaeten', () => {
    expect(decodeEntities('&Auml;rzte')).toBe('Ärzte')
    expect(decodeEntities('&auml;rzte')).toBe('ärzte')
  })

  it('laesst Unbekanntes stehen, statt es zu verschlucken', () => {
    expect(decodeEntities('&foobar;')).toBe('&foobar;')
  })
})

describe('agendaSchluessel', () => {
  // A statistic first appears as planned, then as published. Keying on the date
  // would make the second sighting look like a brand-new announcement and
  // notify the editor twice for one event.
  it('ist fuer denselben Titel stabil, egal ob geplant oder publiziert', () => {
    const geplant = {
      datum: null,
      quartal: '3. Quartal',
      titel: 'Abfallstatistik 2025',
      link: null,
      status: 'geplant' as const
    }
    const publiziert = {
      datum: '2026-07-07',
      quartal: '3. Quartal',
      titel: 'Abfallstatistik 2025',
      link: 'https://statistik.bl.ch/web_portal/2_9',
      status: 'publiziert' as const
    }

    expect(agendaSchluessel(geplant)).toBe(agendaSchluessel(publiziert))
  })

  it('unterscheidet verschiedene Statistiken', () => {
    const a = {
      datum: null,
      quartal: null,
      titel: 'Abfallstatistik 2025',
      link: null,
      status: 'geplant' as const
    }
    const b = {
      datum: null,
      quartal: null,
      titel: 'Abfallstatistik 2026',
      link: null,
      status: 'geplant' as const
    }

    expect(agendaSchluessel(a)).not.toBe(agendaSchluessel(b))
  })
})
