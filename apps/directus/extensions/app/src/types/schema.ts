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
  /**
   * The municipality's postcodes. The gazette portal indexes half its
   * publications by PLACE (the BFS number) and the other half by ADDRESS — the
   * commercial register, bankruptcies, payment orders. Without this the second
   * half of a municipality is invisible, which is why the Gemeinden card says
   * so rather than showing an empty desk.
   */
  plz: string[] | null
  date_created: string | null
  date_updated: string | null
}

/** Picks the adapter in `shared/` that knows how to read a source. */
export type QuellenTyp = 'ods' | 'agenda' | 'statbl' | 'amtsblatt'

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
   * The agenda topic this dataset belongs to, where one does.
   *
   * A publication of the office routinely spans several datasets — "Bau- und
   * Wohnbaustatistik 2025" is the newly built flats and the housing stock at
   * once. All of them point back at the one announcement, which is what lets
   * the timeline show the topic instead of the same thing three times.
   * `ankuendigungen.datensatz` names the primary one in the other direction —
   * the one the "Meldungen erzeugen" button opens a run for.
   */
  ankuendigung: string | null
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
  | 'geplant'
  | 'briefing'
  | 'schreibt'
  | 'bereit'
  | 'fehler'

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
  | 'entwurf'
  | 'in_pruefung'
  | 'freigegeben'
  | 'publiziert'
  | 'verworfen'

/** Queue state, deliberately separate from the editorial `status`. */
export type MeldungVerarbeitung = 'idle' | 'geplant' | 'laeuft' | 'fehler'

export type Entscheidung = 'ja' | 'nein' | 'unklar'

/**
 * An article, whatever it was written from.
 *
 * Three kinds share this collection, and exactly one of the three parent fields
 * is set on any row: `lauf` for a statistics article, `spiel` for a match
 * report, `erscheint_am` for a waste-collection reminder. Giving each its own
 * collection would have meant building the review, chat, counter-check and
 * publishing machinery three times, so they join the existing one — at the cost
 * of three partial unique indexes instead of one plain constraint.
 */
export interface Meldung {
  id: string
  /** Set for statistics articles. Null for match reports and reminders. */
  lauf: string | null
  /** Set for match reports. Null otherwise. */
  spiel: string | null
  /**
   * The newsletter day a reminder appears on. Set only for waste-collection
   * reminders, and what the scheduled publisher matches on: a reminder is
   * published the evening before this date, because the Dorfkönig assembles the
   * newsletter then.
   */
  erscheint_am: string | null
  /** Set for press-review articles from a Wochenblatt candidate. Null otherwise. */
  kandidat: string | null
  /** Set for articles written from an official gazette publication. Null otherwise. */
  amtsblattmeldung: string | null
  /**
   * Mirror of the candidate's Perle verdict, for downstream readers of
   * published press reviews. The Chefredaktion decides on the CANDIDATE
   * (`wochenblattkandidaten.perle`) — independent of whether a Meldung ever
   * exists; the hook copies the verdict onto the Meldung at publish time.
   * Unpublished never carries a Perle.
   */
  perle: boolean | null
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

/** Which source a club's results are read from — picks the connector. */
export type VereinsQuelle =
  | 'manuell'
  | 'fvnws'
  | 'swissvolley'
  | 'handball'
  | 'basketplan'

/** Whether a club carries regional reach or speaks for the village. */
export type VereinsBedeutung = 'aushaengeschild' | 'breitensport'

export interface Verein {
  id: string
  name: string
  gemeinde: string
  sportart: string
  bedeutung: VereinsBedeutung
  /** A snapshot that goes stale every season — never a fact in an article. */
  liga: string | null
  spielort: string | null
  /**
   * The newsroom's own reasoning about the club. Belongs in the user turn of a
   * prompt, never in the cached system prefix — it is per-municipality.
   */
  notiz: string | null
  quelle: VereinsQuelle
  externe_id: string | null
  ergebnis_url: string | null
  /**
   * False only for clubs a connector proposed. Nothing proposes yet — every
   * club today is either seeded or typed in from the Gemeinden tab, and both
   * arrive confirmed. The flag is the affordance waiting for that connector.
   */
  zuordnung_geprueft: boolean
  aktiv: boolean
  date_created: string | null
  date_updated: string | null
}

export interface Spiel {
  id: string
  /**
   * The identity at the source, not always a number: football uses the
   * association's Spielnummer, volleyball has none and the connector composes
   * one from the pairing.
   */
  spielnummer: string
  verein: string | null
  gemeinde: string | null
  sportart: string
  /** ISO instant of kick-off. */
  datum: string
  heim: string
  gast: string
  tore_heim: number | null
  tore_gast: number | null
  wettbewerb: string
  ort: string | null
  status: string | null
  quelle_url: string | null
  date_created: string | null
  date_updated: string | null
}

export type KalenderStatus =
  | 'hochgeladen'
  | 'extrahiert'
  | 'geprueft'
  | 'fehler'

/**
 * The printed waste calendar of one municipality for one year.
 *
 * The PDF is the source of record: municipalities proof-read what goes into the
 * letterbox more carefully than what goes on the website, and the printed grid
 * states weekday and day-of-month for every collection — two independent claims
 * about the same day, which is what lets us check the reading.
 *
 * The PDFs themselves hang below as `entsorgungsdokumente`: municipalities like
 * Riehen print one document per collection zone, so a calendar owns several.
 */
export interface Entsorgungskalender {
  id: string
  gemeinde: string
  jahr: number
  status: KalenderStatus
  /** The regular collections, kept as a note — they deliberately produce no reminders. */
  merkblatt: string | null
  date_created: string | null
  date_updated: string | null
}

export type DokumentStatus = 'hochgeladen' | 'extrahiert' | 'fehler'

/** One PDF of a calendar — for Riehen, one per zone. */
export interface Entsorgungsdokument {
  id: string
  kalender: string
  /** The zone this PDF covers ("Zone 1"). Null when one document covers the whole municipality. */
  zone: string | null
  status: DokumentStatus
  /** Directus Files id of the PDF itself. */
  pdf: string | null
  quelle_url: string | null
  /**
   * The editor's note about the zone — "Umfasst auch die Gemeinde Bettingen
   * (BS)." Stated in every reminder of this zone, never inferred by a model.
   */
  zusatz: string | null
  extraktion: Record<string, unknown> | null
  fehler: string | null
  date_created: string | null
  date_updated: string | null
}

/**
 * One exceptional collection date.
 *
 * A weekly Hauskehricht never becomes a row here: residents know their fixed
 * weekday, and reminding them every week would teach them to ignore the ones
 * that matter.
 */
export interface Entsorgungstermin {
  id: string
  kalender: string
  /** Which PDF this date came from — the scope of a re-extraction. */
  dokument: string | null
  kategorie: string
  /** Binningen's plateaus and their like. Null where the municipality has no zones. */
  zone: string | null
  datum: string
  /** When set, the reminder is timed to this instead of to `datum`. */
  anmeldeschluss: string | null
  /** `HH:MM` — after 10:00 the deadline day's own edition still reaches readers. */
  anmeldeschluss_zeit: string | null
  bereitstellung: string | null
  anmeldung: string | null
  /** Weekday in the PDF disagrees with the date — for a human, not for the code. */
  warnung: string | null
  geprueft: boolean
  /** The reminder this date appears in. Several dates can share one. */
  meldung: string | null
  date_created: string | null
  date_updated: string | null
}

/** The weekly paper of one municipality and where its PDF archive lives. */
export interface Wochenblatt {
  id: string
  gemeinde: string
  /** As printed on the masthead — this exact name appears in every attribution. */
  name: string
  /** The public issue archive. Only this page is ever read; URLs are never guessed. */
  archiv_url: string
  /** Which parser reads the archive — the next paper with a different layout gets its own value. */
  konnektor: 'wordpress-archiv' | 'lokalzeitungen' | 'issuu' | 'localpoint'
  aktiv: boolean
  letzte_pruefung: string | null
  letzter_fehler: string | null
  date_created: string | null
  date_updated: string | null
}

export type AusgabeStatus = 'neu' | 'liest' | 'inventarisiert' | 'fehler'

/** One issue: the PDF, its text layer, and the inventory of exclusive pieces. */
export interface Wochenblattausgabe {
  id: string
  wochenblatt: string
  /** Canonical identity ("kw34-2026"), slug suffixes normalized away — the idempotency key. */
  schluessel: string
  slug: string | null
  /** As the paper prints it — "34" or "30/31". Part of every attribution. */
  nummer: string | null
  datum: string | null
  seite_url: string | null
  /** The resolved PDF address. With `#page=N` a Meldung links straight to the piece. */
  pdf_url: string | null
  pdf: string | null
  seiten: number | null
  status: AusgabeStatus
  /** The PDF's text layer — the corpus the verbatim-overlap check runs against. */
  volltext: string | null
  /** The same text page by page — the workspace shows the original wording next to a proposal. */
  seiten_texte: string[] | null
  inventar: Record<string, unknown> | null
  fehler: string | null
  date_created: string | null
  date_updated: string | null
}

export type KandidatTyp =
  | 'interview'
  | 'reportage'
  | 'portraet'
  | 'hintergrund'
  | 'vereinsleben'
  | 'veranstaltung'
  | 'service'
  | 'erfolgsmeldung'
  | 'fotoverweis'

/** `weitergereicht`: good piece, not verifiable today — handed to the Chefredaktion as a lead. */
export type KandidatEntscheid =
  | 'offen'
  | 'uebernommen'
  | 'abgelehnt'
  | 'weitergereicht'

export type Ablehnungsgrund =
  | 'nicht_relevant'
  | 'doublette'
  | 'veraltet'
  | 'falsche_gemeinde'
  | 'andere'

/** One municipality a paper covers — the Muttenzer & Prattler Anzeiger has two. */
export interface Wochenblattgemeinde {
  id: string
  wochenblatt: string
  gemeinde: string
  date_created: string | null
}

export type HinweisStatus = 'offen' | 'brauchbar' | 'kein_hinweis'

/**
 * A research lead the paper carries — usually a Leserbrief. NEVER published
 * unchecked: leads are work for the newsroom, not content. The editor's
 * verdict (brauchbar / kein Hinweis) teaches the next inventory what a lead is.
 */
export interface Recherchehinweis {
  id: string
  ausgabe: string
  gemeinde: string | null
  titel: string
  /** Where it stands — "Leserbrief 'Wertvoller Regen', S. 2". */
  fundort: string | null
  /** The page as a number — what the source link and the original-text box key on. */
  seite: number | null
  begruendung: string | null
  /** The page's own text layer, copied at creation — the lead outlives its issue's row. */
  quelltext: string | null
  status: HinweisStatus
  kommentar: string | null
  date_created: string | null
  date_updated: string | null
}

/**
 * One exclusive piece of an issue, as the inventory proposed it.
 *
 * The editor's decision on it — taken over, or rejected with a reason — is the
 * learning signal: recent decisions ride into the next inventory's user turn
 * as examples, so the proposals grow towards the newsroom's taste.
 */
export interface Wochenblattkandidat {
  id: string
  ausgabe: string
  /**
   * Which municipality the piece is about — assigned by the inventory (page
   * index top-left where present, content otherwise), correctable by the
   * editor. Null only for papers covering a single municipality anyway.
   */
  gemeinde: string | null
  /** Set by the hook when the editor reassigns — the learning signal. */
  gemeinde_korrigiert: boolean
  /** As printed in the paper. */
  titel: string
  seite: number | null
  typ: KandidatTyp
  /** Teased on the front page — what sits there is often the most interesting. */
  frontseite: boolean
  warum_exklusiv: string | null
  /** Bare facts from the piece — the ONLY source the drafting call ever sees. */
  zusammenfassung: string | null
  /** Curious AND of supra-local interest — could amuse the city of Basel too. */
  perle_vorschlag: boolean
  perle_begruendung: string | null
  /**
   * The Chefredaktion's verdict on that proposal — independent of whether the
   * candidate ever becomes a Meldung. Null while it sits on her desk; a
   * pending proposal survives the desk cleanup on purpose.
   */
  perle: boolean | null
  entscheid: KandidatEntscheid
  /** The learning signal: flows into the next inventory's digest. */
  ablehnungsgrund: Ablehnungsgrund | null
  ablehnungskommentar: string | null
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
  portal_bereiche: PortalBereich[]
  portal_seiten: PortalSeite[]
  vereine: Verein[]
  spiele: Spiel[]
  entsorgungskalender: Entsorgungskalender[]
  entsorgungsdokumente: Entsorgungsdokument[]
  entsorgungstermine: Entsorgungstermin[]
  wochenblaetter: Wochenblatt[]
  wochenblattausgaben: Wochenblattausgabe[]
  wochenblattkandidaten: Wochenblattkandidat[]
  wochenblattgemeinden: Wochenblattgemeinde[]
  recherchehinweise: Recherchehinweis[]
}

/** Which of the five piles a publication belongs to — see `shared/amtsblatt`. */
export type AmtsblattGruppe =
  | 'bauen'
  | 'wirtschaft'
  | 'behoerden'
  | 'grundbuch'
  | 'personen'

export type AmtsblattEntscheid =
  | 'offen'
  | 'uebernommen'
  | 'abgelehnt'
  | 'weitergereicht'

/** How far we got with the documents a publication points at. */
export type PlanStatus =
  | 'offen'
  | 'liest'
  | 'gelesen'
  | 'nicht_lesbar'
  | 'fehler'

/**
 * One official publication, assigned to a municipality.
 *
 * The decision rows ARE this feed's memory: `entscheid` plus its reason ride
 * into the next triage for the same municipality as few-shot examples. No
 * distillation call, no second store — the same arrangement as the press
 * review.
 */
export interface Amtsblattmeldung {
  id: string
  /** The identity at the portal. Unique — the clamp that makes a second run idempotent. */
  publikations_id: string
  publikationsnummer: string | null
  gemeinde: string
  kanton: string | null
  gruppe: AmtsblattGruppe | null
  rubrik: string | null
  unterrubrik: string | null
  rubrik_name: string | null
  titel: string
  publiziert_am: string | null
  /** Objection or inspection deadline. The figure that makes an article urgent. */
  frist: string | null
  amt: string | null
  /** The official PDF. Built by code, never written by a model. */
  pdf_url: string | null
  /** Labelled facts from the single publication. Filled when someone acts on the row. */
  angaben: { bezeichnung: string; wert: string }[] | null
  /** What the publication points at. `lesbar` says whether WE can read it. */
  unterlagen:
    | {
        art: 'plaene' | 'akten' | 'karte' | 'ebau' | 'andere'
        bezeichnung: string
        url: string
        lesbar: boolean
      }[]
    | null
  /** Natural persons the publication names — handed to the prompt as "do not name". */
  personen: string[] | null
  /** What the plans yielded, each finding with the sheet it was read from. */
  planbefunde: string[] | null
  plan_status: PlanStatus
  plan_fazit: string | null
  /** The triage's verdict. Null means "not judged yet" — NOT "no". */
  vorschlag: boolean | null
  vorschlag_begruendung: string | null
  entscheid: AmtsblattEntscheid
  ablehnungsgrund: string | null
  ablehnungskommentar: string | null
  date_created: string | null
  date_updated: string | null
}

// ---------------------------------------------------------------------------
// Die zwei Sendungen: SRF Regionaljournal Basel Baselland und punkt6 (Telebasel)
//
// Portiert aus dem Schwesterprojekt shufschmid/regionaljournal. Die
// Kollektionsnamen sind bewusst unveraendert uebernommen — ein Umbenennen haette
// jede Zeile des portierten Codes zum Suchlauf gemacht, ohne Gegenwert.
//
// Ein Unterschied zum Original: die Beitraege tragen KEINEN
// draft/published-Status. Der stammte aus einem verworfenen Entwurf und haette
// hier zwei Bedeutungen von "publizieren" nebeneinandergestellt — im Dashboard
// heisst das eine Sache: eine Meldung geht zum Dorfkoenig.
// ---------------------------------------------------------------------------

export type DossierStatus = 'pending' | 'processing' | 'processed' | 'failed'

export interface Dossier {
  id: string
  status: DossierStatus
  /** FK -> directus_files.id. The uploaded/fetched dossier PDF. */
  source_file: string
  /** IMAP Message-ID, when the dossier arrived by mail. Null for a manual upload. */
  source_message_id: string | null
  source_subject: string | null
  /** Set by dossiers-process-pending / dossier-process when status becomes 'failed'. */
  error_message: string | null
  processed_at: string | null
  date_created: string | null
  date_updated: string | null
}

export type EditionLabel = 'Morgen' | 'Mittag' | 'Abend'

export interface TranscriptParagraph {
  timestamp: string
  seconds: number
  text: string
}

/**
 * Written only by the Claude topic-extraction call in process-dossier.ts.
 * `paragraphTimestamp`/`paragraphSeconds` are null when the topic could not be
 * matched to a real paragraph — the frontend shows the headline without a listen
 * link in that case, rather than forcing a guess.
 */
export interface ExtraTopic {
  headline: string
  paragraphTimestamp: string | null
  paragraphSeconds: number | null
  summary: string | null
}

export interface Edition {
  id: string
  /** FK -> dossiers.id. One dossier can produce several editions. */
  dossier: string
  broadcast_date: string
  /** Derived from the SRGSSR episode's own `date` hour; null while unresolved. */
  edition_label: EditionLabel | null
  broadcast_at: string | null
  headline: string
  lead: string | null
  /** `cast-json` column: free prose, so not `cast-csv` (which would corrupt on commas). */
  teaser_blocks: string[] | null
  /** SRGSSR `podcastHdUrl` — a direct, public MP3, no iframe embed needed. */
  audio_url: string | null
  srgssr_urn: string | null
  /** `cast-json` column. */
  transcript: TranscriptParagraph[] | null
  /** `cast-json` column. */
  extra_topics: ExtraTopic[] | null
  /** Set per-segment when SRGSSR resolution fails; the edition still gets created, just without audio. */
  resolution_error: string | null
  date_created: string | null
  date_updated: string | null
}

export type Punkt6DossierStatus = DossierStatus

export interface Punkt6Dossier {
  id: string
  status: Punkt6DossierStatus
  source_file: string
  source_message_id: string | null
  source_subject: string | null
  error_message: string | null
  processed_at: string | null
  date_created: string | null
  date_updated: string | null
}

/**
 * One entry per Beitrag other than the Hauptbeitrag — the same role as
 * `ExtraTopic`, but always fully resolved: telebasel.ch publishes exact segment
 * boundaries, so there is no "unmatched" case the way a Claude-guessed
 * timestamp can be null.
 */
export interface Punkt6ExtraTopic {
  headline: string
  summary: string | null
  startSeconds: number
  endSeconds: number
}

export interface Punkt6Edition {
  id: string
  /** FK -> punkt6_dossiers.id. One dossier (one episode) produces exactly one edition. */
  dossier: string
  broadcast_date: string
  /** The Hauptbeitrag's title, from telebasel.ch's first Clip. Editable. */
  headline: string
  lead: string | null
  /** `cast-json` column: the WHOLE episode's transcript, not just the Hauptbeitrag's slice. */
  transcript: TranscriptParagraph[] | null
  /** Where the Hauptbeitrag sits within the shared episode video, in seconds. */
  main_start_seconds: number | null
  main_end_seconds: number | null
  /** `cast-json` column: every other Beitrag of this Sendung. */
  extra_topics: Punkt6ExtraTopic[] | null
  /** Resolved video of the WHOLE episode, shared by every Beitrag. */
  video_url: string | null
  /** The telebasel.ch episode page, for an editorial "view original" link. */
  episode_url: string | null
  /** Set when no telebasel.ch episode was found; the edition still gets created. */
  resolution_error: string | null
  date_created: string | null
  date_updated: string | null
}
