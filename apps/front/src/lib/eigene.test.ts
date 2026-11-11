import { ERGAENZUNG_MAX_ZEICHEN, fehlendes, koerperAus, LEERE_EINGABE, TITEL_MAX_ZEICHEN } from './eigene'

describe('fehlendes', () => {
  it('verlangt im Ergänzen-Modus nur die Angaben', () => {
    expect(fehlendes('ergaenzen', LEERE_EINGABE)).toBe('Die ergänzenden Angaben fehlen.')
    expect(fehlendes('ergaenzen', { ...LEERE_EINGABE, ergaenzung: '  Jahresshow des TV  ' })).toBeNull()
  })

  it('nennt die Grenze der Angaben, bevor der Server sie nennt', () => {
    expect(
      fehlendes('ergaenzen', { ...LEERE_EINGABE, ergaenzung: 'x'.repeat(ERGAENZUNG_MAX_ZEICHEN + 1) })
    ).toContain('zu lang')
  })

  it('verlangt im Selbst-Modus Titel, Lead und Text — in dieser Reihenfolge', () => {
    expect(fehlendes('selbst', LEERE_EINGABE)).toBe('Der Titel fehlt.')
    expect(fehlendes('selbst', { ...LEERE_EINGABE, titel: 'Turnerobe' })).toContain('Lead fehlt')
    expect(fehlendes('selbst', { ...LEERE_EINGABE, titel: 'Turnerobe', lead: 'L' })).toBe('Der Text fehlt.')
    expect(fehlendes('selbst', { ...LEERE_EINGABE, titel: 'Turnerobe', lead: 'L', text: 'T' })).toBeNull()
  })

  it('nennt die Breite der Titelspalte', () => {
    expect(
      fehlendes('selbst', {
        ...LEERE_EINGABE,
        titel: 'x'.repeat(TITEL_MAX_ZEICHEN + 1),
        lead: 'L',
        text: 'T'
      })
    ).toContain('zu lang')
  })
})

describe('koerperAus', () => {
  it('ist null, solange etwas fehlt', () => {
    expect(koerperAus('ergaenzen', LEERE_EINGABE)).toBeNull()
    expect(koerperAus('selbst', { ...LEERE_EINGABE, titel: 'T' })).toBeNull()
  })

  it('schickt im Ergänzen-Modus nur die Angaben, beschnitten', () => {
    expect(koerperAus('ergaenzen', { ...LEERE_EINGABE, ergaenzung: ' Jahresshow ', titel: 'egal' })).toEqual({
      ergaenzung: 'Jahresshow'
    })
  })

  it('schickt im Selbst-Modus die drei Teile, beschnitten', () => {
    expect(
      koerperAus('selbst', { ergaenzung: 'egal', titel: ' Turnerobe ', lead: ' Lead. ', text: ' Text. ' })
    ).toEqual({ eigene: { titel: 'Turnerobe', lead: 'Lead.', text: 'Text.' } })
  })
})
