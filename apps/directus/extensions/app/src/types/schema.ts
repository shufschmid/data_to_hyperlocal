// Typed view of the collections this application owns.
//
// Keep it in sync with the data model by hand, or regenerate it: the bundled
// `directus-extension-ts-typegen` module (Settings → TypeScript Types in the
// admin UI) writes these types from the live schema. Paste the result here and
// keep the hand-written notes.
//
// The frontend does NOT import this file — it is a separate npm package. It
// generates its own types from the GraphQL schema (`npm run codegen` in
// apps/front). One data model, two generated views of it.
//
// Relation fields are typed as `string` (the uuid), which is what an
// ItemsService read returns unless the query asks for the nested object.

/** Municipalities. Identity is `bfs_nummer`, never `name` — see the migration. */
export interface Gemeinde {
  id: string
  bfs_nummer: number
  name: string
  bezirk: string
  aktiv: boolean
  date_created: string | null
  date_updated: string | null
}

/** Picks the adapter in `shared/` that knows how to read a source. */
export type QuellenTyp = 'ods' | 'agenda' | 'statbl'

export interface Quelle {
  id: string
  name: string
  typ: QuellenTyp
  basis_url: string
  konfiguration: Record<string, unknown> | null
  aktiv: boolean
  letzte_pruefung: string | null
  letzter_fehler: string | null
  date_created: string | null
  date_updated: string | null
}

export type DatensatzStatus = 'neu' | 'relevant' | 'ignoriert' | 'aufbereitet'

/**
 * A field as the source portal describes it.
 *
 * Structurally identical to `OdsField` in `shared/ods/parse.ts` on purpose: the
 * portal's field list is stored verbatim, so the two must stay assignable in
 * both directions. Optional properties here would break that quietly.
 */
export interface DatensatzFeld {
  name: string
  type: string
  label: string | null
  description: string | null
}

export interface Datensatz {
  id: string
  quelle: string | null
  externe_id: string
  titel: string
  beschreibung: string | null
  portal_modified: string | null
  felder: DatensatzFeld[] | null
  hat_gemeinde: boolean
  /**
   * Manual override of the municipality column, when detection finds none.
   * Exact field name in the portal; validated against the real field list.
   */
  gemeindefeld: string | null
  /**
   * The instruction every new run for this dataset inherits.
   *
   * This is the memory: next year's edition of the same table is written up
   * from the same brief instead of a blank one.
   */
  standard_vorgabe: string | null
  /**
   * The content fingerprint a run was last opened for.
   *
   * Equal to `letzter_stand` means this state of the data is dealt with. It is
   * what keeps a dataset that can never open a run from holding a seat in the
   * queue for ever.
   */
  lauf_stand: string | null
  /**
   * When the municipality column was checked against real values.
   *
   * The metadata alone cannot tell a district column from a municipality one —
   * the office marks both with the same concept URI.
   */
  gemeinde_geprueft: string | null
  /** Update rhythm the catalogue declares: `annual`, `daily`, `irregular`, … */
  rhythmus: string | null
  /** When the data itself last moved — unlike `portal_modified`. */
  daten_stand: string | null
  zeilen: number | null
  /**
   * Fingerprint of the content, not of the metadata. The portal's `modified`
   * timestamp also moves when someone fixes a description, and re-running on
   * that would produce articles nobody asked for.
   */
  letzter_stand: string | null
  status: DatensatzStatus
  bewertung: string | null
  date_created: string | null
  date_updated: string | null
}

export type LaufStatus =
  'geplant' | 'briefing' | 'schreibt' | 'bereit' | 'fehler'

export interface Lauf {
  id: string
  datensatz: string
  /** "2025" for a yearly statistic, "2026-06-14" for a referendum. */
  periode: string
  status: LaufStatus
  briefing: string | null
  kontext: Record<string, unknown> | null
  /**
   * What the editor asked this run to write, verbatim. Feeds the briefing and
   * the cached article prefix — per run, never per municipality.
   */
  vorgabe: string | null
  fehler: string | null
  versuche: number
  gesperrt_bis: string | null
  date_created: string | null
  date_updated: string | null
}

export type MeldungStatus =
  'entwurf' | 'in_pruefung' | 'freigegeben' | 'publiziert' | 'verworfen'

/** Queue state, deliberately separate from the editorial `status`. */
export type MeldungVerarbeitung = 'idle' | 'geplant' | 'laeuft' | 'fehler'

export type Entscheidung = 'ja' | 'nein' | 'unklar'

export interface Meldung {
  id: string
  lauf: string
  gemeinde: string

  titel: string | null
  lead: string | null
  text: string | null
  status: MeldungStatus

  /** The rows the article was written from — provenance, not a dataset dump. */
  datengrundlage: Record<string, unknown> | null
  /** `cast-csv`, so a string array in and out — never a joined string. */
  zeit_warnungen: string[] | null

  verarbeitung: MeldungVerarbeitung
  anweisung: string | null
  versuche: number
  gesperrt_bis: string | null
  fehler: string | null

  /** SHA-256 hex of the approval token. The token itself is never stored. */
  freigabe_token_hash: string | null
  freigabe_token_ablauf: string | null
  entscheidung: Entscheidung | null
  entscheidung_klartext: string | null
  freigegeben_am: string | null
  publiziert_am: string | null

  date_created: string | null
  date_updated: string | null
}

export type AnkuendigungStatus = 'geplant' | 'publiziert'

/**
 * An announced or freshly published statistic, from the office's agenda page.
 *
 * One row per statistic, not one per sighting: `schluessel` is derived from the
 * title alone so an entry that moves from `geplant` to `publiziert` stays the
 * same row. See the migration for why that matters.
 */
export interface Ankuendigung {
  id: string
  quelle: string
  schluessel: string
  titel: string
  status: AnkuendigungStatus
  /** Publication date from the agenda. Null while only announced. */
  datum: string | null
  quartal: string | null
  link: string | null
  /** The portal dataset this refers to, once it appears there. */
  datensatz: string | null
  /** When we last looked for that dataset. Null means: not looked yet. */
  zuordnung_geprueft: string | null
  /**
   * When this entry's link was last followed.
   *
   * Separate from `zuordnung_geprueft` because the two answer different
   * questions, and an entry whose linked table has no municipality breakdown
   * must not be retried for ever.
   */
  link_geprueft: string | null
  /** Why this dataset was picked — or why none fits. */
  zuordnung_hinweis: string | null
  erstmals_gesehen: string | null
  publiziert_seit: string | null
  date_created: string | null
  date_updated: string | null
}

/**
 * A branch of the statistics portal — the unit "Letzte Änderung" is published
 * for, and therefore the only unit that can be watched.
 */
export interface PortalBereich {
  id: string
  /** e.g. "5_1". */
  pfad: string
  titel: string
  /** The date the branch page states, ISO. */
  stand: string | null
  beobachten: boolean
  inventur_offen: boolean
  letzte_pruefung: string | null
  letzter_fehler: string | null
  /** Pages whose layout the inventory could not place. */
  unklar: number
  date_created: string | null
  date_updated: string | null
}

export type PortalSeitenArt = 'offen' | 'tabelle' | 'navigation'

export interface PortalSeite {
  id: string
  pfad: string
  bereich: string | null
  titel: string
  art: PortalSeitenArt
  form: 'lang' | 'breit' | null
  gemeindeebene: boolean
  /** How many of the 86 municipalities the first column matched. */
  treffer: number
  /** `externe_id` of the open-data dataset covering this table, if any. */
  ods_datensatz: string | null
  ankuendigung: string | null
  datensatz: string | null
  /** Municipality level, no dataset, no agenda entry. */
  beobachten: boolean
  hinweis: string | null
  geprueft_am: string | null
  date_created: string | null
  date_updated: string | null
}

export type ChatRolle = 'user' | 'assistant'

export interface ChatNachricht {
  id: string
  /** Exactly one of `lauf` / `meldung` is set — enforced by a CHECK constraint. */
  lauf: string | null
  meldung: string | null
  rolle: ChatRolle
  inhalt: string
  position: number
  date_created: string | null
}

export type Geltungsbereich = 'datensatz' | 'quelle' | 'global'
export type WissenHerkunft = 'chat' | 'manuell'

export interface Redaktionswissen {
  id: string
  datensatz: string | null
  quelle: string | null
  regel: string
  geltungsbereich: Geltungsbereich
  herkunft: WissenHerkunft
  aktiv: boolean
  date_created: string | null
  date_updated: string | null
}

export interface Schema {
  gemeinden: Gemeinde[]
  quellen: Quelle[]
  datensaetze: Datensatz[]
  ankuendigungen: Ankuendigung[]
  laeufe: Lauf[]
  meldungen: Meldung[]
  chat_nachrichten: ChatNachricht[]
  redaktionswissen: Redaktionswissen[]
}
