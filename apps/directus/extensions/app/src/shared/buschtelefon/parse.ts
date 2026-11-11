// The pure reader of the Buschtelefon door's answers (`buschtelefon-redaktion/2`).
//
// Four rules shape it, and each answers a defect of the first attempt.
//
// ONE FIND NEVER COSTS THE FEED. Validation per find does not throw: a find
// this side cannot accept is NAMED in `ungueltig` with its `folge`, so the
// bookmark can pass it. In v1 a single unstorable find held the whole read
// back for as long as the door kept it.
//
// NOTHING IS GUESSED. An unknown enum value keeps the find (or, inside a
// find, the one image, link or comment) out, with a reason — it is never
// mapped onto the nearest known value. A field the contract does not know is
// ignored.
//
// TOO LONG IS CUT AND DECLARED, never a reason to drop. Every cut, every
// nested entry left out and every value this side refused is a German
// sentence in the find's `kuerzungen`; the desk shows them as hints. The
// sentences name the FIELD and the reason and never a delivered value — what
// travels here is what private persons wrote.
//
// THE DOOR'S PRIVACY RULES ARE HELD A SECOND TIME, at this boundary: an
// `autor_name` without an `autor_rolle`, a first name that is more than one
// word, an image text under any status but `gelesen` and the link of a
// private person's shared post are not taken over, whatever the door sent.
//
// The exceptions are identities and addresses: a `kennung`, a `quelle` or a
// link over its limit is not cut (a truncated identity is another identity, a
// truncated address is the one error nobody can see) — the entry is invalid.

import {
  AENDERUNGEN,
  AUSGELASSEN_GRUENDE,
  AUTOR_ARTEN,
  AUTOR_ROLLEN,
  BILD_ARTEN,
  BILD_TEXT_STATUS,
  DATUM_GENAUIGKEITEN,
  ENTFERNT_GRUENDE,
  FORMAT,
  FUND_STATUS,
  GRENZEN,
  KANAELE,
  KOMMENTAR_KENNUNG_ARTEN,
  KOMMENTAR_STAENDE,
  KOMMENTARE_STAENDE,
  LINK_TEXT_STATUS,
  QUELLE_OFFEN_GRUENDE,
  QUELLEN_ARTEN,
  QUELLEN_STAENDE,
  SICHTBARKEITEN,
  ZUGAENGE,
  type Aenderung,
  type Ausgelassen,
  type AutorArt,
  type AutorRolle,
  type Bild,
  type EntfernterFund,
  type Freigabe,
  type Fund,
  type FundEintrag,
  type FundeAntwort,
  type Geteilt,
  type Kommentar,
  type Quelle,
  type QuelleOffen,
  type QuellenAntwort,
  type Ungueltig,
  type Verlinkt
} from './typen'

/** The ENVELOPE is not what the contract says — the one failure of a read that is not a find's. */
export class AntwortFormatFehler extends Error {
  constructor(meldung: string) {
    super(meldung)
    this.name = 'AntwortFormatFehler'
  }
}

/** Internal: why one find or one nested entry cannot be accepted. Never leaves this module. */
class Ungenuegend extends Error {}

type Objekt = Record<string, unknown>

function alsObjekt(wert: unknown): Objekt | null {
  return typeof wert === 'object' && wert !== null && !Array.isArray(wert)
    ? (wert as Objekt)
    : null
}

function fehlt(wert: unknown): boolean {
  return wert === undefined || wert === null
}

/** A delivered value for a message: clipped and on one line, for ENUM-like fields only — never for content. */
function gezeigt(wert: unknown): string {
  const text =
    typeof wert === 'string' ? wert : (JSON.stringify(wert) ?? String(wert))
  const einzeilig = text.replace(/\s+/g, ' ')
  return einzeilig.length > 40 ? `${einzeilig.slice(0, 40)}…` : einzeilig
}

// ── Instants and days ──────────────────────────────────────────────────────

const ZEITPUNKT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/
const TAG = /^(\d{4})-(\d{2})-(\d{2})$/

/** ISO 8601 WITH an offset (4.1). A stamp without one is ambiguous by a day and is refused. */
export function istZeitpunkt(wert: unknown): wert is string {
  return (
    typeof wert === 'string' &&
    ZEITPUNKT.test(wert) &&
    Number.isFinite(Date.parse(wert))
  )
}

/** A real calendar day, `YYYY-MM-DD`. */
export function istTag(wert: unknown): wert is string {
  if (typeof wert !== 'string') return false
  const teile = TAG.exec(wert)
  if (teile === null) return false
  const datum = new Date(
    Date.UTC(Number(teile[1]), Number(teile[2]) - 1, Number(teile[3]))
  )
  return datum.toISOString().slice(0, 10) === wert
}

const ZUERICH = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Zurich',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

/**
 * The calendar day an instant falls on IN ZURICH, `YYYY-MM-DD` — what a
 * source line prints. Never `iso.slice(0, 10)`: v1 delivered a post of 8
 * November as `2026-11-08T00:00:00+01:00`, which is 7 November 23:00 in UTC,
 * and stored in UTC and cut to the day it became the 7th.
 */
export function tagInZuerich(
  zeitpunkt: string | Date | null | undefined
): string | null {
  if (zeitpunkt === null || zeitpunkt === undefined) return null
  const zeit =
    zeitpunkt instanceof Date ? zeitpunkt.getTime() : Date.parse(zeitpunkt)
  if (!Number.isFinite(zeit)) return null
  const teile = ZUERICH.formatToParts(new Date(zeit))
  const teil = (art: string): string =>
    teile.find((t) => t.type === art)?.value ?? ''
  const tag = `${teil('year')}-${teil('month')}-${teil('day')}`
  return TAG.test(tag) ? tag : null
}

/**
 * The day a post appeared, as far as the door KNOWS it (4.3): null for
 * `unbekannt`; for `ungefaehr` only where both bounds fall on the same
 * calendar day; else the day of `veroeffentlicht_am` in Zurich.
 */
export function veroeffentlichtTag(
  fund: Pick<
    Fund,
    | 'veroeffentlicht_am'
    | 'datum_genauigkeit'
    | 'veroeffentlicht_fruehestens'
    | 'veroeffentlicht_spaetestens'
  >
): string | null {
  if (fund.datum_genauigkeit === 'unbekannt') return null
  if (fund.datum_genauigkeit === 'ungefaehr') {
    const von = tagInZuerich(fund.veroeffentlicht_fruehestens)
    const bis = tagInZuerich(fund.veroeffentlicht_spaetestens)
    return von !== null && von === bis ? von : null
  }
  return tagInZuerich(fund.veroeffentlicht_am)
}

// ── Field readers. Each throws `Ungenuegend`; the caller decides what that costs. ──

function pflichtText(o: Objekt, feld: string, grenze: number): string {
  const wert = o[feld]
  if (typeof wert !== 'string' || wert.trim() === '')
    throw new Ungenuegend(`${feld} fehlt`)
  if (wert.length > grenze)
    throw new Ungenuegend(
      `${feld} ist länger als ${grenze} Zeichen (wird nie gekürzt)`
    )
  return wert
}

function pflichtEnum<T extends string>(
  o: Objekt,
  feld: string,
  werte: readonly T[]
): T {
  const wert = o[feld]
  if (fehlt(wert)) throw new Ungenuegend(`${feld} fehlt`)
  if (typeof wert !== 'string' || !(werte as readonly string[]).includes(wert))
    throw new Ungenuegend(`${feld}: unbekannter Wert «${gezeigt(wert)}»`)
  return wert as T
}

function wahlEnum<T extends string>(
  o: Objekt,
  feld: string,
  werte: readonly T[]
): T | null {
  return fehlt(o[feld]) ? null : pflichtEnum(o, feld, werte)
}

function pflichtZeit(o: Objekt, feld: string): string {
  const wert = o[feld]
  if (fehlt(wert)) throw new Ungenuegend(`${feld} fehlt`)
  if (!istZeitpunkt(wert))
    throw new Ungenuegend(`${feld} ist kein Zeitpunkt mit Zeitzonenversatz`)
  return wert
}

function wahlZeit(o: Objekt, feld: string): string | null {
  return fehlt(o[feld]) ? null : pflichtZeit(o, feld)
}

function pflichtWahrheit(o: Objekt, feld: string): boolean {
  const wert = o[feld]
  if (typeof wert !== 'boolean')
    throw new Ungenuegend(`${feld} fehlt oder ist kein Wahrheitswert`)
  return wert
}

/** A counter: absent and null are both «not known»; anything else must be a whole number from zero. */
function wahlZahl(o: Objekt, feld: string): number | null {
  const wert = o[feld]
  if (fehlt(wert)) return null
  if (typeof wert !== 'number' || !Number.isSafeInteger(wert) || wert < 0)
    throw new Ungenuegend(`${feld} ist keine ganze Zahl ab 0`)
  return wert
}

function pflichtListe(o: Objekt, feld: string): unknown[] {
  const wert = o[feld]
  if (!Array.isArray(wert))
    throw new Ungenuegend(`${feld} fehlt oder ist keine Liste`)
  return wert
}

function istFolge(wert: unknown): wert is number {
  return typeof wert === 'number' && Number.isSafeInteger(wert) && wert > 0
}

function bfsNummern(o: Objekt): number[] {
  const liste = pflichtListe(o, 'gemeinden_bfs')
  if (
    !liste.every(
      (n): n is number =>
        typeof n === 'number' && Number.isSafeInteger(n) && n > 0
    )
  )
    throw new Ungenuegend('gemeinden_bfs enthält etwas anderes als BFS-Nummern')
  return [...new Set(liste)]
}

function istHttps(wert: string): boolean {
  return /^https:\/\/[^\s/]+/i.test(wert) && !/\s/.test(wert)
}

function istWebadresse(wert: string): boolean {
  return /^https?:\/\/[^\s/]+/i.test(wert) && !/\s/.test(wert)
}

/** Cuts at the limit — never through a surrogate pair — and declares it. */
function kuerze(
  text: string,
  grenze: number,
  was: string,
  kuerzungen: string[]
): { text: string; gekuerzt: boolean } {
  if (text.length <= grenze) return { text, gekuerzt: false }
  let ende = grenze
  const letzte = text.charCodeAt(ende - 1)
  if (letzte >= 0xd800 && letzte <= 0xdbff) ende -= 1
  kuerzungen.push(`${was} gekürzt: ${text.length} Zeichen, Grenze ${grenze}`)
  return { text: text.slice(0, ende), gekuerzt: true }
}

/** An optional short text: null where absent or blank, cut and declared where too long. */
function wahlText(
  o: Objekt,
  feld: string,
  grenze: number,
  was: string,
  kuerzungen: string[]
): string | null {
  const wert = o[feld]
  if (fehlt(wert)) return null
  if (typeof wert !== 'string') {
    kuerzungen.push(`${was}: kein Text – nicht übernommen`)
    return null
  }
  if (wert.trim() === '') return null
  return kuerze(wert, grenze, was, kuerzungen).text
}

// ── Author ─────────────────────────────────────────────────────────────────

interface Autor {
  autor_art: AutorArt
  autor_rolle: AutorRolle | null
  autor_name: string | null
  autor_vorname: string | null
  autor_ref: string | null
}

/**
 * Who wrote it, as far as it may travel (4.3). The door's own rules, held a
 * second time: a name only for an organisation from its list, a first name
 * only for a profile and only as ONE word, a placeholder never for an
 * anonymous entry. What is refused is declared without the value.
 */
function liesAutor(o: Objekt, ort: string, kuerzungen: string[]): Autor {
  const autor_art = pflichtEnum(o, 'autor_art', AUTOR_ARTEN)
  const autor_rolle = wahlEnum(o, 'autor_rolle', AUTOR_ROLLEN)

  let autor_name = wahlText(
    o,
    'autor_name',
    GRENZEN.autor_name,
    `${ort}: autor_name`,
    kuerzungen
  )
  if (autor_name !== null && autor_rolle === null) {
    kuerzungen.push(`${ort}: autor_name ohne autor_rolle – nicht übernommen`)
    autor_name = null
  }

  let autor_vorname: string | null = null
  const vorname = o['autor_vorname']
  if (typeof vorname === 'string' && vorname.trim() !== '') {
    const wort = vorname.trim()
    if (autor_art !== 'profil')
      kuerzungen.push(
        `${ort}: autor_vorname bei autor_art «${autor_art}» – nicht übernommen`
      )
    else if (/\s/.test(wort) || wort.length > GRENZEN.autor_vorname)
      kuerzungen.push(
        `${ort}: autor_vorname ist nicht ein einzelnes Wort – nicht übernommen`
      )
    else autor_vorname = wort
  } else if (!fehlt(vorname) && typeof vorname !== 'string') {
    kuerzungen.push(`${ort}: autor_vorname ist kein Text – nicht übernommen`)
  }

  let autor_ref: string | null = null
  const ref = o['autor_ref']
  if (typeof ref === 'string' && ref.trim() !== '') {
    if (autor_art === 'anonym')
      kuerzungen.push(
        `${ort}: autor_ref bei einem anonymen Eintrag – nicht übernommen`
      )
    else if (ref.trim().length > GRENZEN.autor_ref)
      kuerzungen.push(
        `${ort}: autor_ref ist länger als ${GRENZEN.autor_ref} Zeichen – nicht übernommen`
      )
    else autor_ref = ref.trim()
  }

  return { autor_art, autor_rolle, autor_name, autor_vorname, autor_ref }
}

// ── Images, links, shared post, comments ───────────────────────────────────

/** Kinds of image whose text never travels, whatever the door says (4.5, 5). */
const NIE_GELESEN: ReadonlySet<string> = new Set([
  'privatchat',
  'ausweis_dokument'
])

function liesBild(roh: unknown, ort: string, kuerzungen: string[]): Bild {
  const o = alsObjekt(roh)
  if (o === null) throw new Ungenuegend('kein Objekt')
  const nr = o['nr']
  if (typeof nr !== 'number' || !Number.isSafeInteger(nr) || nr < 1)
    throw new Ungenuegend('nr fehlt')
  const art = pflichtEnum(o, 'art', BILD_ARTEN)
  let text_status = pflichtEnum(o, 'text_status', BILD_TEXT_STATUS)
  let text_abgeschnitten = pflichtWahrheit(o, 'text_abgeschnitten')
  let text: string | null = null
  if (NIE_GELESEN.has(art) && text_status === 'gelesen') {
    // A private chat or an identity document is never read (contract 4.5 and
    // 5), whatever status the door put on it: its text stops here, the image
    // counts as deliberately not read, and the declaration names the kind,
    // never the words.
    kuerzungen.push(`${ort}: Text trotz art «${art}» – nicht übernommen`)
    text_status = 'zurueckgehalten'
    text_abgeschnitten = false
  } else if (text_status === 'gelesen') {
    if (typeof o['text'] !== 'string')
      throw new Ungenuegend('text fehlt trotz text_status «gelesen»')
    const gekuerzt = kuerze(
      o['text'],
      GRENZEN.bild_text,
      `${ort}: Bildtext`,
      kuerzungen
    )
    text = gekuerzt.text
    text_abgeschnitten = text_abgeschnitten || gekuerzt.gekuerzt
  } else if (typeof o['text'] === 'string' && o['text'].trim() !== '') {
    // `zurueckgehalten` means deliberately not read: a text under it must not travel on.
    kuerzungen.push(
      `${ort}: Text trotz text_status «${text_status}» – nicht übernommen`
    )
  }
  return {
    nr,
    art,
    text_status,
    text,
    text_abgeschnitten,
    beschreibung: wahlText(
      o,
      'beschreibung',
      GRENZEN.bild_beschreibung,
      `${ort}: Beschreibung`,
      kuerzungen
    )
  }
}

/**
 * A list of nested entries. One that cannot be read is LEFT OUT and declared
 * — it costs itself, never the find.
 */
function liesEintraege<T>(
  liste: unknown[],
  name: (nr: number) => string,
  lies: (roh: unknown, ort: string) => T,
  kuerzungen: string[]
): T[] {
  const ergebnis: T[] = []
  liste.forEach((roh, i) => {
    const ort = name(i + 1)
    try {
      ergebnis.push(lies(roh, ort))
    } catch (fehler) {
      kuerzungen.push(
        `${ort} ausgelassen: ${fehler instanceof Ungenuegend ? fehler.message : 'nicht lesbar'}`
      )
    }
  })
  return ergebnis
}

function liesBilder(o: Objekt, ort: string, kuerzungen: string[]): Bild[] {
  const vor = ort === '' ? '' : `${ort}, `
  return liesEintraege(
    pflichtListe(o, 'bilder'),
    (nr) => `${vor}Bild ${nr}`,
    (roh, wo) => liesBild(roh, wo, kuerzungen),
    kuerzungen
  )
}

function liesVerlinkt(
  roh: unknown,
  ort: string,
  kuerzungen: string[]
): Verlinkt {
  const o = alsObjekt(roh)
  if (o === null) throw new Ungenuegend('kein Objekt')
  const url = pflichtText(o, 'url', GRENZEN.link)
  if (!istWebadresse(url)) throw new Ungenuegend('url ist keine Webadresse')
  const kurzlink = pflichtWahrheit(o, 'kurzlink')
  const text_status = pflichtEnum(o, 'text_status', LINK_TEXT_STATUS)
  let text_abgeschnitten = pflichtWahrheit(o, 'text_abgeschnitten')
  let text: string | null = null
  if (text_status === 'gelesen') {
    if (typeof o['text'] !== 'string')
      throw new Ungenuegend('text fehlt trotz text_status «gelesen»')
    const gekuerzt = kuerze(
      o['text'],
      GRENZEN.verlinkt_text,
      `${ort}: Text der Zielseite`,
      kuerzungen
    )
    text = gekuerzt.text
    text_abgeschnitten = text_abgeschnitten || gekuerzt.gekuerzt
  }
  return {
    url,
    kurzlink,
    titel: wahlText(
      o,
      'titel',
      GRENZEN.verlinkt_titel,
      `${ort}: Titel`,
      kuerzungen
    ),
    text_status,
    text,
    text_abgeschnitten
  }
}

function liesVerlinkte(
  o: Objekt,
  ort: string,
  kuerzungen: string[]
): Verlinkt[] {
  const vor = ort === '' ? '' : `${ort}, `
  return liesEintraege(
    pflichtListe(o, 'verlinkt'),
    (nr) => `${vor}Link ${nr}`,
    (roh, wo) => liesVerlinkt(roh, wo, kuerzungen),
    kuerzungen
  )
}

function liesGeteilt(roh: unknown, kuerzungen: string[]): Geteilt {
  const ort = 'Geteilter Beitrag'
  const o = alsObjekt(roh)
  if (o === null) throw new Ungenuegend('kein Objekt')
  const autor = liesAutor(o, ort, kuerzungen)
  if (typeof o['text'] !== 'string') throw new Ungenuegend('text fehlt')
  const text = kuerze(o['text'], GRENZEN.text, `${ort}: Text`, kuerzungen)

  // Link and source name only for an organisation: a private person's shared
  // post keeps its text and loses its address.
  let link: string | null = null
  let quelle_name: string | null = null
  if (autor.autor_rolle === null) {
    if (!fehlt(o['link']) || !fehlt(o['quelle_name']))
      kuerzungen.push(
        `${ort}: link und quelle_name ohne autor_rolle – nicht übernommen`
      )
  } else {
    const adresse = o['link']
    if (
      typeof adresse === 'string' &&
      adresse.length <= GRENZEN.link &&
      istWebadresse(adresse)
    )
      link = adresse
    else if (!fehlt(adresse))
      kuerzungen.push(
        `${ort}: link ist keine verwendbare Adresse – nicht übernommen`
      )
    quelle_name = wahlText(
      o,
      'quelle_name',
      GRENZEN.quelle_name,
      `${ort}: quelle_name`,
      kuerzungen
    )
  }

  return {
    link,
    quelle_name,
    autor_art: autor.autor_art,
    autor_rolle: autor.autor_rolle,
    autor_name: autor.autor_name,
    veroeffentlicht_am: wahlZeit(o, 'veroeffentlicht_am'),
    datum_genauigkeit: pflichtEnum(o, 'datum_genauigkeit', DATUM_GENAUIGKEITEN),
    text: text.text,
    text_abgeschnitten:
      pflichtWahrheit(o, 'text_abgeschnitten') || text.gekuerzt,
    bilder: liesBilder(o, ort, kuerzungen),
    n_bilder: wahlZahl(o, 'n_bilder'),
    verlinkt: liesVerlinkte(o, ort, kuerzungen)
  }
}

function liesKommentar(
  roh: unknown,
  ort: string,
  kuerzungen: string[]
): Kommentar {
  const o = alsObjekt(roh)
  if (o === null) throw new Ungenuegend('kein Objekt')
  const kennung = pflichtText(o, 'kennung', GRENZEN.kennung)
  const stand = pflichtEnum(o, 'stand', KOMMENTAR_STAENDE)
  const autor = liesAutor(o, ort, kuerzungen)

  let text: string | null = null
  let text_abgeschnitten = pflichtWahrheit(o, 'text_abgeschnitten')
  if (stand === 'entfernt') {
    // A removed comment keeps its place and loses its wording — whatever the door still sent.
    text_abgeschnitten = false
  } else {
    if (typeof o['text'] !== 'string') throw new Ungenuegend('text fehlt')
    const gekuerzt = kuerze(
      o['text'],
      GRENZEN.kommentar_text,
      `${ort}: Text`,
      kuerzungen
    )
    text = gekuerzt.text
    text_abgeschnitten = text_abgeschnitten || gekuerzt.gekuerzt
  }

  let antwort_auf: string | null = null
  const eltern = o['antwort_auf']
  if (typeof eltern === 'string' && eltern !== '') {
    if (eltern.length > GRENZEN.kennung)
      kuerzungen.push(
        `${ort}: antwort_auf ist länger als ${GRENZEN.kennung} Zeichen – nicht übernommen`
      )
    else antwort_auf = eltern
  }

  return {
    kennung,
    kennung_art: pflichtEnum(o, 'kennung_art', KOMMENTAR_KENNUNG_ARTEN),
    stand,
    erstmals_freigegeben_am: pflichtZeit(o, 'erstmals_freigegeben_am'),
    antwort_auf,
    ...autor,
    veroeffentlicht_am: wahlZeit(o, 'veroeffentlicht_am'),
    datum_genauigkeit: pflichtEnum(o, 'datum_genauigkeit', DATUM_GENAUIGKEITEN),
    text,
    text_abgeschnitten,
    bilder: stand === 'entfernt' ? [] : liesBilder(o, ort, kuerzungen),
    n_reaktionen: wahlZahl(o, 'n_reaktionen')
  }
}

function liesKommentare(o: Objekt, kuerzungen: string[]): Kommentar[] {
  const gelesen = liesEintraege(
    pflichtListe(o, 'kommentare'),
    (nr) => `Kommentar ${nr}`,
    (roh, ort) => ({ ort, kommentar: liesKommentar(roh, ort, kuerzungen) }),
    kuerzungen
  )
  // «Innerhalb des Fundes eindeutig» (4.7): a second entry under the same
  // kennung could not be told from the first on the desk.
  const gesehen = new Set<string>()
  const ergebnis: Kommentar[] = []
  for (const { ort, kommentar } of gelesen) {
    if (gesehen.has(kommentar.kennung)) {
      kuerzungen.push(`${ort} ausgelassen: kennung kommt im Fund zweimal vor`)
      continue
    }
    gesehen.add(kommentar.kennung)
    ergebnis.push(kommentar)
  }
  return ergebnis
}

function liesAenderung(o: Objekt, kuerzungen: string[] | null): Aenderung[] {
  const liste = Array.isArray(o['aenderung']) ? o['aenderung'] : []
  const bekannt = liste.filter((a): a is Aenderung =>
    (AENDERUNGEN as readonly unknown[]).includes(a)
  )
  if (kuerzungen !== null && bekannt.length < liste.length)
    kuerzungen.push(
      `aenderung: ${liste.length - bekannt.length} unbekannte Angabe(n) – nicht übernommen`
    )
  return [...new Set(bekannt)]
}

// ── A find ─────────────────────────────────────────────────────────────────

/**
 * The tombstone (4.9). Only `kennung` and `folge` are demanded: what it
 * triggers on this side is a deletion, and that must not be lost because a
 * side field is unreadable. Every field the contract says «must be absent»
 * is simply not read — a wording still attached to a tombstone goes nowhere.
 */
function liesEntfernt(
  o: Objekt,
  kennung: string,
  folge: number
): EntfernterFund {
  const grund = o['entfernt_grund']
  const kanal = o['kanal']
  const quelle = o['quelle']
  const bfs = Array.isArray(o['gemeinden_bfs']) ? o['gemeinden_bfs'] : []
  return {
    kennung,
    folge,
    status: 'entfernt',
    entfernt_grund: (ENTFERNT_GRUENDE as readonly unknown[]).includes(grund)
      ? (grund as EntfernterFund['entfernt_grund'])
      : null,
    aenderung: liesAenderung(o, null),
    erstmals_freigegeben_am: istZeitpunkt(o['erstmals_freigegeben_am'])
      ? o['erstmals_freigegeben_am']
      : null,
    geaendert_am: istZeitpunkt(o['geaendert_am']) ? o['geaendert_am'] : null,
    kanal: (KANAELE as readonly unknown[]).includes(kanal)
      ? (kanal as EntfernterFund['kanal'])
      : null,
    quelle:
      typeof quelle === 'string' &&
      quelle !== '' &&
      quelle.length <= GRENZEN.quelle
        ? quelle
        : null,
    gemeinden_bfs: [
      ...new Set(
        bfs.filter(
          (n): n is number =>
            typeof n === 'number' && Number.isSafeInteger(n) && n > 0
        )
      )
    ]
  }
}

function liesAktiv(
  o: Objekt,
  kennung: string,
  folge: number,
  status: Fund['status']
): Fund {
  const kuerzungen: string[] = []

  const link = pflichtText(o, 'link', GRENZEN.link)
  if (!istHttps(link)) throw new Ungenuegend('link ist keine https-Adresse')

  const beobachtet_bis = o['beobachtet_bis']
  if (!istTag(beobachtet_bis))
    throw new Ungenuegend('beobachtet_bis fehlt oder ist kein Kalendertag')

  const quelle_name = kuerze(
    pflichtText(o, 'quelle_name', Number.MAX_SAFE_INTEGER),
    GRENZEN.quelle_name,
    'quelle_name',
    kuerzungen
  ).text

  const autor = liesAutor(o, 'Beitrag', kuerzungen)

  if (typeof o['text'] !== 'string') throw new Ungenuegend('text fehlt')
  const text = kuerze(o['text'], GRENZEN.text, 'Text des Beitrags', kuerzungen)

  let geteilt: Geteilt | null = null
  if (!fehlt(o['geteilt'])) {
    try {
      geteilt = liesGeteilt(o['geteilt'], kuerzungen)
    } catch (fehler) {
      kuerzungen.push(
        `Geteilter Beitrag ausgelassen: ${fehler instanceof Ungenuegend ? fehler.message : 'nicht lesbar'}`
      )
    }
  }

  let doublette_von: string | null = null
  const original = o['doublette_von']
  if (typeof original === 'string' && original !== '') {
    if (original.length > GRENZEN.kennung)
      kuerzungen.push(
        `doublette_von ist länger als ${GRENZEN.kennung} Zeichen – nicht übernommen`
      )
    else if (original !== kennung) doublette_von = original
  }

  const datum_genauigkeit = pflichtEnum(
    o,
    'datum_genauigkeit',
    DATUM_GENAUIGKEITEN
  )

  return {
    kennung,
    folge,
    status,
    erstmals_freigegeben_am: pflichtZeit(o, 'erstmals_freigegeben_am'),
    geaendert_am: pflichtZeit(o, 'geaendert_am'),
    aenderung: liesAenderung(o, kuerzungen),
    beobachtet_bis,

    kanal: pflichtEnum(o, 'kanal', KANAELE),
    quelle: pflichtText(o, 'quelle', GRENZEN.quelle),
    quelle_name,
    quelle_art: pflichtEnum(o, 'quelle_art', QUELLEN_ARTEN),
    quelle_sichtbarkeit: pflichtEnum(o, 'quelle_sichtbarkeit', SICHTBARKEITEN),
    gemeinden_bfs: bfsNummern(o),
    link,

    // `unbekannt` means the door does not know the instant — whatever it sent beside it.
    veroeffentlicht_am:
      datum_genauigkeit === 'unbekannt'
        ? null
        : wahlZeit(o, 'veroeffentlicht_am'),
    datum_genauigkeit,
    veroeffentlicht_fruehestens: wahlZeit(o, 'veroeffentlicht_fruehestens'),
    veroeffentlicht_spaetestens: wahlZeit(o, 'veroeffentlicht_spaetestens'),

    ...autor,

    text: text.text,
    text_abgeschnitten:
      pflichtWahrheit(o, 'text_abgeschnitten') || text.gekuerzt,

    bilder: liesBilder(o, '', kuerzungen),
    n_bilder: wahlZahl(o, 'n_bilder'),
    verlinkt: liesVerlinkte(o, '', kuerzungen),
    geteilt,

    kommentare: liesKommentare(o, kuerzungen),
    kommentare_stand: pflichtEnum(o, 'kommentare_stand', KOMMENTARE_STAENDE),
    kommentare_fehlend: wahlZahl(o, 'kommentare_fehlend'),
    kommentare_geprueft_am: wahlZeit(o, 'kommentare_geprueft_am'),
    n_kommentare: wahlZahl(o, 'n_kommentare'),
    n_reaktionen: wahlZahl(o, 'n_reaktionen'),
    n_geteilt: wahlZahl(o, 'n_geteilt'),

    doublette_von,
    kuerzungen
  }
}

export type FundErgebnis =
  | { ok: true; fund: FundEintrag }
  | { ok: false; ungueltig: Ungueltig }

/** What can be said about an entry that was refused: its identity and number, where readable. */
function benenne(roh: unknown, grund: string): Ungueltig {
  const o = alsObjekt(roh)
  const kennung = o?.['kennung']
  const folge = o?.['folge']
  return {
    kennung:
      typeof kennung === 'string' && kennung !== ''
        ? kennung.slice(0, GRENZEN.kennung)
        : null,
    folge: istFolge(folge) ? folge : null,
    grund
  }
}

/** One find, or the reason it is not one. NEVER throws. */
export function liesFund(roh: unknown): FundErgebnis {
  try {
    const o = alsObjekt(roh)
    if (o === null) throw new Ungenuegend('kein Objekt')
    const kennung = pflichtText(o, 'kennung', GRENZEN.kennung)
    if (!istFolge(o['folge']))
      throw new Ungenuegend('folge fehlt oder ist keine positive ganze Zahl')
    const status = pflichtEnum(o, 'status', FUND_STATUS)
    return {
      ok: true,
      fund:
        status === 'entfernt'
          ? liesEntfernt(o, kennung, o['folge'])
          : liesAktiv(o, kennung, o['folge'], status)
    }
  } catch (fehler) {
    return {
      ok: false,
      ungueltig: benenne(
        roh,
        fehler instanceof Ungenuegend ? fehler.message : 'nicht lesbar'
      )
    }
  }
}

function liesAusgelassen(
  roh: unknown
): { ok: true; eintrag: Ausgelassen } | { ok: false; ungueltig: Ungueltig } {
  try {
    const o = alsObjekt(roh)
    if (o === null) throw new Ungenuegend('kein Objekt')
    if (!istFolge(o['folge']))
      throw new Ungenuegend('folge fehlt oder ist keine positive ganze Zahl')
    const kennung = o['kennung']
    const quelle = o['quelle']
    const bfs = Array.isArray(o['gemeinden_bfs']) ? o['gemeinden_bfs'] : []
    return {
      ok: true,
      eintrag: {
        kennung:
          typeof kennung === 'string' &&
          kennung !== '' &&
          kennung.length <= GRENZEN.kennung
            ? kennung
            : null,
        folge: o['folge'],
        grund: pflichtEnum(o, 'grund', AUSGELASSEN_GRUENDE),
        quelle:
          typeof quelle === 'string' &&
          quelle !== '' &&
          quelle.length <= GRENZEN.quelle
            ? quelle
            : null,
        kanal: (KANAELE as readonly unknown[]).includes(o['kanal'])
          ? (o['kanal'] as Ausgelassen['kanal'])
          : null,
        gemeinden_bfs: [
          ...new Set(
            bfs.filter(
              (n): n is number =>
                typeof n === 'number' && Number.isSafeInteger(n) && n > 0
            )
          )
        ],
        veroeffentlicht_am: istZeitpunkt(o['veroeffentlicht_am'])
          ? o['veroeffentlicht_am']
          : null
      }
    }
  } catch (fehler) {
    return {
      ok: false,
      ungueltig: benenne(
        roh,
        `ausgelassen: ${fehler instanceof Ungenuegend ? fehler.message : 'nicht lesbar'}`
      )
    }
  }
}

// ── The envelope ───────────────────────────────────────────────────────────

function liesUmschlag(json: unknown): Objekt {
  const antwort = alsObjekt(json)
  if (antwort === null)
    throw new AntwortFormatFehler(
      'Die Antwort des Buschtelefons ist kein JSON-Objekt.'
    )
  if (antwort['format'] !== FORMAT)
    throw new AntwortFormatFehler(
      `Unbekanntes Format «${gezeigt(antwort['format'] ?? 'ohne Angabe')}» (erwartet ${FORMAT}).`
    )
  return antwort
}

/** The release both answers carry. Unreadable is an envelope failure: without it nothing says how old the state is. */
export function liesFreigabe(roh: unknown): Freigabe {
  const o = alsObjekt(roh)
  if (o === null)
    throw new AntwortFormatFehler(
      'Die Antwort des Buschtelefons enthält keine «freigabe».'
    )
  const folge = o['folge']
  if (!istTag(o['tag']))
    throw new AntwortFormatFehler('«freigabe.tag» ist kein Kalendertag.')
  if (typeof folge !== 'number' || !Number.isSafeInteger(folge) || folge < 0)
    throw new AntwortFormatFehler('«freigabe.folge» ist keine ganze Zahl.')
  if (!istZeitpunkt(o['freigegeben_am']))
    throw new AntwortFormatFehler(
      '«freigabe.freigegeben_am» ist kein Zeitpunkt mit Zeitzonenversatz.'
    )
  const offen = Array.isArray(o['quellen_offen']) ? o['quellen_offen'] : []
  return {
    tag: o['tag'],
    folge,
    freigegeben_am: o['freigegeben_am'],
    sammellauf_begonnen_am: istZeitpunkt(o['sammellauf_begonnen_am'])
      ? o['sammellauf_begonnen_am']
      : null,
    sammellauf_beendet_am: istZeitpunkt(o['sammellauf_beendet_am'])
      ? o['sammellauf_beendet_am']
      : null,
    quellen_offen: offen.flatMap((eintrag): QuelleOffen[] => {
      const q = alsObjekt(eintrag)
      const quelle = q?.['quelle']
      if (typeof quelle !== 'string' || quelle === '') return []
      const grund = q?.['grund']
      return [
        {
          quelle: quelle.slice(0, GRENZEN.quelle),
          grund: (QUELLE_OFFEN_GRUENDE as readonly unknown[]).includes(grund)
            ? (grund as QuelleOffen['grund'])
            : null
        }
      ]
    })
  }
}

/**
 * One page of `/funde`. Throws `AntwortFormatFehler` for an envelope that is
 * not the contract's, and for nothing else: every find is read by itself.
 */
export function liesFundeAntwort(json: unknown): FundeAntwort {
  const antwort = liesUmschlag(json)
  const freigabe = liesFreigabe(antwort['freigabe'])
  if (!Array.isArray(antwort['funde']))
    throw new AntwortFormatFehler(
      'Die Antwort des Buschtelefons enthält keine Liste «funde».'
    )
  const weiter = antwort['weiter']
  if (!fehlt(weiter) && !istFolge(weiter))
    throw new AntwortFormatFehler(
      '«weiter» ist weder null noch eine positive ganze Zahl.'
    )

  const funde: FundEintrag[] = []
  const ausgelassen: Ausgelassen[] = []
  const ungueltig: Ungueltig[] = []
  for (const roh of antwort['funde']) {
    const ergebnis = liesFund(roh)
    if (ergebnis.ok) funde.push(ergebnis.fund)
    else ungueltig.push(ergebnis.ungueltig)
  }
  for (const roh of Array.isArray(antwort['ausgelassen'])
    ? antwort['ausgelassen']
    : []) {
    const ergebnis = liesAusgelassen(roh)
    if (ergebnis.ok) ausgelassen.push(ergebnis.eintrag)
    else ungueltig.push(ergebnis.ungueltig)
  }
  funde.sort((a, b) => a.folge - b.folge)
  ausgelassen.sort((a, b) => a.folge - b.folge)
  return {
    freigabe,
    funde,
    ausgelassen,
    weiter: istFolge(weiter) ? weiter : null,
    ungueltig
  }
}

/**
 * The highest `folge` a page (or a whole read) carried — over finds, omitted
 * and refused entries alike, because the bookmark has to pass all three.
 * Null for an empty page.
 */
export function hoechsteFolge(
  antwort: Pick<FundeAntwort, 'funde' | 'ausgelassen' | 'ungueltig' | 'weiter'>
): number | null {
  const folgen = [
    ...antwort.funde.map((f) => f.folge),
    ...antwort.ausgelassen.map((a) => a.folge),
    ...antwort.ungueltig.flatMap((u) => (u.folge === null ? [] : [u.folge])),
    ...(antwort.weiter === null ? [] : [antwort.weiter])
  ]
  return folgen.length === 0 ? null : Math.max(...folgen)
}

function liesQuelle(roh: unknown): Quelle {
  const o = alsObjekt(roh)
  if (o === null) throw new Ungenuegend('kein Objekt')
  const kuerzungen: string[] = []
  const kennung = pflichtText(o, 'kennung', GRENZEN.quelle)

  let url: string | null = null
  const adresse = o['url']
  if (typeof adresse === 'string' && adresse !== '') {
    if (adresse.length <= GRENZEN.link && istHttps(adresse)) url = adresse
    else
      kuerzungen.push(
        'url ist keine verwendbare https-Adresse – nicht übernommen'
      )
  }

  const hinweise = Array.isArray(o['hinweise']) ? o['hinweise'] : []
  return {
    kennung,
    kanal: pflichtEnum(o, 'kanal', KANAELE),
    art: pflichtEnum(o, 'art', QUELLEN_ARTEN),
    name: kuerze(
      pflichtText(o, 'name', Number.MAX_SAFE_INTEGER),
      GRENZEN.quelle_name,
      'name',
      kuerzungen
    ).text,
    url,
    sichtbarkeit: pflichtEnum(o, 'sichtbarkeit', SICHTBARKEITEN),
    zugang: wahlEnum(o, 'zugang', ZUGAENGE),
    gemeinden_bfs: bfsNummern(o),
    aktiv: pflichtWahrheit(o, 'aktiv'),
    stand: pflichtEnum(o, 'stand', QUELLEN_STAENDE),
    zuletzt_vollstaendig_gelesen_am: wahlZeit(
      o,
      'zuletzt_vollstaendig_gelesen_am'
    ),
    gelesen_zurueck_bis: wahlZeit(o, 'gelesen_zurueck_bis'),
    n_beitraege_gesehen: wahlZahl(o, 'n_beitraege_gesehen'),
    n_aussortiert: wahlZahl(o, 'n_aussortiert'),
    n_zu_alt: wahlZahl(o, 'n_zu_alt'),
    fehler_seit: wahlZeit(o, 'fehler_seit'),
    letzter_fehler: wahlText(
      o,
      'letzter_fehler',
      GRENZEN.quelle_fehler,
      'letzter_fehler',
      kuerzungen
    ),
    hinweise: hinweise
      .filter((h): h is string => typeof h === 'string' && h.trim() !== '')
      .map((h) => kuerze(h, GRENZEN.hinweis, 'Hinweis', kuerzungen).text),
    kuerzungen
  }
}

/** The answer of `/quellen`. Like the finds: one unreadable source is named and costs itself. */
export function liesQuellenAntwort(json: unknown): QuellenAntwort {
  const antwort = liesUmschlag(json)
  const freigabe = liesFreigabe(antwort['freigabe'])
  if (!Array.isArray(antwort['quellen']))
    throw new AntwortFormatFehler(
      'Die Antwort des Buschtelefons enthält keine Liste «quellen».'
    )
  const quellen: Quelle[] = []
  const ungueltig: QuellenAntwort['ungueltig'] = []
  const gesehen = new Set<string>()
  for (const roh of antwort['quellen']) {
    try {
      const quelle = liesQuelle(roh)
      if (gesehen.has(quelle.kennung))
        throw new Ungenuegend('kennung kommt zweimal vor')
      gesehen.add(quelle.kennung)
      quellen.push(quelle)
    } catch (fehler) {
      const kennung = alsObjekt(roh)?.['kennung']
      ungueltig.push({
        kennung:
          typeof kennung === 'string' && kennung !== ''
            ? kennung.slice(0, GRENZEN.quelle)
            : null,
        grund: fehler instanceof Ungenuegend ? fehler.message : 'nicht lesbar'
      })
    }
  }
  return { freigabe, quellen, ungueltig }
}
