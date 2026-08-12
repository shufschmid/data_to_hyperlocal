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

/** Whether anything is still being worked on — drives the polling. */
export function istBeschaeftigt(meldungen: readonly MeldungFelder[]): boolean {
  return meldungen.some((m) => m.verarbeitung === 'geplant' || m.verarbeitung === 'laeuft')
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

export interface BezirkGruppe<T> {
  bezirk: string
  gemeinden: T[]
}

/**
 * Groups municipalities by district, districts in alphabetical order.
 *
 * 86 switches in one flat list is not a control, it is a wall. The districts are
 * the natural grouping — they are how the canton is organised and how an editor
 * thinks about coverage.
 */
export function nachBezirk<T extends { bezirk: string; name: string }>(
  gemeinden: readonly T[]
): BezirkGruppe<T>[] {
  const gruppen = new Map<string, T[]>()

  for (const g of gemeinden) {
    const bisher = gruppen.get(g.bezirk)
    if (bisher === undefined) gruppen.set(g.bezirk, [g])
    else bisher.push(g)
  }

  return [...gruppen.entries()]
    .map(([bezirk, liste]) => ({
      bezirk,
      gemeinden: [...liste].sort((a, b) => a.name.localeCompare(b.name, 'de-CH'))
    }))
    .sort((a, b) => a.bezirk.localeCompare(b.bezirk, 'de-CH'))
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
 * Ein Datensatz, der schon an einem Agenda-Eintrag haengt, erscheint nur dort —
 * sonst stuende dieselbe Statistik zweimal untereinander, einmal mit dem Titel
 * des Amts und einmal mit dem des Portals.
 */
export function zeitleiste(quellen: ZeitleistenQuellen, hoechstens = 40): ZeitleistenErgebnis {
  const laufZu = new Map<string, string>()
  for (const lauf of quellen.laeufe) {
    if (lauf.datensatz !== null && !laufZu.has(lauf.datensatz.id)) {
      laufZu.set(lauf.datensatz.id, lauf.id)
    }
  }

  const ausAgenda = new Set<string>()
  const eintraege: ZeitleistenEintrag[] = []

  for (const a of quellen.ankuendigungen) {
    if (a.datensatz !== null) ausAgenda.add(a.datensatz.id)

    eintraege.push({
      id: `agenda-${a.id}`,
      herkunft: 'agenda',
      datum: a.datum,
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
      titel: b.titel === '' ? `Zweig ${b.pfad}` : `${b.pfad} — ${b.titel}`,
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
