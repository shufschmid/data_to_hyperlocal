import { describe, expect, it } from 'vitest'
import {
  fehler,
  istKennung,
  leseGrenze,
  leseSeit,
  leseVersatz
} from './parameter'

describe('fehler', () => {
  it('baut den einen Umschlag, den jede Absage dieser Schnittstelle traegt', () => {
    // R6: `code` ist stabiles ASCII, auf das ein Programm verzweigt;
    // `meldung` ist Deutsch mit echten Umlauten und darf sich aendern.
    expect(fehler('nicht_gefunden', 'Gibt es nicht.')).toEqual({
      fehler: { code: 'nicht_gefunden', meldung: 'Gibt es nicht.' }
    })
  })
})

describe('leseGrenze', () => {
  it('nimmt die Vorgabe, wenn nichts dasteht', () => {
    expect(leseGrenze(undefined)).toEqual({ ok: true, wert: 100 })
    expect(leseGrenze('')).toEqual({ ok: true, wert: 100 })
  })

  it('nimmt eine Zahl im erlaubten Bereich', () => {
    expect(leseGrenze('1')).toEqual({ ok: true, wert: 1 })
    expect(leseGrenze('500')).toEqual({ ok: true, wert: 500 })
  })

  it('weist ab, was keine brauchbare Grenze ist', () => {
    for (const roh of ['0', '-1', '501', 'viele', '1e3', '1.5', '0x10']) {
      const gelesen = leseGrenze(roh)
      expect(gelesen.ok, `grenze=${roh}`).toBe(false)
      if (!gelesen.ok) expect(gelesen.meldung).toContain('grenze')
    }
  })

  it('weist zwei Antworten auf eine Frage ab', () => {
    // Express macht aus ?grenze=1&grenze=2 ein Array. Sich eine davon
    // auszusuchen waere geraten, nicht gelesen.
    expect(leseGrenze(['1', '2']).ok).toBe(false)
  })
})

describe('leseVersatz', () => {
  it('faengt bei 0 an und nimmt jede ganze Zahl darueber', () => {
    expect(leseVersatz(undefined)).toEqual({ ok: true, wert: 0 })
    expect(leseVersatz('0')).toEqual({ ok: true, wert: 0 })
    expect(leseVersatz('4200')).toEqual({ ok: true, wert: 4200 })
  })

  it('weist Negatives und Unlesbares ab', () => {
    expect(leseVersatz('-1').ok).toBe(false)
    expect(leseVersatz('bald').ok).toBe(false)
  })
})

describe('leseSeit', () => {
  it('macht aus dem Tag den UTC-Beginn dieses Tages', () => {
    // Einschliesslich und in UTC (R12): publiziert_am traegt eine Zone, und
    // ein blosser Datums-String wuerde die Grenze der Zeitzonen-Auffassung der
    // Datenbank ueberlassen.
    expect(leseSeit('2026-09-01')).toEqual({
      ok: true,
      wert: '2026-09-01T00:00:00.000Z'
    })
    expect(leseSeit(undefined)).toEqual({ ok: true, wert: null })
  })

  it('weist ab, was kein Tag ist — auch wenn es wie einer aussieht', () => {
    // 2026-02-30 passt aufs Muster und ist kein Tag; JavaScript rollt es
    // stillschweigend auf den 2. Maerz.
    for (const roh of [
      '2026-02-30',
      '2026-13-01',
      '2026-00-10',
      '03.09.2026',
      '2026-9-1',
      'heute'
    ]) {
      const gelesen = leseSeit(roh)
      expect(gelesen.ok, `seit=${roh}`).toBe(false)
    }
  })

  it('nimmt den Schalttag eines Schaltjahres', () => {
    expect(leseSeit('2028-02-29').ok).toBe(true)
    expect(leseSeit('2026-02-29').ok).toBe(false)
  })
})

describe('istKennung', () => {
  it('erkennt eine UUID', () => {
    expect(istKennung('5fccac71-45ac-4529-ad60-d061defa4a61')).toBe(true)
    expect(istKennung('5FCCAC71-45AC-4529-AD60-D061DEFA4A61')).toBe(true)
  })

  // Vor der Abfrage geprueft: eine Nicht-UUID im UUID-Filter laesst Postgres
  // werfen, und ein Tippfehler des Abnehmers darf nie ein 500 werden.
  it('weist alles ab, was Postgres zum Werfen braechte', () => {
    for (const roh of ['abc', '', undefined, '1; drop table meldungen', 42]) {
      expect(istKennung(roh), String(roh)).toBe(false)
    }
  })
})
