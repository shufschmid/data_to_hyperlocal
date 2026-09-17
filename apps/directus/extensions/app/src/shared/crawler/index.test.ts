import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scrape } from './index'

function antwort(daten: unknown): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(daten), { status: 200 })
  ) as unknown as typeof fetch
}

describe('scrape', () => {
  const env = { ...process.env }
  beforeEach(() => {
    process.env['CRAWLER_URL'] = 'https://crawler.example'
    process.env['CRAWLER_KEY'] = 'k'
  })
  afterEach(() => {
    process.env = { ...env }
  })

  it('liefert das HTML, wenn es verlangt war, und meldet einen Schnitt je Format', async () => {
    const ergebnis = await scrape('https://www.example.ch/a', {
      formats: ['html'],
      fetchImpl: antwort({
        success: true,
        data: {
          html: '<html>da</html>',
          metadata: {
            renderer: 'httpx',
            statusCode: 200,
            truncation: { html: true }
          }
        }
      })
    })
    expect(ergebnis.html).toBe('<html>da</html>')
    expect(ergebnis.markdown).toBe('')
    expect(ergebnis.abgeschnitten).toBe(true)
  })

  it('ein Host, den der Crawler nicht erreichte, ist kein leeres Blatt, sondern ein Fehler mit diesem Namen', async () => {
    await expect(
      scrape('https://www.example.ch/a', {
        formats: ['html'],
        fetchImpl: antwort({
          success: true,
          data: {
            html: '',
            markdown: '',
            metadata: { renderer: 'none', statusCode: null, contentLength: 0 }
          }
        })
      })
    ).rejects.toThrow(/erreichte die Seite nicht/)
  })

  it('eine leere Seite bleibt ein Fehler', async () => {
    await expect(
      scrape('https://www.example.ch/a', {
        formats: ['html'],
        fetchImpl: antwort({
          success: true,
          data: { html: '  ', metadata: { renderer: 'httpx', statusCode: 200 } }
        })
      })
    ).rejects.toThrow(/leere Seite/)
  })
})
