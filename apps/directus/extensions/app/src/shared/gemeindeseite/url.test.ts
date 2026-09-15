import { describe, expect, it } from 'vitest'
import {
  gleicheSite,
  istDokumentAdresse,
  istEigeneSeite,
  istPdfAdresse,
  normalisiereUrl
} from './url'

describe('normalisiereUrl', () => {
  it('macht relative Links absolut und einheitlich', () => {
    expect(
      normalisiereUrl(
        '/aktuelles/meldungen/Trickbetrueger.php',
        'https://www.riehen.ch/aktuelles/'
      )
    ).toBe('https://www.riehen.ch/aktuelles/meldungen/Trickbetrueger.php')
    expect(
      normalisiereUrl(
        'http://WWW.Binningen.ch/de/news.html/106/news/6797#top',
        'https://www.binningen.ch/'
      )
    ).toBe('https://www.binningen.ch/de/news.html/106/news/6797')
  })

  it('laesst den Query-String byteidentisch — allschwils Kategorie-Filter muss ueberleben', () => {
    expect(
      normalisiereUrl(
        'https://www.allschwil.ch/de/aktuelles/?categories[]=1177055180125',
        'https://www.allschwil.ch/'
      )
    ).toBe('https://www.allschwil.ch/de/aktuelles?categories[]=1177055180125')
  })

  it('entfernt Tracking-Parameter, sonst nichts', () => {
    expect(
      normalisiereUrl(
        'https://www.aesch.bl.ch/_rte/information/1?utm_source=x&id=2&fbclid=abc',
        'https://www.aesch.bl.ch/'
      )
    ).toBe('https://www.aesch.bl.ch/_rte/information/1?id=2')
    expect(
      normalisiereUrl(
        'https://www.aesch.bl.ch/a?utm_source=x',
        'https://www.aesch.bl.ch/'
      )
    ).toBe('https://www.aesch.bl.ch/a')
  })

  it('laesst den Schraegstrich der Wurzel stehen und wirft alles ab, was kein Web-Link ist', () => {
    expect(normalisiereUrl('/', 'https://www.riehen.ch/aktuelles/')).toBe(
      'https://www.riehen.ch/'
    )
    expect(
      normalisiereUrl('mailto:gemeinde@riehen.ch', 'https://www.riehen.ch/')
    ).toBeNull()
    expect(
      normalisiereUrl('javascript:history.back()', 'https://www.riehen.ch/')
    ).toBeNull()
    expect(normalisiereUrl('https://', 'https://www.riehen.ch/')).toBeNull()
  })
})

describe('gleicheSite', () => {
  it('ignoriert ein fuehrendes www und akzeptiert Hosts wie ganze Adressen', () => {
    expect(gleicheSite('www.riehen.ch', 'riehen.ch')).toBe(true)
    expect(gleicheSite('https://www.riehen.ch/aktuelles/', 'riehen.ch')).toBe(
      true
    )
    expect(gleicheSite('www.riehen.ch', 'www.bs.ch')).toBe(false)
    expect(gleicheSite('', '')).toBe(false)
  })
})

describe('Dokumente', () => {
  it('erkennt PDFs auch mit Query-String und i-webs /_doc/-Tuer', () => {
    expect(istPdfAdresse('https://x.ch/a/b.pdf?x=1')).toBe(true)
    expect(istPdfAdresse('https://x.ch/a/b.php')).toBe(false)
    expect(
      istDokumentAdresse('https://www.muenchenstein.ch/_doc/7217551')
    ).toBe(true)
    expect(istDokumentAdresse('https://x.ch/a/Protokoll.docx')).toBe(true)
    expect(istDokumentAdresse('https://x.ch/a/seite.html')).toBe(false)
  })

  it('haelt Selbstlinks einer Seite von den Anhaengen fern', () => {
    const seite =
      'https://www.binningen.ch/de/gemeinde/news-und-medien/news.html/106/news/6797'
    expect(istEigeneSeite(`${seite}/print/pdf`, seite)).toBe(true)
    expect(
      istEigeneSeite('https://www.binningen.ch/de/dokumente/x.pdf', seite)
    ).toBe(false)
    expect(
      istEigeneSeite(
        'https://www.bs.ch/de/gemeinde/news-und-medien/news.html/106/news/6797/print/pdf',
        seite
      )
    ).toBe(false)
  })
})
