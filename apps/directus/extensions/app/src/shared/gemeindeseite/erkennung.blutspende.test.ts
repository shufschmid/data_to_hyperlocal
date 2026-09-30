import { describe, expect, it } from 'vitest'
import { detailFamilie, erkennePlattform, listenArt } from './erkennung'

// Der Fingerabdruck ist die Seite, nicht der Host: der Container der mobilen
// Termine plus das Suchformular. Ein Gemeindekalender traegt beides nicht.
describe('erkennePlattform — blutspende.ch', () => {
  it('braucht Container UND Suchformular', () => {
    expect(
      erkennePlattform(
        '<form action="/de/blutspendetermine"><input name="location_search_form[term]"></form><div id="mobile_venue_appointments"><ul class="no-bullets"></ul></div>'
      )
    ).toBe('blutspende_termine')
    expect(
      erkennePlattform('<div id="mobile_venue_appointments"></div>')
    ).toBeNull()
    expect(
      erkennePlattform('<input name="location_search_form[term]">')
    ).toBeNull()
    expect(listenArt('blutspende_termine')).toBe('termin')
    expect(detailFamilie('blutspende_termine')).toBe('blutspende')
  })
})
