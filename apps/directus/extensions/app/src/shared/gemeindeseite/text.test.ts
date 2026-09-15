import { describe, expect, it } from 'vitest'
import {
  blockZuText,
  entferneElemente,
  kappe,
  reinerText,
  schneideElement
} from './text'

describe('schneideElement', () => {
  it('findet das Ende eines Elements trotz gleichnamiger Kinder', () => {
    const html =
      '<p>vor</p><div class="a"><div>innen <div>tiefer</div></div> ende</div><div>danach</div>'
    expect(schneideElement(html, html.indexOf('<div class="a">'))).toBe(
      '<div>innen <div>tiefer</div></div> ende'
    )
  })

  it('liefert leer fuer selbstschliessende Elemente und den Rest bei fehlendem Ende', () => {
    expect(schneideElement('<img src="x"/>', 0)).toBe('')
    expect(schneideElement('<div>offen<div>', 0)).toBe('offen<div>')
  })
})

describe('blockZuText', () => {
  it('macht Absaetze, Listen und Bildlegenden lesbar', () => {
    const html =
      '<div><p>Erster&nbsp;Absatz mit <strong>Fett</strong>.</p><ul><li>Punkt eins</li><li>Punkt <em>zwei</em></li></ul>' +
      '<figure><img src="x"/><figcaption>Der Platz</figcaption></figure><p>Zeile 1<br/>Zeile 2</p></div>'
    expect(blockZuText(html)).toBe(
      'Erster Absatz mit Fett.\n\n– Punkt eins\n– Punkt zwei\n\nBild: Der Platz\n\nZeile 1\nZeile 2'
    )
  })

  it('behandelt Zeilenumbrueche im Quelltext als Leerzeichen und wirft Skripte weg', () => {
    const html =
      '<p>eine verheerende\nSturzflut</p><script>document.write("<div class=\\"x\\">Zurück")</script><p>Ende</p>'
    expect(blockZuText(html)).toBe('eine verheerende Sturzflut\n\nEnde')
  })

  it('loest Entities auf und laesst Guillemets stehen', () => {
    expect(
      blockZuText(
        '<p>«Mission Blaulicht» &amp; Co. l&auml;dt &#39;ein&#39;</p>'
      )
    ).toBe("«Mission Blaulicht» & Co. lädt 'ein'")
  })
})

describe('entferneElemente', () => {
  it('nimmt ein Element samt Kindern nach Klasse heraus', () => {
    const html =
      '<div><p>bleibt</p><div class="elementLink elementLinkBack"><a href="#">Zurück</a></div><p>auch</p></div>'
    expect(blockZuText(entferneElemente(html, 'elementLinkBack'))).toBe(
      'bleibt\n\nauch'
    )
  })
})

describe('reinerText', () => {
  it('macht aus einem Fragment eine Zeile', () => {
    expect(
      reinerText(
        '  <span class="listEntryDate">08.09.2026</span>\n  Blaulichttag&nbsp;der <b>Feuerwehr</b>\n'
      )
    ).toBe('08.09.2026 Blaulichttag der Feuerwehr')
  })
})

describe('kappe', () => {
  it('schneidet an einer Absatzgrenze und sagt es', () => {
    const text = `${'a'.repeat(50)}\n\n${'b'.repeat(50)}\n\n${'c'.repeat(50)}`
    const ergebnis = kappe(text, 120)
    expect(ergebnis.abgeschnitten).toBe(true)
    expect(ergebnis.text).toBe(
      `${'a'.repeat(50)}\n\n${'b'.repeat(50)} … [Text gekürzt]`
    )
  })

  it('laesst kurze Texte unangetastet und schneidet hart, wenn keine Grenze nah ist', () => {
    expect(kappe('kurz', 10)).toEqual({ text: 'kurz', abgeschnitten: false })
    const lang = 'x'.repeat(200)
    expect(kappe(lang, 100).text).toBe(`${'x'.repeat(100)} … [Text gekürzt]`)
  })
})
