import type { AnkuendigungFelder, MeldungFelder } from '@/graphql/redaktion'

// Presentation helpers. Pure, so they can be tested without a browser.

const STATUS_TEXT: Record<string, string> = {
  entwurf: 'Entwurf',
  in_pruefung: 'In Gegenprüfung',
  freigegeben: 'Freigegeben',
  publiziert: 'Publiziert',
  verworfen: 'Verworfen'
}

const STATUS_FARBE: Record<string, 'default' | 'warning' | 'info' | 'success' | 'error'> = {
  entwurf: 'default',
  in_pruefung: 'warning',
  freigegeben: 'info',
  publiziert: 'success',
  verworfen: 'error'
}

export function statusText(status: string): string {
  return STATUS_TEXT[status] ?? status
}

export function statusFarbe(status: string): 'default' | 'warning' | 'info' | 'success' | 'error' {
  return STATUS_FARBE[status] ?? 'default'
}

const LAUF_TEXT: Record<string, string> = {
  geplant: 'Eingeplant',
  briefing: 'Briefing läuft',
  schreibt: 'Meldungen werden geschrieben',
  bereit: 'Bereit zur Durchsicht',
  fehler: 'Fehler'
}

export function laufStatusText(status: string): string {
  return LAUF_TEXT[status] ?? status
}

/**
 * Whether anything is still being worked on — drives the polling.
 *
 * Structural on purpose: the workspace holds `AlleMeldungFelder`, the run view
 * `MeldungFelder`, and both answer the only question asked here.
 */
export function istBeschaeftigt(meldungen: readonly { verarbeitung: string }[]): boolean {
  return meldungen.some((m) => m.verarbeitung === 'geplant' || m.verarbeitung === 'laeuft')
}

/** How many articles are queued or being written right now. */
export function anzahlBeschaeftigt(meldungen: readonly { verarbeitung: string }[]): number {
  return meldungen.filter((m) => m.verarbeitung === 'geplant' || m.verarbeitung === 'laeuft').length
}

export interface Fortschritt {
  fertig: number
  gesamt: number
  prozent: number
}

export function fortschritt(meldungen: readonly MeldungFelder[]): Fortschritt {
  const gesamt = meldungen.length
  const fertig = meldungen.filter((m) => m.titel !== null && m.verarbeitung === 'idle').length

  return {
    fertig,
    gesamt,
    prozent: gesamt === 0 ? 0 : Math.round((fertig / gesamt) * 100)
  }
}

/**
 * Warnings worth putting in front of the editor.
 *
 * An article that is otherwise fine but carries a soft time reference is not
 * broken — it just wants a glance. Showing nothing at all when the list is
 * empty keeps the ones that do matter visible.
 */
export function warnungen(meldung: MeldungFelder): string[] {
  const gesammelt = [...(meldung.zeit_warnungen ?? [])]
  if (meldung.fehler !== null && meldung.fehler.trim() !== '') {
    gesammelt.push(meldung.fehler)
  }
  return gesammelt
}

export function formatiereDatum(wert: string | null): string {
  if (wert === null) return '—'
  const datum = new Date(wert)
  if (Number.isNaN(datum.getTime())) return '—'

  return datum.toLocaleDateString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

/** Splits an article body into paragraphs for rendering. */
export function absaetze(text: string | null): string[] {
  if (text === null) return []
  return text
    .split(/\n{2,}/)
    .map((a) => a.trim())
    .filter((a) => a !== '')
}

/**
 * Filters the municipality list for the workspace, alphabetically.
 *
 * The district accordions this replaces hid more than they organised: a
 * municipality outside the five Basel-Landschaft districts — Riehen is the first
 * — arrived as its own collapsed one-item group and was easy to miss entirely.
 * A flat list with a search box has no such corner to hide in, and `nurAktive`
 * answers the question actually asked most often, which is "what is switched on
 * right now".
 *
 * Matching is case- and accent-insensitive so that typing "munchenstein" or
 * "zurzach" finds the place without the editor hunting for the umlaut, and the
 * BFS number is searchable because that is the identity the data carries.
 */
export function filterGemeinden<
  T extends { name: string; bezirk: string; bfs_nummer: number; aktiv: boolean }
>(gemeinden: readonly T[], suche: string, nurAktive: boolean): T[] {
  const begriff = normalisiere(suche.trim())

  return gemeinden
    .filter((g) => !nurAktive || g.aktiv)
    .filter(
      (g) =>
        begriff === '' ||
        normalisiere(g.name).includes(begriff) ||
        normalisiere(g.bezirk).includes(begriff) ||
        String(g.bfs_nummer).includes(begriff)
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'de-CH'))
}

function normalisiere(text: string): string {
  // NFD splits "ü" into "u" plus a combining mark; dropping every mark then
  // leaves the bare letter. `\p{M}` rather than a literal character range —
  // combining characters are invisible in a diff and break silently.
  return text.toLocaleLowerCase('de-CH').normalize('NFD').replace(/\p{M}/gu, '')
}

export interface SpielGruppen<T> {
  vergangen: T[]
  kommend: T[]
}

/**
 * Splits matches into what has happened and what is still to come.
 *
 * The boundary is the clock, not the presence of a score: a match can be over
 * and still have no result on the source page, and calling that "kommend"
 * would quietly hide the very fixture an editor is waiting for. Past matches
 * run newest first, coming ones soonest first — both are read from the middle
 * outwards, which is where the reader's attention actually is.
 */
export function teileSpiele<T extends { datum: string }>(
  spiele: readonly T[],
  jetzt: Date = new Date()
): SpielGruppen<T> {
  const grenze = jetzt.getTime()
  const vergangen: T[] = []
  const kommend: T[] = []

  for (const spiel of spiele) {
    const zeit = new Date(spiel.datum).getTime()
    if (Number.isNaN(zeit)) continue
    if (zeit <= grenze) vergangen.push(spiel)
    else kommend.push(spiel)
  }

  vergangen.sort((a, b) => new Date(b.datum).getTime() - new Date(a.datum).getTime())
  kommend.sort((a, b) => new Date(a.datum).getTime() - new Date(b.datum).getTime())
  return { vergangen, kommend }
}

/**
 * Date and kick-off time, Swiss style: `21.08.2026, 20:00`.
 *
 * A fixture without its time is half an announcement — the reader needs to know
 * whether it is an afternoon or an evening match. Rendered in the viewer's
 * timezone from the stored instant, so it stays right across the October
 * changeover.
 */
export function formatiereZeitpunkt(wert: string | null): string {
  if (wert === null) return '—'
  const datum = new Date(wert)
  if (Number.isNaN(datum.getTime())) return '—'
  return datum.toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** `3:1`, or an em dash while the source has not published a full result. */
export function resultat(toreHeim: number | null, toreGast: number | null): string {
  if (toreHeim === null || toreGast === null) return '–'
  return `${toreHeim}:${toreGast}`
}

/**
 * Buckets clubs by municipality id.
 *
 * "Aushängeschild" first, then alphabetically: the newsroom's own split, and it
 * is also the reading order — a Nationalliga result carries regional weight, a
 * village derby carries local weight, and the flagship is what a reader
 * recognises the place by.
 */
export function vereineNachGemeinde<
  T extends { name: string; bedeutung: string; gemeinde: { id: string } | null }
>(vereine: readonly T[]): Map<string, T[]> {
  const nach = new Map<string, T[]>()

  for (const verein of vereine) {
    if (verein.gemeinde === null) continue
    const bisher = nach.get(verein.gemeinde.id)
    if (bisher === undefined) nach.set(verein.gemeinde.id, [verein])
    else bisher.push(verein)
  }

  for (const liste of nach.values()) {
    liste.sort((a, b) => {
      if (a.bedeutung !== b.bedeutung) return a.bedeutung === 'aushaengeschild' ? -1 : 1
      return a.name.localeCompare(b.name, 'de-CH')
    })
  }

  return nach
}

export interface AgendaQuartal<T = AnkuendigungFelder> {
  /** The heading as the office writes it, e.g. "3. Quartal: Juli–September". */
  quartal: string
  eintraege: T[]
}

/**
 * The agenda as the office publishes it: by quarter, chronological inside.
 *
 * Published entries carry a date and sort by it. Planned ones carry only their
 * quarter, so they keep the order they arrived in — which for an import of the
 * whole page is the order the page lists them in. There is no date to sort them
 * by, and inventing one would put a claim on screen the source never made.
 */
export function nachQuartal<T extends { quartal: string | null; datum: string | null }>(
  eintraege: readonly T[]
): AgendaQuartal<T>[] {
  const gruppen = new Map<string, T[]>()

  for (const e of eintraege) {
    const schluessel = e.quartal ?? OHNE_QUARTAL
    const bisher = gruppen.get(schluessel)
    if (bisher === undefined) gruppen.set(schluessel, [e])
    else bisher.push(e)
  }

  return [...gruppen.entries()]
    .map(([quartal, liste]) => ({ quartal, eintraege: sortiereQuartal(liste) }))
    .sort((a, b) => quartalNummer(a.quartal) - quartalNummer(b.quartal))
}

const OHNE_QUARTAL = 'Ohne Quartalsangabe'

/** Reads the leading digit of "3. Quartal: …". Anything else sorts last. */
function quartalNummer(quartal: string): number {
  const treffer = /^(\d)\./.exec(quartal)
  return treffer === null ? 99 : Number(treffer[1])
}

// Array.prototype.sort is stable in every engine we ship to, which is what
// keeps the planned entries in the order they came in.
function sortiereQuartal<T extends { datum: string | null }>(liste: readonly T[]): T[] {
  return [...liste].sort((a, b) => {
    if (a.datum === null && b.datum === null) return 0
    if (a.datum === null) return 1
    if (b.datum === null) return -1
    return a.datum.localeCompare(b.datum)
  })
}

// --- die Zeitleiste ----------------------------------------------------------
//
// „Was hat uns wann gesagt, dass es etwas Neues gibt?" — drei Quellen
// beantworten das, und keine allein reicht:
//
//   Agenda      was das Amt ankuendigt. Deckt 9 von 188 Datensaetzen ab.
//   Portal      Zweige von statistik.bl.ch, die wir taeglich pruefen.
//   data.bl.ch  Katalogaenderungen — die uebrigen 43 relevanten gemeindescharfen
//               Datensaetze tauchen in der Agenda nie auf, ihre Meldungen lagen
//               bisher unter „Laeufe" ohne dass irgendwo stand, woher sie kamen.

export type ZeitleistenHerkunft = 'agenda' | 'portal' | 'datensatz'

export interface ZeitleistenEintrag {
  id: string
  herkunft: ZeitleistenHerkunft
  /** ISO-Datum, oder null fuer einen angekuendigten Eintrag ohne Termin. */
  datum: string | null
  titel: string
  /** Was daraus folgt — der geprüfte Grund, wenn nichts folgt. */
  hinweis: string | null
  /** Der Datensatz dahinter, sofern es einen gibt. */
  datensatzId: string | null
  /** Bereits ein Lauf dazu? Dann fuehrt die Zeile dorthin. */
  laufId: string | null
  /** Nur bei Portalzeilen: der Pfad des Zweigs. */
  pfad: string | null
  /** Nur bei undatierten Agenda-Eintraegen: ihr Quartal. */
  quartal: string | null
  /** Was der Katalog sagt: Beschreibung, Rhythmus, Zeilenzahl. */
  beschreibung: string | null
  rhythmus: string | null
  zeilen: number | null
}

export interface ZeitleistenQuellen {
  ankuendigungen: readonly {
    id: string
    titel: string
    datum: string | null
    quartal: string | null
    zuordnung_hinweis: string | null
    datensatz: { id: string; hat_gemeinde: boolean } | null
  }[]
  bereiche: readonly {
    id: string
    pfad: string
    titel: string
    stand: string | null
    beobachten: boolean
  }[]
  datensaetze: readonly {
    id: string
    titel: string
    status: string
    hat_gemeinde: boolean
    portal_modified: string | null
    /** When the numbers moved. Preferred over `portal_modified`. */
    daten_stand?: string | null
    rhythmus?: string | null
    zeilen?: number | null
    beschreibung?: string | null
    bewertung: string | null
    /** Das Agenda-Thema, zu dem dieser Datensatz gehoert — sofern eines da ist. */
    ankuendigung?: { id: string } | null
  }[]
  laeufe: readonly { id: string; datensatz: { id: string } | null }[]
}

export interface ZeitleistenErgebnis {
  /** Nach Datum, neueste zuerst. */
  datiert: ZeitleistenEintrag[]
  /** Angekuendigt, aber noch ohne Termin — nach Quartal gruppiert. */
  ohneDatum: ZeitleistenEintrag[]
  /** Wie viele datierte Zeilen der Deckel abgeschnitten hat. */
  weitere: number
}

/**
 * Mischt die drei Quellen zu einer Liste.
 *
 * Ein Datensatz, der zu einem Agenda-Thema gehoert, erscheint nur dort — sonst
 * stuende dieselbe Statistik mehrfach untereinander, einmal mit dem Titel des
 * Amts und ein- bis dreimal mit denen des Portals. Die Agenda hat Vorrang, weil
 * sie das Thema benennt, das die Redaktion meint.
 *
 * Und sie rueckt mit ihren Daten nach oben: ein Eintrag traegt das Datum seiner
 * Ankuendigung, solange nichts da ist, und das des juengsten zugehoerigen
 * Datensatzes, sobald die Zahlen eintreffen. Sonst stuende die Ankuendigung vom
 * 7. Juli weit unten, waehrend die Zahlen vom 13. August oben stehen — dieselbe
 * Sache, zweimal, in falscher Reihenfolge.
 */
export function zeitleiste(quellen: ZeitleistenQuellen, hoechstens = 40): ZeitleistenErgebnis {
  const laufZu = new Map<string, string>()
  for (const lauf of quellen.laeufe) {
    if (lauf.datensatz !== null && !laufZu.has(lauf.datensatz.id)) {
      laufZu.set(lauf.datensatz.id, lauf.id)
    }
  }

  // Beide Richtungen: der primaere Datensatz haengt an der Ankuendigung, die
  // weiteren zeigen selbst auf sie.
  const ausAgenda = new Set<string>()
  for (const a of quellen.ankuendigungen) {
    if (a.datensatz !== null) ausAgenda.add(a.datensatz.id)
  }
  const themenStand = new Map<string, string>()
  for (const d of quellen.datensaetze) {
    const thema = d.ankuendigung?.id
    if (thema === undefined) continue
    ausAgenda.add(d.id)
    const stand = d.daten_stand ?? d.portal_modified
    if (stand === null || stand === undefined) continue
    const bisher = themenStand.get(thema)
    if (bisher === undefined || stand > bisher) themenStand.set(thema, stand)
  }

  const eintraege: ZeitleistenEintrag[] = []

  for (const a of quellen.ankuendigungen) {
    const zahlenStand = themenStand.get(a.id) ?? null
    const datum =
      a.datum === null ? zahlenStand : zahlenStand !== null && zahlenStand > a.datum ? zahlenStand : a.datum

    eintraege.push({
      id: `agenda-${a.id}`,
      herkunft: 'agenda',
      datum,
      titel: a.titel,
      hinweis: a.zuordnung_hinweis,
      datensatzId: a.datensatz?.id ?? null,
      laufId: a.datensatz === null ? null : (laufZu.get(a.datensatz.id) ?? null),
      pfad: null,
      quartal: a.quartal,
      beschreibung: null,
      rhythmus: null,
      zeilen: null
    })
  }

  for (const b of quellen.bereiche) {
    if (!b.beobachten) continue

    eintraege.push({
      id: `portal-${b.id}`,
      herkunft: 'portal',
      datum: b.stand,
      // Der Name zuerst, der Pfad als Beleg dahinter — „5_1 — Preise …" las
      // sich wie eine Nummer mit Anhang.
      titel: b.titel === '' ? `Zweig ${b.pfad}` : `${b.titel} (${b.pfad})`,
      hinweis: null,
      datensatzId: null,
      laufId: null,
      pfad: b.pfad,
      quartal: null,
      beschreibung: null,
      rhythmus: null,
      zeilen: null
    })
  }

  for (const d of quellen.datensaetze) {
    if (ausAgenda.has(d.id)) continue
    if (!d.hat_gemeinde) continue

    eintraege.push({
      id: `datensatz-${d.id}`,
      herkunft: 'datensatz',
      // `daten_stand` zuerst: `portal_modified` springt auch, wenn nur die
      // Beschreibung korrigiert wurde, und davon war die Liste voll.
      datum: d.daten_stand ?? d.portal_modified,
      titel: d.titel,
      hinweis: d.bewertung,
      datensatzId: d.id,
      laufId: laufZu.get(d.id) ?? null,
      pfad: null,
      quartal: null,
      beschreibung: d.beschreibung ?? null,
      rhythmus: d.rhythmus ?? null,
      zeilen: d.zeilen ?? null
    })
  }

  const datiert = eintraege
    .filter((e) => e.datum !== null)
    .sort((a, b) => (b.datum ?? '').localeCompare(a.datum ?? ''))

  // Undatiert sind nur Agenda-Eintraege: angekuendigt, aber noch ohne Termin.
  // Sobald das Amt ein Datum nennt, wandern sie von selbst nach oben.
  const ohneDatum = eintraege.filter((e) => e.datum === null && e.herkunft === 'agenda')

  return {
    datiert: datiert.slice(0, Math.max(hoechstens, 0)),
    ohneDatum,
    weitere: Math.max(datiert.length - Math.max(hoechstens, 0), 0)
  }
}

// ---------------------------------------------------------------------------
// Meldungen, zweimal anders sortiert.
//
// Dieselbe Menge traegt jetzt zwei Ansichten: die Zeitleiste zeigt sie unter
// ihrem Datensatz-Lauf, der Gemeinde-Blog mischt Statistik und Sport
// chronologisch. Beides sind reine Funktionen, damit die Reihenfolge pruefbar
// ist, ohne eine Komponente zu rendern.

/** Buendelt Meldungen nach ihrem Lauf. Sportberichte haben keinen und fallen raus. */
export function meldungenNachLauf<T extends { lauf: { id: string } | null }>(
  meldungen: readonly T[]
): Map<string, T[]> {
  const nach = new Map<string, T[]>()
  for (const meldung of meldungen) {
    if (meldung.lauf === null) continue
    const bisher = nach.get(meldung.lauf.id)
    if (bisher === undefined) nach.set(meldung.lauf.id, [meldung])
    else bisher.push(meldung)
  }
  return nach
}

/**
 * Wann eine Meldung im Blog steht.
 *
 * Publikationsdatum, solange es eines gibt — das ist der Moment, in dem der
 * Beitrag oeffentlich wurde. Ein Entwurf hat keines und wird nach seiner
 * Entstehung einsortiert, damit er nicht ans Ende der Liste faellt.
 */
export function blogDatum(meldung: {
  publiziert_am: string | null
  date_created: string | null
}): string | null {
  return meldung.publiziert_am ?? meldung.date_created
}

export interface GemeindeBlog<T> {
  gemeinde: { id: string; name: string }
  beitraege: T[]
}

/**
 * Ein Blog je Gemeinde, neueste zuerst.
 *
 * Herkunftsblind mit Absicht: ob ein Beitrag aus einer Statistik oder aus einem
 * Spiel entstand, ist eine Frage der Produktion, nicht der Lektuere. Weitere
 * Quellen reihen sich spaeter ohne Aenderung hier ein.
 */
export function blogNachGemeinde<
  T extends {
    publiziert_am: string | null
    date_created: string | null
    gemeinde: { id: string; name: string } | null
  }
>(meldungen: readonly T[]): GemeindeBlog<T>[] {
  const nach = new Map<string, GemeindeBlog<T>>()

  for (const meldung of meldungen) {
    if (meldung.gemeinde === null) continue
    const vorhanden = nach.get(meldung.gemeinde.id)
    if (vorhanden === undefined) {
      nach.set(meldung.gemeinde.id, {
        gemeinde: { id: meldung.gemeinde.id, name: meldung.gemeinde.name },
        beitraege: [meldung]
      })
    } else {
      vorhanden.beitraege.push(meldung)
    }
  }

  for (const blog of nach.values()) {
    blog.beitraege.sort((a, b) => {
      const da = blogDatum(a)
      const db = blogDatum(b)
      if (da === null) return 1
      if (db === null) return -1
      return new Date(db).getTime() - new Date(da).getTime()
    })
  }

  return [...nach.values()].sort((a, b) => a.gemeinde.name.localeCompare(b.gemeinde.name, 'de-CH'))
}

/**
 * Der URL-Name einer Gemeinde: `?gemeinde=muenchenstein`.
 *
 * Ein Slug statt der UUID, weil die Adresse von Hand tippbar und zwischen
 * Installationen stabil sein soll — die UUID ist beides nicht. Umlaute werden
 * ausgeschrieben (ue statt u), wie es Schweizer Ortsnamen in URLs halten.
 */
export function gemeindeSlug(name: string): string {
  return name
    .toLocaleLowerCase('de-CH')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** What the extension reports about a hand-started scrape run. */
export interface QuellenLaufStatus {
  laeuft: boolean
  gestartet_um: string | null
  beendet_um: string | null
  quellen: Record<string, unknown> | null
  sport: Record<string, unknown> | null
  fehler: string | null
}

function anzahl(wert: unknown): number {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : 0
}

/**
 * One sentence about the run, from whatever the counters say.
 *
 * Null while nothing ever ran — the button explains itself, a status line
 * about nothing would only add noise.
 */
export function quellenLaufText(status: QuellenLaufStatus): string | null {
  if (status.laeuft) {
    return 'Der Lauf ist unterwegs — das dauert einige Minuten, die Ansicht aktualisiert sich von selbst.'
  }
  if (status.beendet_um === null) return null

  const teile: string[] = []
  if (status.quellen !== null) {
    const q = status.quellen
    teile.push(
      `Datenquellen: ${anzahl(q.neu)} neu, ${anzahl(q.geaendert)} geändert, ${anzahl(q.bewertet)} bewertet`
    )
    const fehler = Array.isArray(q.fehler) ? q.fehler.length : 0
    if (fehler > 0) teile.push(`${fehler} Quelle(n) mit Fehler`)
  }
  if (status.sport !== null) {
    const s = status.sport
    teile.push(`Sport: ${anzahl(s.neu)} neu, ${anzahl(s.aktualisiert)} aktualisiert`)
  }

  if (teile.length === 0) return 'Der letzte Lauf hat nichts zurückgemeldet.'

  const uhrzeit = new Date(status.beendet_um).toLocaleTimeString('de-CH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich'
  })
  return `Letzter Lauf um ${uhrzeit} Uhr — ${teile.join(' · ')}.`
}

/**
 * Der Link auf eine Seite einer Wochenblatt-Ausgabe — dasselbe Muster, mit dem
 * das Backend die Quelle-Zeile baut: `#page=N` fuer PDF-Viewer, ein
 * Pfadsegment fuer den issuu-Reader (der Fragmente ignoriert).
 */
export function seitenLink(pdfUrl: string, seite: number | null): string {
  if (seite === null) return pdfUrl
  try {
    if (/(^|\.)issuu\.com$/i.test(new URL(pdfUrl).host)) {
      return `${pdfUrl.replace(/\/$/, '')}/${seite}`
    }
  } catch {
    // Keine parsbare URL — das Fragment ist der harmlose Normalfall.
  }
  return `${pdfUrl}#page=${seite}`
}

/**
 * Ob ein Wochenblatt-Kandidat noch auf dem Tisch der Redaktorin liegt.
 *
 * Der Tisch zeigt Arbeit, nicht Geschichte: offen heisst unbearbeitet, eine
 * übernommene Meldung bleibt sichtbar, solange sie im Redigierprozess steckt.
 * Publiziert oder verworfen ist erledigt — weg vom Tisch, genau wie abgelehnte
 * und weitergereichte Kandidaten. Die Zeilen selbst bleiben in der Datenbank:
 * sie sind das Gedächtnis des Inventars.
 */
export function bleibtAufDemTisch(entscheid: string, meldungStatus: string | null): boolean {
  if (entscheid === 'offen') return true
  if (entscheid !== 'uebernommen') return false
  if (meldungStatus === null) return false
  return meldungStatus !== 'publiziert' && meldungStatus !== 'verworfen'
}
