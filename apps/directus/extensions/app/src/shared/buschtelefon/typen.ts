// The types of the Buschtelefon's hand-over door, format `buschtelefon-redaktion/2`.
//
// The contract is apps/directus/BUSCHTELEFON_SCHNITTSTELLE.md and it is the
// source of truth for every name here; section numbers in the comments refer
// to it. The Buschtelefon hands over RAW MATERIAL and facts, never a verdict:
// posts of Facebook groups (later Instagram, TikTok) with their image texts,
// links, shared posts and comments.
//
// Every enum is an `as const` array so the parser can check a delivered value
// against it — an unknown value is kept out with a reason, never guessed.

export const FORMAT = 'buschtelefon-redaktion/2'

export const KANAELE = ['facebook', 'instagram', 'tiktok'] as const
export type Kanal = (typeof KANAELE)[number]

export const FUND_STATUS = ['aktiv', 'nicht_erreichbar', 'entfernt'] as const
export type FundStatus = (typeof FUND_STATUS)[number]

export const ENTFERNT_GRUENDE = [
  'an_der_quelle_geloescht',
  'loeschbegehren',
  'quelle_abgemeldet'
] as const
export type EntferntGrund = (typeof ENTFERNT_GRUENDE)[number]

/** What changed against the previously released state (4.1). */
export const AENDERUNGEN = [
  'neu',
  'text',
  'kommentare',
  'bilder',
  'verlinkt',
  'geteilt',
  'herkunft',
  'doublette',
  'status'
] as const
export type Aenderung = (typeof AENDERUNGEN)[number]

/** A personal profile is never a source; `konto` is an organisation's account (3.5). */
export const QUELLEN_ARTEN = [
  'gruppe',
  'seite',
  'konto',
  'hashtag',
  'rundgang'
] as const
export type QuellenArt = (typeof QUELLEN_ARTEN)[number]

export const SICHTBARKEITEN = [
  'oeffentlich',
  'geschlossen',
  'unbekannt'
] as const
export type Sichtbarkeit = (typeof SICHTBARKEITEN)[number]

export const ZUGAENGE = ['ohne_anmeldung', 'mitgliedskonto'] as const
export type Zugang = (typeof ZUGAENGE)[number]

export const QUELLEN_STAENDE = [
  'gelesen',
  'teilweise',
  'fehlgeschlagen',
  'nicht_versucht'
] as const
export type QuellenStand = (typeof QUELLEN_STAENDE)[number]

export const DATUM_GENAUIGKEITEN = [
  'minute',
  'stunde',
  'tag',
  'ungefaehr',
  'unbekannt'
] as const
export type DatumGenauigkeit = (typeof DATUM_GENAUIGKEITEN)[number]

/** What the platform shows, not a judgement (4.3). */
export const AUTOR_ARTEN = ['profil', 'seite', 'anonym', 'unbekannt'] as const
export type AutorArt = (typeof AUTOR_ARTEN)[number]

/** Only from the Buschtelefon's own list of known pages, never guessed (4.3). */
export const AUTOR_ROLLEN = ['behoerde', 'medium', 'organisation'] as const
export type AutorRolle = (typeof AUTOR_ROLLEN)[number]

export const BILD_ARTEN = [
  'foto',
  'flyer',
  'screenshot',
  'textkachel',
  'dokument',
  'privatchat',
  'ausweis_dokument',
  'video',
  'unbekannt'
] as const
export type BildArt = (typeof BILD_ARTEN)[number]

/** The five states of an image's text — never to be confused (4.5). */
export const BILD_TEXT_STATUS = [
  'gelesen',
  'kein_text',
  'nicht_lesbar',
  'nicht_versucht',
  'zurueckgehalten'
] as const
export type BildTextStatus = (typeof BILD_TEXT_STATUS)[number]

export const LINK_TEXT_STATUS = [
  'gelesen',
  'nicht_versucht',
  'nicht_lesbar'
] as const
export type LinkTextStatus = (typeof LINK_TEXT_STATUS)[number]

export const KOMMENTAR_KENNUNG_ARTEN = ['plattform', 'abgeleitet'] as const
export type KommentarKennungArt = (typeof KOMMENTAR_KENNUNG_ARTEN)[number]

export const KOMMENTAR_STAENDE = [
  'sichtbar',
  'nicht_mehr_gesehen',
  'entfernt'
] as const
export type KommentarStand = (typeof KOMMENTAR_STAENDE)[number]

export const KOMMENTARE_STAENDE = [
  'vollstaendig',
  'gedeckelt',
  'teilweise',
  'unbekannt'
] as const
export type KommentareStand = (typeof KOMMENTARE_STAENDE)[number]

export const AUSGELASSEN_GRUENDE = [
  'kein_link',
  'keine_stabile_kennung'
] as const
export type AusgelassenGrund = (typeof AUSGELASSEN_GRUENDE)[number]

export const QUELLE_OFFEN_GRUENDE = ['lauf_nicht_fertig', 'fehler'] as const
export type QuelleOffenGrund = (typeof QUELLE_OFFEN_GRUENDE)[number]

/** The contract's length limits, in characters. Over the limit is CUT and declared, never dropped. */
export const GRENZEN = {
  kennung: 64,
  quelle: 100,
  quelle_name: 255,
  link: 2000,
  autor_name: 255,
  autor_vorname: 60,
  autor_ref: 8,
  text: 20_000,
  bild_text: 10_000,
  bild_beschreibung: 300,
  verlinkt_titel: 500,
  verlinkt_text: 8_000,
  kommentar_text: 5_000,
  quelle_fehler: 500,
  hinweis: 500
} as const

/** One image or video of a post, a comment or a shared post (4.5). The file itself never changes systems. */
export interface Bild {
  nr: number
  art: BildArt
  text_status: BildTextStatus
  /** The text in the image, verbatim. Null for every status but `gelesen`. */
  text: string | null
  text_abgeschnitten: boolean
  beschreibung: string | null
}

/** A link the post carries (4.6). */
export interface Verlinkt {
  url: string
  kurzlink: boolean
  titel: string | null
  text_status: LinkTextStatus
  text: string | null
  text_abgeschnitten: boolean
}

/** Another post this post shares (4.6) — often the actual news. */
export interface Geteilt {
  /** Only where `autor_rolle` is set; null for a private person's post. */
  link: string | null
  quelle_name: string | null
  autor_art: AutorArt
  autor_rolle: AutorRolle | null
  autor_name: string | null
  veroeffentlicht_am: string | null
  datum_genauigkeit: DatumGenauigkeit
  text: string
  text_abgeschnitten: boolean
  bilder: Bild[]
  n_bilder: number | null
  verlinkt: Verlinkt[]
}

/** One comment of the cumulative list (4.7). */
export interface Kommentar {
  kennung: string
  kennung_art: KommentarKennungArt
  stand: KommentarStand
  erstmals_freigegeben_am: string
  /** `kennung` of the parent; may point at a comment that is not in the list. */
  antwort_auf: string | null
  autor_ref: string | null
  autor_art: AutorArt
  autor_rolle: AutorRolle | null
  autor_name: string | null
  autor_vorname: string | null
  veroeffentlicht_am: string | null
  datum_genauigkeit: DatumGenauigkeit
  /** Verbatim; null for `stand: entfernt`. */
  text: string | null
  text_abgeschnitten: boolean
  bilder: Bild[]
  n_reaktionen: number | null
}

/** A post with everything that hangs on it (4), `status` aktiv or nicht_erreichbar. */
export interface Fund {
  kennung: string
  folge: number
  status: 'aktiv' | 'nicht_erreichbar'
  erstmals_freigegeben_am: string
  geaendert_am: string
  aenderung: Aenderung[]
  /** A calendar day, `YYYY-MM-DD`. */
  beobachtet_bis: string

  kanal: Kanal
  quelle: string
  quelle_name: string
  quelle_art: QuellenArt
  quelle_sichtbarkeit: Sichtbarkeit
  gemeinden_bfs: number[]
  /** Permalink of the original post. Never cut: a truncated address is no address. */
  link: string

  veroeffentlicht_am: string | null
  datum_genauigkeit: DatumGenauigkeit
  /** Only with `ungefaehr`. */
  veroeffentlicht_fruehestens: string | null
  veroeffentlicht_spaetestens: string | null

  autor_art: AutorArt
  autor_rolle: AutorRolle | null
  /** Organisations only — null unless `autor_rolle` is set. */
  autor_name: string | null
  /** One word, never a surname. */
  autor_vorname: string | null
  autor_ref: string | null

  text: string
  text_abgeschnitten: boolean

  bilder: Bild[]
  n_bilder: number | null
  verlinkt: Verlinkt[]
  geteilt: Geteilt | null

  kommentare: Kommentar[]
  kommentare_stand: KommentareStand
  kommentare_fehlend: number | null
  kommentare_geprueft_am: string | null
  n_kommentare: number | null
  n_reaktionen: number | null
  n_geteilt: number | null

  doublette_von: string | null

  /**
   * NOT a field of the door: what THIS side's parser cut, left out or
   * corrected while reading the find, each in a German sentence for the row's
   * `hinweise`. Empty in the normal case.
   */
  kuerzungen: string[]
}

/**
 * The tombstone of 4.9: exactly these fields, everything else must be absent.
 * Only `kennung` and `folge` are demanded of it — a deletion must never be
 * lost to a formality, so every other field is null where it is unreadable.
 */
export interface EntfernterFund {
  kennung: string
  folge: number
  status: 'entfernt'
  /** Null when the door names a reason the contract does not know. */
  entfernt_grund: EntferntGrund | null
  aenderung: Aenderung[]
  erstmals_freigegeben_am: string | null
  geaendert_am: string | null
  kanal: Kanal | null
  quelle: string | null
  gemeinden_bfs: number[]
}

export type FundEintrag = Fund | EntfernterFund

export function istEntfernt(fund: FundEintrag): fund is EntfernterFund {
  return fund.status === 'entfernt'
}

/** A find the Buschtelefon holds but cannot hand over (3.2). Counts against `limit` and carries a `folge`. */
export interface Ausgelassen {
  /** Null where the reason is exactly that no stable one exists. */
  kennung: string | null
  folge: number
  grund: AusgelassenGrund
  quelle: string | null
  kanal: Kanal | null
  gemeinden_bfs: number[]
  veroeffentlicht_am: string | null
}

export interface QuelleOffen {
  quelle: string
  /** Null when the door names a reason the contract does not know. */
  grund: QuelleOffenGrund | null
}

/** The released state both `/funde` and `/quellen` describe (3.2). */
export interface Freigabe {
  /** The calendar day (Europe/Zurich) of the last completed release, `YYYY-MM-DD`. */
  tag: string
  /** The highest `folge` ever given. */
  folge: number
  freigegeben_am: string
  sammellauf_begonnen_am: string | null
  sammellauf_beendet_am: string | null
  quellen_offen: QuelleOffen[]
}

/** One source of `/quellen` (3.5). */
export interface Quelle {
  kennung: string
  kanal: Kanal
  art: QuellenArt
  name: string
  url: string | null
  sichtbarkeit: Sichtbarkeit
  zugang: Zugang | null
  gemeinden_bfs: number[]
  aktiv: boolean
  stand: QuellenStand
  zuletzt_vollstaendig_gelesen_am: string | null
  gelesen_zurueck_bis: string | null
  n_beitraege_gesehen: number | null
  n_aussortiert: number | null
  n_zu_alt: number | null
  fehler_seit: string | null
  letzter_fehler: string | null
  hinweise: string[]
  /** As on a find: what this side's parser cut or corrected. */
  kuerzungen: string[]
}

/** A find (or an `ausgelassen` entry) the parser could not accept — named, so the bookmark can pass it. */
export interface Ungueltig {
  kennung: string | null
  folge: number | null
  grund: string
}

/** One page of `/funde`, validated. */
export interface FundeAntwort {
  freigabe: Freigabe
  /** Ascending by `folge`. */
  funde: FundEintrag[]
  ausgelassen: Ausgelassen[]
  /** The highest `folge` of this page when more follow, else null. */
  weiter: number | null
  ungueltig: Ungueltig[]
}

export interface QuellenAntwort {
  freigabe: Freigabe
  quellen: Quelle[]
  ungueltig: { kennung: string | null; grund: string }[]
}
