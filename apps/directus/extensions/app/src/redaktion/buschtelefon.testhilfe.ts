// Test helpers of the Buschtelefon desk — an in-memory stand-in for the
// Directus services, a door that answers from fixtures and a model that
// answers what a test tells it to. Imported by the desk's tests only.

import type Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MessageSender } from '../shared/claude'
import type { FetchLike } from '../shared/buschtelefon/client'

type Zeile = Record<string, unknown>
type Query = Record<string, unknown>

export function fixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      join(__dirname, '..', 'shared', 'buschtelefon', 'fixtures', name),
      'utf8'
    )
  ) as Record<string, unknown>
}

function passt(wert: unknown, bedingung: unknown): boolean {
  if (typeof bedingung !== 'object' || bedingung === null) return true
  for (const [op, soll] of Object.entries(bedingung as Zeile)) {
    if (op === '_eq' && wert !== soll) return false
    if (op === '_neq' && wert === soll) return false
    if (op === '_in' && !(soll as unknown[]).includes(wert)) return false
    if (op === '_nin' && (soll as unknown[]).includes(wert)) return false
    if (op === '_null' && (wert === null || wert === undefined) !== soll)
      return false
    if (op === '_nnull' && (wert !== null && wert !== undefined) !== soll)
      return false
  }
  return true
}

export interface Sammlung {
  zeilen: Zeile[]
  /** Every write, in order — `['create', id]` or `['update', id, payload]`. */
  protokoll: Array<[string, string, Zeile?]>
  readByQuery(query: Query): Promise<Zeile[]>
  createOne(payload: Zeile): Promise<string>
  updateOne(id: string, payload: Zeile): Promise<string>
  finde(id: string): Zeile
}

/**
 * A collection in memory. `erweitere` names m2o fields that a query asking
 * for `feld.id` gets back as an object — what Directus does with a dotted
 * field list.
 */
export function sammlung(
  name: string,
  start: Zeile[] = [],
  erweitere: Record<string, Zeile[]> = {},
  stoerung: (payload: Zeile) => void = () => undefined
): Sammlung {
  const zeilen = start.map((z) => ({ ...z }))
  const protokoll: Sammlung['protokoll'] = []
  let zaehler = 0
  return {
    zeilen,
    protokoll,
    readByQuery: async (query) => {
      const filter = (query['filter'] ?? {}) as Zeile
      const felder = (query['fields'] ?? []) as string[]
      return zeilen
        .filter((z) =>
          Object.entries(filter).every(([feld, b]) => passt(z[feld], b))
        )
        .map((z) => {
          const kopie = { ...z }
          for (const [feld, ziel] of Object.entries(erweitere)) {
            if (!felder.some((f) => f.startsWith(`${feld}.`))) continue
            kopie[feld] =
              z[feld] === null || z[feld] === undefined
                ? null
                : (ziel.find((g) => g['id'] === z[feld]) ?? null)
          }
          return kopie
        })
    },
    createOne: async (payload) => {
      stoerung(payload)
      zaehler += 1
      const id = `${name}-${zaehler}`
      zeilen.push({ date_created: null, date_updated: null, ...payload, id })
      protokoll.push(['create', id])
      return id
    },
    updateOne: async (id, payload) => {
      const zeile = zeilen.find((z) => z['id'] === id)
      if (zeile === undefined) throw new Error(`${name}: ${id} fehlt`)
      Object.assign(zeile, payload)
      protokoll.push(['update', id, payload])
      return id
    },
    finde: (id) => {
      const zeile = zeilen.find((z) => z['id'] === id)
      if (zeile === undefined) throw new Error(`${name}: ${id} fehlt`)
      return zeile
    }
  }
}

function nachricht(text: string): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 }
  } as unknown as Anthropic.Message
}

function frageAus(body: Anthropic.MessageCreateParamsNonStreaming): string {
  const inhalt = body.messages[body.messages.length - 1]?.content
  return typeof inhalt === 'string' ? inhalt : JSON.stringify(inhalt)
}

function systemAus(body: Anthropic.MessageCreateParamsNonStreaming): string {
  return typeof body.system === 'string'
    ? body.system
    : JSON.stringify(body.system ?? '')
}

export interface Modell {
  send: MessageSender
  /** The user turns it was asked, in order, tagged by kind. */
  aufrufe: Array<{ art: 'sichtung' | 'meldung'; prompt: string }>
}

export const SAUBERE_MELDUNG = {
  titel: 'Musterdorf: Hinweis aus einer Facebook-Gruppe',
  lead: 'In einer Facebook-Gruppe wird über ein Ereignis im Dorf berichtet.',
  text: 'Die Angaben stammen aus einem Beitrag in der Gruppe und sind nicht unabhängig bestätigt.',
  bedenken: null
}

/**
 * A model that grades and writes as told. `stufe` gets the entry's text and
 * its number; `meldung` gets the user turn and the number of the writer
 * call, and returns the answer object (or throws).
 */
export function modell(
  optionen: {
    stufe?: (eintrag: string, nummer: number) => number
    meldung?: (prompt: string, aufruf: number) => unknown
  } = {}
): Modell {
  const aufrufe: Modell['aufrufe'] = []
  let schreibAufrufe = 0
  const send: MessageSender = async (body) => {
    const frage = frageAus(body)
    if (systemAus(body).includes('Du sichtest')) {
      aufrufe.push({ art: 'sichtung', prompt: frage })
      const eintraege = frage.split(/\n(?=\d+\. \[)/).slice(1)
      return nachricht(
        JSON.stringify({
          urteile: eintraege.map((eintrag, i) => ({
            nummer: i + 1,
            stufe: (optionen.stufe ?? (() => 3))(eintrag, i + 1),
            begruendung: 'Betrifft viele im Dorf.',
            empfehlung: null,
            empfehlung_regel: null
          }))
        })
      )
    }
    aufrufe.push({ art: 'meldung', prompt: frage })
    schreibAufrufe += 1
    const antwort = (optionen.meldung ?? (() => SAUBERE_MELDUNG))(
      frage,
      schreibAufrufe
    )
    return nachricht(JSON.stringify(antwort))
  }
  return { send, aufrufe }
}

export interface Tuer {
  fetchImpl: FetchLike
  urls: string[]
}

/**
 * The door. `funde` answers one `/funde` request from its `nach` (null when
 * the request carries none) — an object is the JSON body, a `[status, body]`
 * pair an error. `quellen` likewise for `/quellen`.
 */
export function tuer(
  funde: (nach: number | null, aufruf: number) => unknown,
  quellen: () => unknown = () => fixture('quellen.json')
): Tuer {
  const urls: string[] = []
  let fundAufrufe = 0
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url)
    const adresse = new URL(url)
    let antwort: unknown
    if (adresse.pathname.endsWith('/quellen')) antwort = quellen()
    else {
      fundAufrufe += 1
      const nach = adresse.searchParams.get('nach')
      antwort = funde(nach === null ? null : Number(nach), fundAufrufe)
    }
    const [status, koerper] =
      Array.isArray(antwort) && typeof antwort[0] === 'number'
        ? (antwort as [number, unknown])
        : [200, antwort]
    return {
      status,
      headers: {
        get: (kopf: string) =>
          kopf.toLowerCase() === 'content-type' ? 'application/json' : null
      },
      text: async () => JSON.stringify(koerper)
    }
  }
  return { fetchImpl, urls }
}

export const ZUGANG_ENV = {
  BUSCHTELEFON_CF_CLIENT_ID: 'kennung',
  BUSCHTELEFON_CF_CLIENT_SECRET: 'geheim',
  BUSCHTELEFON_SCHLUESSEL: 'schluessel'
} as unknown as NodeJS.ProcessEnv

export const STILL = { info: () => undefined, warn: () => undefined }
