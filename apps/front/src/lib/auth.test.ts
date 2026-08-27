import { istTokenProblem } from './auth'

// Die Statuscodes sind gegen Directus 11 gemessen, nicht angenommen: fehlender,
// kaputter und abgelaufener Token ergeben 401, ein nicht verifizierbarer Token
// ergibt 403 INVALID_TOKEN.

const INVALID_TOKEN = JSON.stringify({
  errors: [{ message: 'Invalid token.', extensions: { code: 'INVALID_TOKEN' } }]
})
const FORBIDDEN = JSON.stringify({
  errors: [{ message: 'Nicht gefunden oder nicht freigegeben.', extensions: { code: 'FORBIDDEN' } }]
})

describe('istTokenProblem', () => {
  it('behandelt jeden 401 als Token-Problem', () => {
    expect(istTokenProblem(401, '{"errors":[{"message":"Nicht angemeldet."}]}')).toBe(true)
    expect(istTokenProblem(401, '')).toBe(true)
  })

  it('erkennt den 403, den ein nicht verifizierbarer Token ausloest', () => {
    expect(istTokenProblem(403, INVALID_TOKEN)).toBe(true)
  })

  it('laesst den 403 der Erweiterung in Ruhe — sonst fliegt die Redaktorin bei einem unsichtbaren Datensatz raus', () => {
    expect(istTokenProblem(403, FORBIDDEN)).toBe(false)
  })

  it('haelt erfolgreiche und andere Antworten heraus', () => {
    expect(istTokenProblem(200, '{"data":{}}')).toBe(false)
    expect(istTokenProblem(404, '{"errors":[]}')).toBe(false)
    expect(istTokenProblem(500, '')).toBe(false)
    // Der Code muss der Fehlercode sein, nicht irgendein Wort im Text.
    expect(istTokenProblem(403, '{"errors":[{"message":"INVALID_TOKEN erwaehnt"}]}')).toBe(false)
  })
})
