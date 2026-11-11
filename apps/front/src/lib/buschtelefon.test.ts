import type {
  BuschtelefonFundFelder,
  BuschtelefonKommentar,
  BuschtelefonQuelleFelder,
  BuschtelefonStandFelder
} from '@/graphql/redaktion'
import {
  abrufAnzeige,
  anzahlArbeit,
  autorText,
  bildKopf,
  bildStatusText,
  bleibtAufDemTisch,
  datumZeile,
  entscheide,
  entwurfVorbehalt,
  fehlendeBilder,
  fundKopf,
  fundNochDa,
  fundTitel,
  geteiltVon,
  istGeschlossen,
  KEIN_ENTWURF,
  keinEntwurf,
  kommentareKopf,
  kommentarZeilen,
  laufText,
  laufZeilen,
  letzterLauf,
  meldungJeFund,
  neueKommentarKennungen,
  nichtEingerichtet,
  OHNE_GEMEINDE,
  passt,
  quellenProbleme,
  quellenZahlen,
  sichtbarkeitText,
  tisch,
  vorgeschlagen,
  type BuschtelefonLaufStatus
} from './buschtelefon'

function kommentar(ueber: Partial<BuschtelefonKommentar> = {}): BuschtelefonKommentar {
  return {
    kennung: 'k1',
    stand: 'sichtbar',
    erstmals_freigegeben_am: '2026-11-09T11:51:55+01:00',
    antwort_auf: null,
    autor_ref: 'B',
    autor_vorname: 'Marc',
    text: 'Wasserleitungsbruch, die IWB ist dran.',
    ...ueber
  }
}

function fund(ueber: Partial<BuschtelefonFundFelder> = {}): BuschtelefonFundFelder {
  return {
    id: 'f1',
    status: 'aktiv',
    kanal: 'facebook',
    quelle: 'fb-gruppe:1234567890',
    quelle_name: 'Du bisch vo Aesch, wenn …',
    quelle_art: 'gruppe',
    quelle_sichtbarkeit: 'oeffentlich',
    quelle_url: 'https://www.facebook.com/groups/1234567890',
    gemeinde: { id: 'g1', name: 'Aesch' },
    link: 'https://www.facebook.com/groups/1234567890/posts/987654321',
    veroeffentlicht_am: '2026-11-08T19:42:00+01:00',
    veroeffentlicht_tag: '2026-11-08',
    datum_genauigkeit: 'minute',
    autor_art: 'profil',
    autor_rolle: null,
    autor_name: null,
    autor_vorname: 'Sandra',
    autor_ref: 'A',
    text: 'Weiss jemand, warum die Hauptstrasse seit heute gesperrt ist?\nBei uns kommt niemand mehr durch.',
    text_abgeschnitten: false,
    bilder: [],
    n_bilder: 0,
    verlinkt: [],
    geteilt: null,
    kommentare: [kommentar()],
    kommentare_stand: 'vollstaendig',
    kommentare_fehlend: 0,
    n_kommentare: 1,
    n_reaktionen: 12,
    n_geteilt: 0,
    doublette_von: null,
    erstmals_freigegeben_am: '2026-11-09T11:51:55+01:00',
    aktualisiert_am: null,
    neue_kommentare: 0,
    hinweise: null,
    vorschlag: true,
    vorschlag_wert: 3,
    vorschlag_begruendung: 'Eine Sperrung der Hauptstrasse betrifft viele.',
    entwurf_bedenken: null,
    entscheid: 'offen',
    ablehnungsgrund: null,
    material_geloescht_am: null,
    date_created: '2026-11-09T12:00:10+01:00',
    ...ueber
  }
}

function quelle(ueber: Partial<BuschtelefonQuelleFelder> = {}): BuschtelefonQuelleFelder {
  return {
    id: 'q1',
    kennung: 'fb-gruppe:1234567890',
    kanal: 'facebook',
    art: 'gruppe',
    name: 'Du bisch vo Aesch, wenn …',
    url: 'https://www.facebook.com/groups/1234567890',
    sichtbarkeit: 'oeffentlich',
    zugang: 'ohne_anmeldung',
    aktiv: true,
    stand: 'gelesen',
    zuletzt_vollstaendig_gelesen_am: '2026-11-11T11:12:00+01:00',
    n_beitraege_gesehen: 14,
    n_aussortiert: 0,
    n_zu_alt: 0,
    n_ausgelassen: 0,
    fehler_seit: null,
    letzter_fehler: null,
    hinweise: [],
    ...ueber
  }
}

const ALLE = { gemeinde: null, suche: '' }

describe('Sichtbarkeit der Gruppe', () => {
  it('behandelt alles ausser «oeffentlich» als geschlossen — auch «unbekannt»', () => {
    expect(istGeschlossen(fund())).toBe(false)
    expect(istGeschlossen(fund({ quelle_sichtbarkeit: 'geschlossen' }))).toBe(true)
    expect(istGeschlossen(fund({ quelle_sichtbarkeit: 'unbekannt' }))).toBe(true)
    expect(istGeschlossen(fund({ quelle_sichtbarkeit: null }))).toBe(true)
  })

  it('sagt es in Worten, und nennt «unbekannt» beim Namen', () => {
    expect(sichtbarkeitText(fund())).toBeNull()
    expect(sichtbarkeitText(fund({ quelle_sichtbarkeit: 'geschlossen' }))).toBe('Geschlossene Gruppe')
    expect(sichtbarkeitText(fund({ quelle_sichtbarkeit: 'unbekannt' }))).toBe(
      'Sichtbarkeit der Gruppe unbekannt'
    )
  })
})

describe('fundTitel', () => {
  it('nimmt die erste Zeile des Beitrags', () => {
    expect(fundTitel(fund())).toBe('Weiss jemand, warum die Hauptstrasse seit heute gesperrt ist?')
  })

  it('kuerzt bei neunzig Zeichen an einer Wortgrenze', () => {
    const titel = fundTitel(fund({ text: 'Wort '.repeat(40) }))
    expect(titel.length).toBeLessThanOrEqual(92)
    expect(titel.endsWith(' …')).toBe(true)
    expect(titel).not.toMatch(/Wor …$/)
  })

  it('nimmt den Bildtext, wo der Beitrag nur Bild ist — aber nur einen gelesenen', () => {
    expect(
      fundTitel(
        fund({
          text: '',
          bilder: [
            { nr: 1, art: 'foto', text_status: 'kein_text', text: null },
            {
              nr: 2,
              art: 'flyer',
              text_status: 'gelesen',
              text: '\nRäbeliechtli-Umzug\nFreitag, 13. November'
            }
          ]
        })
      )
    ).toBe('Räbeliechtli-Umzug')
  })

  it('faellt auf Geteiltes und den Linktitel zurueck, und ist nie leer', () => {
    expect(fundTitel(fund({ text: 'Achtung!\n', geteilt: { text: 'Polizei sucht Zeugen' } }))).toBe(
      'Achtung!'
    )
    expect(fundTitel(fund({ text: null, geteilt: { text: 'Polizei sucht Zeugen' } }))).toBe(
      'Polizei sucht Zeugen'
    )
    expect(
      fundTitel(
        fund({ text: '  ', verlinkt: [{ url: 'https://x.ch', titel: 'Baustelleninfo Hauptstrasse' }] })
      )
    ).toBe('Baustelleninfo Hauptstrasse')
    expect(fundTitel(fund({ text: '' }))).toBe('Beitrag ohne Text')
    expect(fundTitel(fund({ text: null, material_geloescht_am: '2026-11-25T12:00:00Z' }))).toBe(
      'Beitrag (Inhalt gelöscht)'
    )
  })
})

describe('Bilder', () => {
  it('benennt jedes Bild mit Nummer und Art', () => {
    expect(bildKopf({ nr: 1, art: 'flyer' })).toBe('Bild 1 · Flyer')
    expect(bildKopf({ nr: 3, art: 'etwas_neues' })).toBe('Bild 3 · Bild')
  })

  it('haelt die fuenf Zustaende auseinander', () => {
    expect(bildStatusText({ text_status: 'gelesen', text: 'Umzug 18 Uhr' })).toBeNull()
    expect(bildStatusText({ text_status: 'kein_text', text: null })).toBe('kein Text')
    expect(bildStatusText({ text_status: 'nicht_lesbar', text: null })).toBe('nicht lesbar')
    expect(bildStatusText({ text_status: 'nicht_versucht', text: null })).toBe('nicht gelesen')
    expect(bildStatusText({ text_status: 'zurueckgehalten', text: null })).toBe('bewusst nicht gelesen')
    // «gelesen» ohne Text ist kein gelesener Text.
    expect(bildStatusText({ text_status: 'gelesen', text: null })).toBe('kein Text')
  })

  it('sagt, wenn Bilder fehlen', () => {
    expect(
      fehlendeBilder(
        fund({ n_bilder: 5, bilder: [{ nr: 1, art: 'foto', text_status: 'kein_text', text: null }] })
      )
    ).toBe('1 von 5 Bildern geliefert')
    expect(fehlendeBilder(fund({ n_bilder: null }))).toBeNull()
    expect(fehlendeBilder(fund({ n_bilder: 0 }))).toBeNull()
  })
})

describe('Autor und Datum', () => {
  it('nennt die Organisation beim Namen, die Person beim Vornamen', () => {
    expect(autorText(fund())).toBe('Sandra')
    expect(autorText(fund({ autor_name: 'Gemeinde Aesch', autor_vorname: null }))).toBe('Gemeinde Aesch')
    expect(autorText(fund({ autor_vorname: null, autor_art: 'anonym' }))).toBe('anonym')
    expect(autorText(fund({ autor_vorname: null }))).toBeNull()
  })

  it('druckt den Tag, den der Code in Zuerich gerechnet hat — nie den gekuerzten Zeitstempel', () => {
    // 00:30 Ortszeit am 8. November ist in UTC noch der 7.
    expect(
      datumZeile(fund({ veroeffentlicht_am: '2026-11-07T23:30:00Z', veroeffentlicht_tag: '2026-11-08' }))
    ).toBe('8. November 2026, 00:30 Uhr')
  })

  it('ist nur so genau wie die Tuer', () => {
    expect(
      datumZeile(fund({ datum_genauigkeit: 'tag', veroeffentlicht_am: '2026-11-08T12:00:00+01:00' }))
    ).toBe('8. November 2026')
    expect(datumZeile(fund({ datum_genauigkeit: 'ungefaehr' }))).toBe('ungefähr am 8. November 2026')
    expect(datumZeile(fund({ veroeffentlicht_tag: null, veroeffentlicht_am: null }))).toBe('ohne Datum')
  })
})

describe('geteiltVon', () => {
  it('nennt einen Namen nur bei einer bekannten Seite mit Rolle', () => {
    expect(
      geteiltVon({ autor_art: 'seite', autor_rolle: 'behoerde', autor_name: 'Polizei Basel-Landschaft' })
    ).toBe('Polizei Basel-Landschaft')
    expect(
      geteiltVon({ autor_art: 'seite', autor_rolle: 'medium', autor_name: null, quelle_name: 'bz Basel' })
    ).toBe('bz Basel')
    expect(geteiltVon({ autor_art: 'seite', autor_rolle: 'organisation', autor_name: ' ' })).toBe(
      'einer Organisation'
    )
  })

  it('macht aus einer nicht zugeordneten Seite keine Privatperson', () => {
    const seite = geteiltVon({ autor_art: 'seite', autor_rolle: null, autor_name: null })
    expect(seite).toBe('einer Seite (nicht zugeordnet)')
    expect(seite).not.toMatch(/Privatperson/)
    expect(geteiltVon({ autor_art: 'profil', autor_rolle: null })).toBe('einer Privatperson')
    expect(geteiltVon({ autor_art: 'anonym', autor_rolle: null })).toBe('anonym')
    expect(geteiltVon({ autor_art: 'unbekannt', autor_rolle: null })).toBe('Verfasser unbekannt')
    expect(geteiltVon({})).toBe('Verfasser unbekannt')
  })

  it('zeigt ohne Rolle keinen Namen, auch wenn einer mitkaeme', () => {
    expect(geteiltVon({ autor_art: 'profil', autor_rolle: null, autor_name: 'Sandra Muster' })).toBe(
      'einer Privatperson'
    )
  })
})

describe('Entwurf und Entscheide', () => {
  // Spiegelt KEIN_ENTWURF in redaktion/buschtelefonmeldungen.ts im Backend —
  // weicht der Satz dort ab, verliert die Zeile ihre Begruendung.
  it('kennt den Satz des Schreibers wortgleich', () => {
    expect(KEIN_ENTWURF).toBe('Kein Entwurf: Der Schreiber fand im Material keine Meldung.')
  })

  it('sagt auf einer Zeile ohne lebende Meldung, dass der Schreiber nichts fand', () => {
    const abgelehnt = fund({ entwurf_bedenken: KEIN_ENTWURF })
    expect(keinEntwurf(abgelehnt)).toBe(true)
    expect(keinEntwurf(abgelehnt, 'verworfen')).toBe(true)
    expect(keinEntwurf(abgelehnt, 'entwurf')).toBe(false)
    expect(keinEntwurf(fund({ entwurf_bedenken: 'Die Ursache nennt nur ein Kommentar.' }))).toBe(false)
    expect(keinEntwurf(fund())).toBe(false)
  })

  it('zeigt Vorbehalte nur ueber einer lebenden Meldung, nie die Absage des Schreibers', () => {
    const mitVorbehalt = fund({ entwurf_bedenken: ' Die Ursache nennt nur ein Kommentar. ' })
    expect(entwurfVorbehalt(mitVorbehalt, 'entwurf')).toBe('Die Ursache nennt nur ein Kommentar.')
    expect(entwurfVorbehalt(mitVorbehalt, 'in_pruefung')).toBe('Die Ursache nennt nur ein Kommentar.')
    expect(entwurfVorbehalt(mitVorbehalt)).toBeNull()
    expect(entwurfVorbehalt(mitVorbehalt, 'verworfen')).toBeNull()
    expect(entwurfVorbehalt(fund({ entwurf_bedenken: KEIN_ENTWURF }), 'entwurf')).toBeNull()
    expect(entwurfVorbehalt(fund({ entwurf_bedenken: '  ' }), 'entwurf')).toBeNull()
  })

  it('bietet nur an, was der Endpunkt annimmt', () => {
    // Offen, ohne Meldung oder mit Entwurf: beides.
    expect(entscheide(fund())).toEqual({ ablehnen: true, weiterreichen: true, meldungUnterwegs: false })
    expect(entscheide(fund(), 'entwurf')).toEqual({
      ablehnen: true,
      weiterreichen: true,
      meldungUnterwegs: false
    })
    expect(entscheide(fund(), 'verworfen').weiterreichen).toBe(true)
    // Uebernommen: weiterreichen nimmt /weiterreichen nicht mehr an.
    expect(entscheide(fund({ entscheid: 'uebernommen' }), 'entwurf')).toEqual({
      ablehnen: true,
      weiterreichen: false,
      meldungUnterwegs: false
    })
    // Eine Meldung in der Gegenpruefung oder freigegeben verwirft niemand mit dem Fund.
    for (const status of ['in_pruefung', 'freigegeben']) {
      expect(entscheide(fund({ entscheid: 'uebernommen' }), status)).toEqual({
        ablehnen: false,
        weiterreichen: false,
        meldungUnterwegs: true
      })
      expect(entscheide(fund(), status).ablehnen).toBe(false)
    }
    expect(entscheide(fund({ entscheid: 'abgelehnt' }))).toEqual({
      ablehnen: false,
      weiterreichen: false,
      meldungUnterwegs: false
    })
  })
})

describe('Faehrte der Chefredaktion', () => {
  it('hat Material nur, solange der Fund weder entfernt noch geleert ist', () => {
    expect(fundNochDa(fund())).toBe(true)
    expect(fundNochDa(fund({ status: 'entfernt' }))).toBe(false)
    expect(fundNochDa(fund({ material_geloescht_am: '2026-11-20T12:00:00Z' }))).toBe(false)
    expect(fundNochDa(fund({ status: 'nicht_erreichbar' }))).toBe(true)
  })

  it('nennt Quelle und Tag, nie den Wortlaut', () => {
    expect(fundKopf(fund())).toBe('Du bisch vo Aesch, wenn … · 8. November 2026')
    expect(fundKopf(fund({ veroeffentlicht_tag: null }))).toBe('Du bisch vo Aesch, wenn …')
    expect(fundKopf(fund({ quelle_name: null, veroeffentlicht_tag: null }))).toBe('')
  })
})

describe('Kommentare', () => {
  const faden = [
    kommentar({ kennung: 'k1', autor_ref: 'B', autor_vorname: 'Marc' }),
    kommentar({ kennung: 'k2', antwort_auf: 'k1', autor_ref: 'A', autor_vorname: 'Sandra', text: 'Danke!' }),
    kommentar({ kennung: 'k3', antwort_auf: 'k2', autor_ref: 'C', autor_vorname: null, text: 'Stimmt.' }),
    kommentar({
      kennung: 'k4',
      antwort_auf: 'fehlt',
      autor_ref: 'D',
      autor_vorname: 'Sandra',
      erstmals_freigegeben_am: '2026-11-11T11:52:10+01:00',
      text: 'Jetzt wieder offen.'
    }),
    kommentar({
      kennung: 'k5',
      autor_ref: null,
      autor_vorname: null,
      stand: 'nicht_mehr_gesehen',
      erstmals_freigegeben_am: '2026-11-10T11:52:10+01:00'
    }),
    kommentar({
      kennung: 'k6',
      stand: 'entfernt',
      text: null,
      autor_name: 'Gemeinde Aesch',
      autor_vorname: null
    })
  ]

  it('rueckt Antworten ein, und zeigt eine Antwort ohne Elternkommentar oben', () => {
    const zeilen = kommentarZeilen(fund({ kommentare: faden }))
    expect(zeilen.map((z) => z.tiefe)).toEqual([0, 1, 2, 0, 0, 0])
  })

  it('nennt Vorname, sonst «Person B», und haelt zwei Sandras auseinander', () => {
    const zeilen = kommentarZeilen(fund({ kommentare: faden }))
    expect(zeilen.map((z) => z.autor)).toEqual([
      'Marc',
      'Sandra (A)',
      'Person C',
      'Sandra (D)',
      'Anonym',
      'Gemeinde Aesch'
    ])
  })

  it('markiert so viele als neu, wie die letzte Ersetzung brachte — die zuletzt freigegebenen', () => {
    expect(neueKommentarKennungen(fund({ kommentare: faden, neue_kommentare: 0 })).size).toBe(0)
    expect([...neueKommentarKennungen(fund({ kommentare: faden, neue_kommentare: 2 }))].sort()).toEqual([
      'k4',
      'k5'
    ])
    const zeilen = kommentarZeilen(fund({ kommentare: faden, neue_kommentare: 1 }))
    expect(zeilen.filter((z) => z.neu).map((z) => z.kommentar.kennung)).toEqual(['k4'])
  })

  it('nimmt bei gleichem Stempel den spaeteren Platz der Liste', () => {
    expect([...neueKommentarKennungen(fund({ kommentare: faden.slice(0, 3), neue_kommentare: 1 }))]).toEqual([
      'k3'
    ])
  })

  it('laesst verschwundene Kommentare verblassen, statt sie zu verstecken', () => {
    const zeilen = kommentarZeilen(fund({ kommentare: faden }))
    expect(zeilen.map((z) => z.verblasst)).toEqual([false, false, false, false, true, true])
  })

  it('haengt nicht an einem Kreis in gelieferten Daten', () => {
    const kreis = [
      kommentar({ kennung: 'a', antwort_auf: 'b' }),
      kommentar({ kennung: 'b', antwort_auf: 'a' })
    ]
    expect(kommentarZeilen(fund({ kommentare: kreis })).map((z) => z.tiefe)).toEqual([1, 1])
  })

  it('sagt im Kopf, was fehlt', () => {
    expect(kommentareKopf(fund())).toBe('Kommentare (1)')
    expect(kommentareKopf(fund({ kommentare_stand: 'gedeckelt', kommentare_fehlend: 20 }))).toBe(
      'Kommentare (1, 20 weitere nicht geliefert)'
    )
    expect(kommentareKopf(fund({ kommentare_stand: 'teilweise', kommentare_fehlend: null }))).toBe(
      'Kommentare (1, unvollständig gelesen)'
    )
    expect(kommentareKopf(fund({ kommentare: null }))).toBe('Kommentare (0)')
  })
})

describe('bleibtAufDemTisch', () => {
  it('haelt Offenes und Uebernommenes im Redigat', () => {
    expect(bleibtAufDemTisch(fund())).toBe(true)
    expect(bleibtAufDemTisch(fund(), 'entwurf')).toBe(true)
    expect(bleibtAufDemTisch(fund({ entscheid: 'uebernommen' }), 'entwurf')).toBe(true)
    expect(bleibtAufDemTisch(fund({ entscheid: 'uebernommen' }), 'in_pruefung')).toBe(true)
  })

  it('laesst los, was entschieden oder fertig ist', () => {
    expect(bleibtAufDemTisch(fund({ entscheid: 'abgelehnt' }))).toBe(false)
    expect(bleibtAufDemTisch(fund({ entscheid: 'weitergereicht' }))).toBe(false)
    expect(bleibtAufDemTisch(fund({ entscheid: 'verfallen' }))).toBe(false)
    expect(bleibtAufDemTisch(fund({ entscheid: 'uebernommen' }), 'publiziert')).toBe(false)
    expect(bleibtAufDemTisch(fund({ entscheid: 'uebernommen' }), 'verworfen')).toBe(false)
    expect(bleibtAufDemTisch(fund({ entscheid: 'uebernommen' }), null)).toBe(false)
  })

  it('nimmt einen offenen Fund vom Tisch, dessen Entwurf publiziert wurde — nicht den, dessen Entwurf verworfen ist', () => {
    expect(bleibtAufDemTisch(fund(), 'publiziert')).toBe(false)
    expect(bleibtAufDemTisch(fund(), 'verworfen')).toBe(true)
  })
})

describe('tisch', () => {
  const funde = [
    fund({ id: 'a', vorschlag_wert: 3, erstmals_freigegeben_am: '2026-11-09T11:51:55+01:00' }),
    fund({ id: 'b', vorschlag_wert: 4, erstmals_freigegeben_am: '2026-11-08T11:51:55+01:00' }),
    fund({ id: 'c', vorschlag_wert: 3, erstmals_freigegeben_am: '2026-11-11T11:51:55+01:00' }),
    fund({ id: 'd', vorschlag_wert: 2, erstmals_freigegeben_am: '2026-11-10T11:51:55+01:00' }),
    fund({
      id: 'e',
      vorschlag_wert: null,
      vorschlag: null,
      erstmals_freigegeben_am: '2026-11-11T11:52:00+01:00'
    }),
    fund({ id: 'i', kanal: 'instagram', vorschlag_wert: 4 })
  ]

  it('legt die Vorschlaege nach Stufe, dann nach Neuheit, und faltet den Rest', () => {
    const t = tisch(funde, 'facebook', ALLE)
    expect(t.vorschlaege.map((f) => f.id)).toEqual(['b', 'c', 'a'])
    expect(t.uebrige.map((f) => f.id)).toEqual(['e', 'd'])
  })

  it('zeigt je Werkbank nur ihren Kanal', () => {
    expect(tisch(funde, 'instagram', ALLE).vorschlaege.map((f) => f.id)).toEqual(['i'])
    expect(tisch(funde, 'tiktok', ALLE)).toEqual({ vorschlaege: [], uebrige: [] })
  })

  it('rechnet die Schwelle des Tischs selbst — ein Umstellen wirkt sofort', () => {
    expect(tisch(funde, 'facebook', ALLE, new Map(), 2).vorschlaege.map((f) => f.id)).toEqual([
      'b',
      'c',
      'a',
      'd'
    ])
    expect(tisch(funde, 'facebook', ALLE, new Map(), 4).vorschlaege.map((f) => f.id)).toEqual(['b'])
  })

  it('schlaegt nie vor, was unbenotet ist oder kein Material mehr hat', () => {
    expect(vorgeschlagen(fund({ vorschlag_wert: null, vorschlag: true }))).toBe(false)
    expect(vorgeschlagen(fund({ vorschlag_wert: 4, material_geloescht_am: '2026-11-25T12:00:00Z' }))).toBe(
      false
    )
    expect(vorgeschlagen(fund({ vorschlag_wert: 4, status: 'entfernt' }))).toBe(false)
    expect(vorgeschlagen(fund({ vorschlag_wert: 4, status: 'nicht_erreichbar' }))).toBe(true)
  })

  it('filtert nach Gemeinde, nach «ohne Gemeinde» und nach Text, Umlaute egal', () => {
    const gemischt = [
      fund({ id: 'a' }),
      fund({ id: 'r', gemeinde: { id: 'g2', name: 'Reinach' }, text: 'Räbeliechtli am Freitag' }),
      fund({
        id: 'o',
        gemeinde: null,
        bilder: [{ nr: 1, art: 'flyer', text_status: 'gelesen', text: 'Flohmarkt Birseck' }]
      })
    ]
    const ids = (filter: { gemeinde: string | null; suche: string }) => {
      const t = tisch(gemischt, 'facebook', filter)
      return [...t.vorschlaege, ...t.uebrige].map((f) => f.id).sort()
    }
    expect(ids({ gemeinde: 'g2', suche: '' })).toEqual(['r'])
    expect(ids({ gemeinde: OHNE_GEMEINDE, suche: '' })).toEqual(['o'])
    expect(ids({ gemeinde: null, suche: 'rabeliechtli' })).toEqual(['r'])
    expect(ids({ gemeinde: null, suche: 'flohmarkt' })).toEqual(['o'])
    expect(passt(fund(), { gemeinde: null, suche: 'du bisch' })).toBe(true)
  })

  it('haelt einen uebernommenen Fund, solange seine Meldung im Redigat ist', () => {
    const uebernommen = [fund({ id: 'a', entscheid: 'uebernommen', vorschlag_wert: 2 })]
    expect(tisch(uebernommen, 'facebook', ALLE, new Map([['a', 'entwurf']])).uebrige).toHaveLength(1)
    expect(tisch(uebernommen, 'facebook', ALLE, new Map([['a', 'publiziert']])).uebrige).toHaveLength(0)
  })
})

describe('anzahlArbeit', () => {
  it('zaehlt die Vorschlaege und das Uebernommene im Redigat, je Kanal', () => {
    const funde = [
      fund({ id: 'a', vorschlag_wert: 3 }),
      fund({ id: 'b', vorschlag_wert: 2 }),
      fund({ id: 'c', vorschlag_wert: 1, entscheid: 'uebernommen' }),
      fund({ id: 'd', vorschlag_wert: 4, entscheid: 'uebernommen' }),
      fund({ id: 'i', kanal: 'instagram', vorschlag_wert: 4 })
    ]
    const status = new Map([
      ['c', 'entwurf'],
      ['d', 'publiziert']
    ])
    expect(anzahlArbeit(funde, 'facebook', status)).toBe(2)
    expect(anzahlArbeit(funde, 'facebook', status, 2)).toBe(3)
    expect(anzahlArbeit(funde, 'instagram', status)).toBe(1)
    expect(anzahlArbeit(funde, 'tiktok', status)).toBe(0)
  })
})

describe('meldungJeFund', () => {
  it('ordnet die Meldung ihrem Fund zu, und eine lebende geht vor einer verworfenen', () => {
    const meldungen = [
      { id: 'm1', status: 'entwurf', buschtelefon_fund: { id: 'a' } },
      { id: 'm0', status: 'verworfen', buschtelefon_fund: { id: 'a' } },
      { id: 'm2', status: 'verworfen', buschtelefon_fund: { id: 'b' } },
      { id: 'm3', status: 'entwurf', buschtelefon_fund: { id: 'b' } },
      { id: 'm4', status: 'entwurf', buschtelefon_fund: null },
      { id: 'm5', status: 'entwurf' }
    ]
    const karte = meldungJeFund(meldungen)
    expect(karte.get('a')?.id).toBe('m1')
    expect(karte.get('b')?.id).toBe('m3')
    expect(karte.size).toBe(2)
  })
})

describe('Quellen', () => {
  it('nennt, was nicht oder nur halb gelesen wurde, und seit wann', () => {
    const quellen = [
      quelle(),
      quelle({
        id: 'q2',
        name: 'Reinach live',
        stand: 'fehlgeschlagen',
        fehler_seit: '2026-11-09T11:02:00+01:00',
        letzter_fehler: 'Anmeldung abgelaufen'
      }),
      quelle({ id: 'q3', name: 'Muttenz hilft', stand: 'teilweise' }),
      quelle({ id: 'q4', name: 'Alt', stand: 'fehlgeschlagen', aktiv: false }),
      quelle({ id: 'q5', name: 'Insta Aesch', kanal: 'instagram', stand: 'nicht_versucht' })
    ]
    expect(quellenProbleme(quellen, 'facebook')).toEqual([
      { id: 'q2', name: 'Reinach live', text: 'nicht gelesen seit 9. November 2026: Anmeldung abgelaufen' },
      { id: 'q3', name: 'Muttenz hilft', text: 'nur teilweise gelesen' }
    ])
    expect(quellenProbleme(quellen, 'instagram')).toEqual([
      { id: 'q5', name: 'Insta Aesch', text: 'in diesem Lauf nicht versucht' }
    ])
    expect(quellenProbleme(quellen)).toHaveLength(3)
    expect(quellenProbleme([quelle()])).toEqual([])
  })

  it('zaehlt je Quelle, was nicht geliefert wurde — nichts verschwindet still', () => {
    expect(quellenZahlen([quelle({ n_aussortiert: 3, n_zu_alt: 1 })], 'facebook')).toEqual([
      {
        id: 'q1',
        name: 'Du bisch vo Aesch, wenn …',
        text: '3 aussortiert (ohne Inhalt), 1 zu alt von 14 gesehenen'
      }
    ])
    expect(quellenZahlen([quelle({ n_ausgelassen: 2, n_beitraege_gesehen: null })])).toEqual([
      { id: 'q1', name: 'Du bisch vo Aesch, wenn …', text: '2 ohne Link oder Kennung' }
    ])
    expect(quellenZahlen([quelle()])).toEqual([])
    expect(quellenZahlen([quelle({ n_aussortiert: 3 })], 'tiktok')).toEqual([])
  })
})

describe('Der Abruf', () => {
  const status = (ueber: Partial<BuschtelefonLaufStatus> = {}): BuschtelefonLaufStatus => ({
    laeuft: false,
    gestartet_um: '2026-11-11T11:00:00Z',
    beendet_um: '2026-11-11T11:03:00Z',
    ergebnis: null,
    fehler: null,
    ...ueber
  })

  it('sagt, dass er unterwegs ist, und schweigt, bevor je einer lief', () => {
    expect(laufText(status({ laeuft: true }))).toMatch(/unterwegs/)
    expect(laufText(status({ beendet_um: null }))).toBeNull()
    expect(laufText(status())).toBe('Der letzte Abruf hat nichts zurückgemeldet.')
  })

  it('fasst das Ergebnis in Worte und nennt, was nicht glatt lief', () => {
    expect(
      laufText(
        status({
          ergebnis: {
            gelesen: 31,
            neu: 12,
            ersetzt: 4,
            gesichtet: 16,
            entwuerfe: 3,
            wartend: ['x', 'y'],
            ohneGemeinde: 2,
            entfernt: 1,
            ungueltig: [{ kennung: null }],
            fehler: ['Fund fb:1 nicht gespeichert']
          }
        })
      )
    ).toBe(
      'Letzter Abruf um 12:03 Uhr — 31 Funde gelesen, 12 neu, 4 aktualisiert, 16 gesichtet, 3 Entwürfe geschrieben, 2 Entwürfe warten auf den nächsten Lauf, 2 ohne Gemeinde, 1 an der Quelle entfernt, 1 ungültig geliefert, 1 Fehler.'
    )
    expect(laufText(status({ ergebnis: {} }))).toBe(
      'Letzter Abruf um 12:03 Uhr — 0 Funde gelesen, 0 neu, 0 aktualisiert, 0 gesichtet, 0 Entwürfe geschrieben.'
    )
  })

  it('sagt, welche Variable fehlt, wenn die Tuer nicht eingerichtet ist', () => {
    expect(nichtEingerichtet(null)).toBeNull()
    expect(nichtEingerichtet(status())).toBeNull()
    expect(nichtEingerichtet(status({ eingerichtet: true }))).toBeNull()
    expect(nichtEingerichtet(status({ eingerichtet: false, fehlend: ['BUSCHTELEFON_SCHLUESSEL'] }))).toBe(
      'Das Buschtelefon ist auf diesem Server nicht eingerichtet — es wird nichts abgeholt. Es fehlt: BUSCHTELEFON_SCHLUESSEL.'
    )
    const ausErgebnis = status({ ergebnis: { status: 'nicht_eingerichtet', fehlend: 'BUSCHTELEFON_URL' } })
    expect(nichtEingerichtet(ausErgebnis)).toMatch(/Es fehlt: BUSCHTELEFON_URL\./)
    expect(laufText(ausErgebnis)).toBeNull()
  })

  it('gibt die genannten Fehler und Hinweise als Zeilen heraus', () => {
    const s = status({ ergebnis: { fehler: ['a', '', 7, 'b'], hinweise: 'kein Feld' } })
    expect(laufZeilen(s, 'fehler')).toEqual(['a', 'b'])
    expect(laufZeilen(s, 'hinweise')).toEqual([])
    expect(laufZeilen(null, 'fehler')).toEqual([])
  })

  const FREIGABE = 'Heute noch keine Freigabe des Buschtelefons (letzte: 10. November 2026).'
  const stand = (ueber: Partial<BuschtelefonStandFelder> = {}): BuschtelefonStandFelder => ({
    freigabe: null,
    letzter_abruf: '2026-11-11T11:00:00Z',
    letzter_fehler: null,
    letzter_hinweis: null,
    ergebnis: { gelesen: 60, neu: 27, entwuerfe: 20, wartend: ['a'], hinweise: ['7 Entwürfe warten'] },
    ...ueber
  })
  // What the process answers after a restart, or when nobody pressed the button.
  const nieGestartet = status({ gestartet_um: null, beendet_um: null })

  it('nimmt den Lauf des Mittags aus dem Stand, wenn von Hand keiner lief', () => {
    const letzter = letzterLauf(nieGestartet, stand())
    expect(letzter?.beendet_um).toBe('2026-11-11T11:00:00Z')
    expect(letzter?.ergebnis).toEqual(stand().ergebnis)
    expect(laufText(letzter!)).toMatch(/^Letzter Abruf um 12:00 Uhr — 60 Funde gelesen, 27 neu/)
    expect(letzterLauf(null, stand())?.beendet_um).toBe('2026-11-11T11:00:00Z')
    expect(letzterLauf(nieGestartet, stand({ letzter_abruf: null }))).toBe(nieGestartet)
    expect(letzterLauf(null, null)).toBeNull()
  })

  it('nimmt den spaeteren der beiden, und den laufenden immer', () => {
    // Von Hand um 12:00 gestartet, 12:03 fertig; der Stand traegt den Start desselben Laufs.
    const vonHand = status()
    expect(letzterLauf(vonHand, stand())).toBe(vonHand)
    // Der Flow um 13:00 ist spaeter als der Lauf von Hand am Vormittag.
    const morgens = status({ gestartet_um: '2026-11-11T08:00:00Z', beendet_um: '2026-11-11T08:03:00Z' })
    expect(letzterLauf(morgens, stand({ letzter_abruf: '2026-11-11T12:00:00Z' }))?.beendet_um).toBe(
      '2026-11-11T12:00:00Z'
    )
    const unterwegs = status({ laeuft: true, beendet_um: null })
    expect(letzterLauf(unterwegs, stand({ letzter_abruf: '2026-11-11T12:00:00Z' }))).toBe(unterwegs)
  })

  it('nimmt einen Aufruf, der auf einen laufenden Lauf traf, nicht als Abruf', () => {
    const HINWEIS = 'Ein Buschtelefon-Lauf ist bereits unterwegs — dieser Aufruf hat nichts getan.'
    // Von Hand um 12:01 gedrueckt, waehrend der Flow von 12:00 lief: der Knopf
    // tat nichts, endet aber nach dem Startstempel des Flows im Stand.
    const leer = status({
      gestartet_um: '2026-11-11T11:01:00Z',
      beendet_um: '2026-11-11T11:01:00Z',
      ergebnis: { status: 'laeuft', gelesen: 0, hinweise: [HINWEIS] }
    })
    expect(laufText(leer)).toBeNull()
    expect(letzterLauf(leer, stand())?.ergebnis).toEqual(stand().ergebnis)
    expect(abrufAnzeige(leer, stand()).text).toMatch(/^Letzter Abruf um 12:00 Uhr — 60 Funde gelesen/)
    // Ohne Stand bleibt nur sein Hinweis — kein «0 Funde gelesen».
    const allein = abrufAnzeige(leer, null)
    expect(allein.text).toBeNull()
    expect(allein.hinweise).toEqual([HINWEIS])
  })

  it('macht Deckel und Hinweise des Laufs hoerbar, ohne den Freigabe-Hinweis doppelt', () => {
    const anzeige = abrufAnzeige(
      nieGestartet,
      stand({
        letzter_hinweis: FREIGABE,
        ergebnis: {
          gelesen: 3,
          fehler: ['Fund fb:9 ungültig'],
          hinweise: [FREIGABE, '7 Entwürfe warten auf den nächsten Lauf (Deckel 20 je Lauf).']
        },
        letzter_fehler: 'Fund fb:9 ungültig'
      })
    )
    expect(anzeige.text).toMatch(/^Letzter Abruf um 12:00 Uhr/)
    expect(anzeige.hinweise).toEqual(['7 Entwürfe warten auf den nächsten Lauf (Deckel 20 je Lauf).'])
    expect(anzeige.fehler).toEqual(['Fund fb:9 ungültig'])
    // Dieselben Fehler stehen schon als Liste da.
    expect(anzeige.standFehler).toBeNull()
    expect(anzeige.fehlgeschlagen).toBeNull()
    expect(anzeige.aus).toBeNull()
  })

  it('zeigt die Fehlerzeile des Stands, wo kein Ergebnis sie traegt', () => {
    expect(
      abrufAnzeige(null, stand({ ergebnis: null, letzter_fehler: 'Tür antwortet nicht' })).standFehler
    ).toBe('Tür antwortet nicht')
    // Ein Lauf von Hand, der abbrach: sein Fehler, nicht die alte Zeile.
    const abgebrochen = status({ fehler: 'Netzwerkfehler', beendet_um: '2026-11-11T12:30:00Z' })
    const anzeige = abrufAnzeige(abgebrochen, stand({ ergebnis: null, letzter_fehler: 'alt' }))
    expect(anzeige.fehlgeschlagen).toBe('Netzwerkfehler')
    expect(anzeige.standFehler).toBeNull()
    // Ist der Stand juenger, ist der Abbruch von Hand Geschichte.
    const frueher = status({ fehler: 'Netzwerkfehler', beendet_um: '2026-11-11T09:00:00Z' })
    expect(abrufAnzeige(frueher, stand()).fehlgeschlagen).toBeNull()
  })

  it('sagt aus dem Stand, dass die Tuer nicht eingerichtet ist — ausser der Prozess weiss es besser', () => {
    const ausgeschaltet = stand({ ergebnis: { status: 'nicht_eingerichtet', fehlend: ['BUSCHTELEFON_URL'] } })
    expect(abrufAnzeige(null, ausgeschaltet).aus).toMatch(/Es fehlt: BUSCHTELEFON_URL\./)
    expect(abrufAnzeige({ ...nieGestartet, eingerichtet: true }, ausgeschaltet).aus).toBeNull()
    expect(
      abrufAnzeige({ ...nieGestartet, eingerichtet: false, fehlend: ['BUSCHTELEFON_SCHLUESSEL'] }, null).aus
    ).toMatch(/Es fehlt: BUSCHTELEFON_SCHLUESSEL\./)
  })
})
