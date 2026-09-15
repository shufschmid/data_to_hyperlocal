import { cookieOptionen, erlaubteUrspruenge, rahmenKopfzeilen } from './einbettung'

describe('erlaubteUrspruenge', () => {
  it('nimmt mehrere Ursprünge, durch Leerraum getrennt', () => {
    expect(erlaubteUrspruenge('https://editor.bajour.ch https://bajour.wepublish.cloud')).toEqual([
      'https://editor.bajour.ch',
      'https://bajour.wepublish.cloud'
    ])
  })

  it('nimmt auch Kommas und mehrfachen Leerraum', () => {
    expect(erlaubteUrspruenge(' https://a.ch ,\n https://b.ch ')).toEqual(['https://a.ch', 'https://b.ch'])
  })

  it('wirft weg, was kein https-Ursprung ist', () => {
    // http, ein Pfad, ein Stern, blosser Text: alles vier ist kein Ursprung,
    // den man in eine CSP schreiben darf.
    expect(
      erlaubteUrspruenge('http://editor.bajour.ch https://gut.ch/pfad * editor.bajour.ch https://gut.ch')
    ).toEqual(['https://gut.ch'])
  })

  it('ist bei leer leer', () => {
    expect(erlaubteUrspruenge('')).toEqual([])
    expect(erlaubteUrspruenge('   ')).toEqual([])
  })
})

describe('rahmenKopfzeilen', () => {
  it('bleibt ohne Einbettung bei X-Frame-Options', () => {
    expect(rahmenKopfzeilen('')).toEqual([{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }])
  })

  it('setzt eine CSP und laesst X-Frame-Options weg', () => {
    // Beide zusammen widersprechen sich: moderne Browser folgen der CSP, der
    // alte Kopf verwirrt nur.
    expect(rahmenKopfzeilen('https://editor.bajour.ch https://bajour.wepublish.cloud')).toEqual([
      {
        key: 'Content-Security-Policy',
        value: "frame-ancestors 'self' https://editor.bajour.ch https://bajour.wepublish.cloud"
      }
    ])
  })

  it('faellt auf X-Frame-Options zurueck, wenn kein Ursprung gueltig war', () => {
    expect(rahmenKopfzeilen('http://unsicher.ch')).toEqual([{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }])
  })
})

describe('cookieOptionen', () => {
  it('bleibt ohne Einbettung bei lax', () => {
    expect(cookieOptionen('', true)).toEqual({ sameSite: 'lax', secure: true })
  })

  it('wird im fremden Rahmen none und damit zwingend secure', () => {
    // Im iframe geht es nicht anders: bei lax schickt der Browser das Cookie
    // gar nicht erst mit.
    expect(cookieOptionen('https://editor.bajour.ch', true)).toEqual({ sameSite: 'none', secure: true })
  })

  it('erzwingt secure auch in der Entwicklung, sobald none gilt', () => {
    // SameSite=None ohne Secure wird vom Browser verworfen. Lieber ein Cookie,
    // das lokal ueber http nicht ankommt, als eines, das gar nicht gesetzt wird.
    expect(cookieOptionen('https://editor.bajour.ch', false)).toEqual({ sameSite: 'none', secure: true })
  })

  it('bleibt bei lax, wenn die Liste nur Unbrauchbares enthaelt', () => {
    expect(cookieOptionen('http://unsicher.ch', false)).toEqual({ sameSite: 'lax', secure: false })
  })
})
