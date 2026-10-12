// The blog as the Dorfkönig sees it — a live view of `/api/v1/artikel`.
//
// The newsroom's decision of 12 October 2026: the in-app blog shows exactly
// what the public API delivers, nothing more and nothing less, so a glance at
// it answers «what does the Dorfkönig get?». Before, the internal blog listed
// every Meldung of every status and the public page the newest 200 published
// ones — two views of the rows, neither of them the API's. Now there is one,
// and it IS the API's: the workspace reads the same endpoint through a
// session-gated proxy (`app/api/v1/[...pfad]`), and whatever the API says —
// an article, a page, a 503 because the switch is off — is what the editor
// sees. Nothing here recomputes the API's rules.
//
// Pure, so the paths the proxy lets through, the page arithmetic and the
// labels are tested without a component.

/** What the workspace may read of the public API — GET only, these shapes only. */
export const V1_LESBAR: RegExp[] = [
  /^artikel$/i,
  /^artikel\/[0-9a-f-]{36}$/i,
  /^gemeinden$/i,
  /^gesundheit$/i
]

export function darfV1Lesen(ziel: string): boolean {
  return V1_LESBAR.some((muster) => muster.test(ziel))
}

/**
 * The query the proxy forwards — only the reading parameters. `abnehmer`
 * stays out on purpose: it would make the list a consumer's view (oldest
 * first, behind that consumer's Stand), and the blog is the plain one.
 */
export const V1_PARAMETER = ['gemeinde', 'grenze', 'versatz', 'seit'] as const

export function v1Abfrage(search: string): string {
  const eingabe = new URLSearchParams(search)
  const ausgabe = new URLSearchParams()
  for (const name of V1_PARAMETER) {
    const wert = eingabe.get(name)
    if (wert !== null && wert !== '') ausgabe.set(name, wert)
  }
  const text = ausgabe.toString()
  return text === '' ? '' : `?${text}`
}

// --- the API's own shapes, as SCHNITTSTELLE.md describes them ---------------

export type Rubrik =
  | 'statistik'
  | 'sport'
  | 'entsorgung'
  | 'amtsblatt'
  | 'beschaffung'
  | 'gemeinde'
  | 'veranstaltung'
  | 'kanton'
  | 'presseschau'
  | 'sendung'

export interface ApiPruefsiegel {
  pruefungen: { zeitbezug: string[]; zahlen: string[]; weitere: string[] }
  bestanden: boolean
  gegenpruefung: 'ja' | 'nein' | 'unklar' | 'keine'
  freigabe: 'redaktion' | 'freigegeben_dann_zeitlauf' | 'unbekannt'
  freigegeben_am: string | null
  publiziert_am: string | null
  herkunft: { rubrik: Rubrik | null; quelle_name: string | null; quelle_url: string | null }
}

export interface ApiTermin {
  ideal: string
  ende: string
  auftritte?: string[]
}

export interface ApiArtikel {
  id: string
  gemeinde: string | null
  gemeinde_name: string | null
  bfs_nummer: number | null
  rubrik: Rubrik | null
  titel: string | null
  lead: string | null
  text: string | null
  publiziert_am: string | null
  erscheint_am: string | null
  perle: boolean
  quelle_name: string | null
  quelle_url: string | null
  sport: { sportart: string | null; heim: string | null; gast: string | null } | null
  termin: ApiTermin | null
  medium: string
  pruefsiegel: ApiPruefsiegel
}

/** The list envelope (R8). */
export interface ApiListe {
  anzahl: number
  gesamt: number
  versatz: number
  grenze: number
  weitere: boolean
  artikel: ApiArtikel[]
}

export interface ApiGemeinde {
  gemeinde: string
  name: string
  bfs_nummer: number
  bezirk: string | null
}

export interface ApiGesundheit {
  bereit: boolean
  offen: boolean
  datenbank: boolean
  medium: string
  version: string
}

/** How many articles one page carries. */
export const SEITE = 50

export function artikelPfad(gemeinde: string | null, versatz: number, grenze = SEITE): string {
  const q = new URLSearchParams({ grenze: String(grenze), versatz: String(versatz) })
  if (gemeinde !== null && gemeinde !== '') q.set('gemeinde', gemeinde)
  return `/api/v1/artikel?${q.toString()}`
}

/** A later page appended to what is shown — an article the API lists twice (a boundary moved) stays one. */
export function verlaengere(bisher: readonly ApiArtikel[], weitere: readonly ApiArtikel[]): ApiArtikel[] {
  const bekannt = new Set(bisher.map((a) => a.id))
  return [...bisher, ...weitere.filter((a) => !bekannt.has(a.id))]
}

/**
 * What a refusal means, in the editor's words. The 503 is the one that
 * matters: the switch is off, and then the Dorfkönig sees nothing either —
 * which is exactly what this view has to say.
 */
export function antwortText(status: number, koerper: unknown): string {
  const meldung =
    typeof koerper === 'object' && koerper !== null
      ? ((koerper as { fehler?: { meldung?: unknown }; errors?: Array<{ message?: unknown }> }).fehler
          ?.meldung ?? (koerper as { errors?: Array<{ message?: unknown }> }).errors?.[0]?.message)
      : undefined
  const text = typeof meldung === 'string' && meldung !== '' ? meldung : null
  if (status === 503)
    return `Die Schnittstelle ist abgeschaltet — der Dorfkönig bekommt nichts. ${text ?? 'Sie wird mit BLOG_API_OFFEN=ja eingeschaltet.'}`
  if (status === 404) return text ?? 'Diese Gemeinde kennt die Schnittstelle nicht.'
  if (status === 401) return 'Sitzung abgelaufen. Bitte neu anmelden.'
  return text ?? `Die Schnittstelle antwortet mit HTTP ${status}.`
}

// --- labels --------------------------------------------------------------------

const RUBRIK_TEXT: Record<Rubrik, string> = {
  statistik: 'Statistik',
  sport: 'Sport',
  entsorgung: 'Entsorgung',
  amtsblatt: 'Amtsblatt',
  beschaffung: 'Beschaffung',
  gemeinde: 'Gemeinde',
  veranstaltung: 'Veranstaltung',
  kanton: 'Kanton',
  presseschau: 'Presseschau',
  sendung: 'Sendung'
}

export function rubrikText(rubrik: Rubrik | null): string {
  return rubrik === null ? 'ohne Rubrik' : (RUBRIK_TEXT[rubrik] ?? rubrik)
}

export interface SiegelChip {
  text: string
  farbe: 'success' | 'warning'
  /** Every open warning, in the order the seal lists them — German prose, shown, never parsed. */
  hinweise: string[]
}

/** The seal as one chip: passed, or how many checks still complain. */
export function siegelChip(siegel: ApiPruefsiegel): SiegelChip {
  const hinweise = [...siegel.pruefungen.zeitbezug, ...siegel.pruefungen.zahlen, ...siegel.pruefungen.weitere]
  if (siegel.bestanden && hinweise.length === 0)
    return { text: 'Prüfsiegel bestanden', farbe: 'success', hinweise }
  return {
    text: hinweise.length === 1 ? '1 Hinweis im Prüfsiegel' : `${hinweise.length} Hinweise im Prüfsiegel`,
    farbe: 'warning',
    hinweise
  }
}

const GEGENPRUEFUNG_TEXT: Record<ApiPruefsiegel['gegenpruefung'], string | null> = {
  ja: 'gegengelesen: ja',
  nein: 'gegengelesen: nein',
  unklar: 'gegengelesen: unklar',
  keine: null
}

/** The counter-check as a chip text, or null where none was asked for. */
export function gegenpruefungText(siegel: Pick<ApiPruefsiegel, 'gegenpruefung'>): string | null {
  return GEGENPRUEFUNG_TEXT[siegel.gegenpruefung] ?? null
}

const FREIGABE_TEXT: Record<ApiPruefsiegel['freigabe'], string> = {
  redaktion: 'publiziert von der Redaktion',
  freigegeben_dann_zeitlauf: 'freigegeben, vom Zeitlauf publiziert',
  unbekannt: 'Freigabe unbekannt (vor dem 15. September 2026)'
}

export function freigabeText(siegel: Pick<ApiPruefsiegel, 'freigabe'>): string {
  return FREIGABE_TEXT[siegel.freigabe] ?? siegel.freigabe
}

/** «zählt am 18. Oktober 2026 · Auftritte: 16.10., 17.10.» — what the Dorfkönig reads off `termin`. */
export function terminText(termin: ApiTermin | null, datumText: (iso: string) => string): string | null {
  if (termin === null) return null
  const spanne =
    termin.ende === termin.ideal
      ? datumText(termin.ideal)
      : `${datumText(termin.ideal)} bis ${datumText(termin.ende)}`
  const auftritte = termin.auftritte ?? []
  const tage = auftritte.length === 0 ? '' : ` · Auftritte: ${auftritte.map(datumText).join(', ')}`
  return `zählt am ${spanne}${tage}`
}

/** «3 von 128 Beiträgen» — what the list says about itself. */
export function standText(gezeigt: number, gesamt: number): string {
  if (gesamt === 0) return 'Keine Beiträge auf der Schnittstelle.'
  if (gesamt === 1) return '1 Beitrag auf der Schnittstelle.'
  return gezeigt >= gesamt ? `Alle ${gesamt} Beiträge.` : `${gezeigt} von ${gesamt} Beiträgen.`
}
