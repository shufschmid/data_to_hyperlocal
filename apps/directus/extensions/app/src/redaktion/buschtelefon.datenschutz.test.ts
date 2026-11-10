import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BUSCHTELEFON_QUELLE_NAME,
  projektion,
  pruefsiegel,
  quelleVon,
  rubrikVon,
  type Rohzeile
} from '../endpoints/api/projektion'
import { REGISTER } from '../endpoints/api/register'
import { datengrundlageVon } from './buschtelefon'

// The Buschtelefon's raw finds come from private persons. These tests hold
// the rule that makes the desk acceptable: nothing of a raw find is readable
// by the public or by the Dorfkoenig role, and nothing of it leaves through
// the open door `/api/v1` — only a Meldung an editor wrote, released and
// published does, and even that without group, account or link of the post.
// The checks read the same files Directus is configured from.

const BUNDLE = join(__dirname, '..', '..')
const DIRECTUS = join(BUNDLE, '..', '..')
const lies = (pfad: string): string => readFileSync(pfad, 'utf8')
const json = <T>(pfad: string): T => JSON.parse(lies(pfad)) as T

interface Permission {
  collection: string
  action: string
  fields: string[] | null
  permissions: unknown
  policy: string
}
interface Policy {
  name: string
  admin_access: boolean
  _syncId: string
}

const PERMISSIONS = json<Permission[]>(
  join(DIRECTUS, 'schema', 'collections', 'permissions.json')
)
const POLICIES = json<Policy[]>(
  join(DIRECTUS, 'schema', 'collections', 'policies.json')
)
const OEFFENTLICH = '_sync_default_public_policy'

describe('Berechtigungen: die Sammlung ist für niemanden ausser Administratoren lesbar', () => {
  it('kennt die Sammlung im Schema', () => {
    const sammlung = json<{ collection: string }>(
      join(
        DIRECTUS,
        'schema',
        'snapshot',
        'collections',
        'buschtelefon_funde.json'
      )
    )
    expect(sammlung.collection).toBe('buschtelefon_funde')
  })

  it('führt keine Berechtigungszeile — für keine Richtlinie — auf die Sammlung', () => {
    expect(
      PERMISSIONS.filter((p) => p.collection === 'buschtelefon_funde')
    ).toEqual([])
  })

  it('gibt der öffentlichen Rolle gar nichts', () => {
    expect(PERMISSIONS.filter((p) => p.policy === OEFFENTLICH)).toEqual([])
    const oeffentlich = POLICIES.find((p) => p._syncId === OEFFENTLICH)
    expect(oeffentlich?.admin_access).toBe(false)
  })

  it('lässt nur Administratoren und die Dorfkönig-Richtlinie überhaupt Rechte haben', () => {
    const mitRechten = new Set(PERMISSIONS.map((p) => p.policy))
    for (const id of mitRechten) {
      const richtlinie = POLICIES.find((p) => p._syncId === id)
      expect(richtlinie?.name).toMatch(/Dorfkoenig/)
    }
  })

  it('zeigt dem Dorfkönig die Verknüpfung zum Fund nicht, und keine Zeile hat Platzhalterfelder', () => {
    for (const p of PERMISSIONS) {
      expect(p.fields, `${p.collection}/${p.action}`).not.toBeNull()
      expect(p.fields).not.toContain('*')
      expect(p.fields).not.toContain('buschtelefon_fund')
    }
  })

  it('lässt den Dorfkönig Meldungen nur im Status «publiziert» lesen', () => {
    const meldungen = PERMISSIONS.filter((p) => p.collection === 'meldungen')
    expect(meldungen.length).toBeGreaterThan(0)
    for (const p of meldungen) {
      expect(p.permissions).toEqual({ status: { _eq: 'publiziert' } })
    }
  })
})

describe('Die offene Tür /api/v1 kennt die Rohfunde nicht', () => {
  const quelltext = lies(join(BUNDLE, 'src', 'endpoints', 'api', 'index.ts'))

  it('liest nie die Sammlung der Funde und nie eines ihrer Felder', () => {
    expect(quelltext).not.toMatch(/buschtelefon_funde/)
    // The field list names the relation's id (to tell the rubrik) — never a
    // nested field of the find.
    expect(quelltext).not.toMatch(/buschtelefon_fund\./)
  })

  it('hat keine Route, die nach den Funden heisst', () => {
    expect(JSON.stringify(REGISTER)).not.toMatch(/buschtelefon/i)
  })
})

describe('Was von einer veröffentlichten Buschtelefon-Meldung die Tür verlässt', () => {
  // A published article that grew from a find — with the NASTIEST
  // `datengrundlage` an administrator could have left behind by hand.
  const GRUPPE = 'Facebook-Gruppe Musterdorf'
  const LINK =
    'https://www.facebook.com/groups/1234567890/posts/9990000000000201/'
  const zeile = (ueber: Partial<Rohzeile> = {}): Rohzeile => ({
    id: 'a1b2c3d4-0000-4000-8000-000000000009',
    titel: 'Münchenstein: Hauptstrasse gesperrt',
    lead: 'Wie in sozialen Netzwerken berichtet wird, ist die Hauptstrasse noch zu.',
    text: 'Busse werden umgeleitet. Die Angaben sind nicht bestätigt.',
    publiziert_am: '2026-11-10T06:30:00.000Z',
    erscheint_am: null,
    perle: null,
    lauf: null,
    kandidat: null,
    sendungskandidat: null,
    suedanflugquote: null,
    abstimmung: null,
    amtsblattmeldung: null,
    gemeindemitteilung: null,
    veranstaltung: null,
    kantonsmitteilung: null,
    buschtelefon_fund: 'f0f0f0f0-0000-4000-8000-000000000001',
    spiel: null,
    gemeinde: { id: 'g-1', name: 'Münchenstein', bfs_nummer: 2769 },
    datengrundlage: {
      quelle: 'buschtelefon',
      quelle_name: GRUPPE,
      url: LINK,
      fund_link: LINK,
      fund_kennung: 'fb:9990000000000201'
    },
    zeit_warnungen: null,
    entscheidung: null,
    freigegeben_am: null,
    publiziert_durch: 'redaktion',
    ...ueber
  })

  it('erscheint unter der bestehenden Rubrik «gemeinde»', () => {
    expect(rubrikVon(zeile())).toBe('gemeinde')
  })

  it('trägt immer die allgemeine Quelle, ohne Adresse, was auch in der Datengrundlage steht', () => {
    const q = quelleVon(zeile(), 'gemeinde')
    expect(q).toEqual({ name: BUSCHTELEFON_QUELLE_NAME, url: null })
  })

  it('liefert weder Gruppe noch Link noch Kennung noch die Fund-Verknüpfung aus', () => {
    const z = zeile()
    const ausgabe = JSON.stringify({
      artikel: projektion(z),
      siegel: pruefsiegel(z)
    })
    expect(ausgabe).not.toContain(GRUPPE)
    expect(ausgabe).not.toContain('facebook.com')
    expect(ausgabe).not.toContain('9990000000000201')
    expect(ausgabe).not.toContain('f0f0f0f0')
    expect(ausgabe).not.toMatch(/datengrundlage|buschtelefon_fund/)
    expect(ausgabe).toContain(BUSCHTELEFON_QUELLE_NAME)
  })

  it('schreibt der Schreiber selbst nichts in die Datengrundlage, was ein Dorfkönig-Token lesen dürfte', () => {
    // Directus' items door lets the Dorfkoenig role read `datengrundlage` of
    // published articles (permissions.json). Hence only the generic source.
    expect(JSON.stringify(datengrundlageVon())).not.toMatch(
      /facebook|http|fb:|Gruppe/i
    )
  })
})
