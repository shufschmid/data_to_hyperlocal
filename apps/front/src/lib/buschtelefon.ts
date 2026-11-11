import type {
  BuschtelefonBild,
  BuschtelefonFundFelder,
  BuschtelefonGeteilt,
  BuschtelefonHinweisFund,
  BuschtelefonKommentar,
  BuschtelefonQuelleFelder,
  BuschtelefonStandFelder
} from '@/graphql/redaktion'
import { datumText } from './amtsblatt'
import { istVorschlag, STANDARD_EINSTELLUNG } from './tische'

// Presentation rules for the Buschtelefon desk. Pure, so they are tested
// without a component. The desk has the shape of the Kanton and Gemeindeseiten
// desks on purpose — three decisions per row, the run's draft edited on the
// row — and differs in what a row IS: one post of a social-network group with
// its image texts, its links, the post it shares and its comments, delivered
// once a day by the Buschtelefon (contract `buschtelefon-redaktion/2`).
//
// Three things are this desk's own and all three are rules of the newsroom
// (11 November 2026): a find from a CLOSED group may become a Meldung, but the
// Meldung links only the group — so the row has to say unmistakably that the
// group is closed; a first name may be shown, a surname never arrives in a
// field of its own; and the material is emptied after the decision while the
// row stays, so every field here may be null.

export { datumText }

export type Kanal = 'facebook' | 'instagram' | 'tiktok'

/** The filter value for rows no municipality could be assigned to — they are work too. */
export const OHNE_GEMEINDE = 'ohne'

/** `unbestaetigt` and `personenbezug` are this desk's own lessons. */
export const ABLEHNUNGSGRUENDE: { wert: string; text: string }[] = [
  { wert: 'nicht_relevant', text: 'Nicht relevant' },
  { wert: 'unbestaetigt', text: 'Nicht zu bestätigen' },
  { wert: 'personenbezug', text: 'Betrifft eine Privatperson' },
  { wert: 'doublette', text: 'Doublette' },
  { wert: 'veraltet', text: 'Veraltet' },
  { wert: 'andere', text: 'Anderer Grund' }
]

const KANAL_TEXT: Record<string, string> = {
  facebook: 'Facebook-Gruppen',
  instagram: 'Instagram',
  tiktok: 'TikTok'
}

export function kanalText(kanal: string): string {
  return KANAL_TEXT[kanal] ?? kanal
}

/**
 * Anything but an explicitly public source counts as closed. `unbekannt` is
 * closed on purpose: where the Buschtelefon could not tell, the Meldung must
 * not link a post that may sit behind a membership.
 */
export function istGeschlossen(fund: Pick<BuschtelefonFundFelder, 'quelle_sichtbarkeit'>): boolean {
  return fund.quelle_sichtbarkeit !== 'oeffentlich'
}

/** What the warning chip says — «unbekannt» is named as such, it is treated as closed. */
export function sichtbarkeitText(fund: Pick<BuschtelefonFundFelder, 'quelle_sichtbarkeit'>): string | null {
  if (!istGeschlossen(fund)) return null
  return fund.quelle_sichtbarkeit === 'geschlossen'
    ? 'Geschlossene Gruppe'
    : 'Sichtbarkeit der Gruppe unbekannt'
}

/** The sentence under the chips of a closed find — the newsroom's rule in its own words. */
export const GESCHLOSSEN_SATZ =
  'Aus einer geschlossenen Gruppe: Der Link zum Beitrag ist nur zur Überprüfung; eine Meldung verlinkt nur die Gruppe.'

/** The material was emptied (retention, or the post was removed at the source); the row stays as memory. */
export function materialGeleert(fund: Pick<BuschtelefonFundFelder, 'material_geloescht_am'>): boolean {
  return fund.material_geloescht_am !== null
}

function einzeilig(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function gekuerzt(text: string, laenge: number): string {
  if (text.length <= laenge) return text
  const schnitt = text.slice(0, laenge)
  const letzte = schnitt.lastIndexOf(' ')
  return `${(letzte > laenge / 2 ? schnitt.slice(0, letzte) : schnitt).trimEnd()} …`
}

const TITEL_ZEICHEN = 90

/**
 * The display line of a find. A Facebook post has no title, so it is the
 * first line of the post, cut at ninety characters; where the post is only an
 * image, the first read image text; then the shared post, then a link title.
 * Never empty — a row needs a name in the reject dialog.
 */
export function fundTitel(
  fund: Pick<BuschtelefonFundFelder, 'text' | 'bilder' | 'geteilt' | 'verlinkt' | 'material_geloescht_am'>
): string {
  const kandidaten = [
    fund.text,
    ...(fund.bilder ?? []).map((b) => (b.text_status === 'gelesen' ? b.text : null)),
    fund.geteilt?.text ?? null,
    ...(fund.verlinkt ?? []).map((v) => v.titel ?? null)
  ]
  for (const kandidat of kandidaten) {
    if (kandidat == null) continue
    const zeile = kandidat
      .split(/\r?\n/)
      .map(einzeilig)
      .find((z) => z !== '')
    if (zeile !== undefined) return gekuerzt(zeile, TITEL_ZEICHEN)
  }
  return materialGeleert(fund) ? 'Beitrag (Inhalt gelöscht)' : 'Beitrag ohne Text'
}

const BILD_ART: Record<string, string> = {
  foto: 'Foto',
  flyer: 'Flyer',
  screenshot: 'Screenshot',
  textkachel: 'Textkachel',
  dokument: 'Dokument',
  privatchat: 'Privatchat',
  ausweis_dokument: 'Ausweis oder Dokument',
  video: 'Video',
  unbekannt: 'Bild'
}

/** «Bild 1 · Flyer» — the head of an image block. */
export function bildKopf(bild: Pick<BuschtelefonBild, 'nr' | 'art'>): string {
  return `Bild ${bild.nr} · ${BILD_ART[bild.art] ?? 'Bild'}`
}

const BILD_STATUS: Record<string, string> = {
  kein_text: 'kein Text',
  nicht_lesbar: 'nicht lesbar',
  nicht_versucht: 'nicht gelesen',
  zurueckgehalten: 'bewusst nicht gelesen'
}

/**
 * The five states of an image text, in words. Null means: read, show the
 * text. They are never merged — «no text», «unreadable» and «deliberately
 * not read» looked the same in the first version of the door, and a flyer
 * whose text is merely missing reads like a photo.
 */
export function bildStatusText(bild: Pick<BuschtelefonBild, 'text_status' | 'text'>): string | null {
  if (bild.text_status === 'gelesen' && bild.text !== null && bild.text.trim() !== '') return null
  return BILD_STATUS[bild.text_status] ?? (bild.text_status === 'gelesen' ? 'kein Text' : bild.text_status)
}

/** «2 von 5 Bildern geliefert» — when the platform shows more than came through the door. */
export function fehlendeBilder(fund: Pick<BuschtelefonFundFelder, 'bilder' | 'n_bilder'>): string | null {
  const geliefert = (fund.bilder ?? []).length
  if (fund.n_bilder === null || fund.n_bilder <= geliefert) return null
  return `${geliefert} von ${fund.n_bilder} Bildern geliefert`
}

/**
 * Who posted, as the row shows it: an organisation by its name, a person by
 * the first name only. Null where the profile gave neither.
 */
export function autorText(
  fund: Pick<BuschtelefonFundFelder, 'autor_name' | 'autor_vorname' | 'autor_art'>
): string | null {
  if (fund.autor_name !== null && fund.autor_name.trim() !== '') return fund.autor_name
  if (fund.autor_vorname !== null && fund.autor_vorname.trim() !== '') return fund.autor_vorname
  return fund.autor_art === 'anonym' ? 'anonym' : null
}

const ROLLE_TEXT: Record<string, string> = {
  behoerde: 'einer Behörde',
  medium: 'eines Mediums',
  organisation: 'einer Organisation'
}

/**
 * Whose post a find shares, as its caption says it. A name only where the
 * Buschtelefon assigned a role from its curated list of known pages
 * (`autor_rolle`) — the contract delivers a name nowhere else. Without a
 * role, what the platform showed decides (`autor_art`): a page that is not
 * on the list is not a private person, and calling it one would attribute a
 * club's or a business's announcement to somebody's neighbour — the very
 * misattribution the separate `geteilt` exists to prevent.
 */
export function geteiltVon(
  geteilt: Pick<BuschtelefonGeteilt, 'autor_art' | 'autor_rolle' | 'autor_name' | 'quelle_name'>
): string {
  const rolle = geteilt.autor_rolle ?? null
  if (rolle !== null) {
    const name = [geteilt.autor_name, geteilt.quelle_name].find((n) => n != null && n.trim() !== '')
    return name?.trim() ?? ROLLE_TEXT[rolle] ?? 'einer Organisation'
  }
  switch (geteilt.autor_art) {
    case 'profil':
      return 'einer Privatperson'
    case 'seite':
      return 'einer Seite (nicht zugeordnet)'
    case 'anonym':
      return 'anonym'
    default:
      return 'Verfasser unbekannt'
  }
}

const MIT_UHRZEIT = new Set(['minute', 'stunde'])

/**
 * When the post appeared, as precisely as the door knows it — and no more
 * precisely. The day is the one code computed in Europe/Zurich
 * (`veroeffentlicht_tag`), never the timestamp cut at ten characters: that
 * printed 7 November for a post of the 8th.
 */
export function datumZeile(
  fund: Pick<BuschtelefonFundFelder, 'veroeffentlicht_am' | 'veroeffentlicht_tag' | 'datum_genauigkeit'>
): string {
  const genauigkeit = fund.datum_genauigkeit ?? 'unbekannt'
  if (fund.veroeffentlicht_tag === null) return 'ohne Datum'
  const tag = datumText(fund.veroeffentlicht_tag)
  if (genauigkeit === 'ungefaehr') return `ungefähr am ${tag}`
  if (MIT_UHRZEIT.has(genauigkeit) && fund.veroeffentlicht_am !== null) {
    const zeit = new Date(fund.veroeffentlicht_am)
    if (!Number.isNaN(zeit.getTime())) {
      const uhr = zeit.toLocaleTimeString('de-CH', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Zurich'
      })
      return `${tag}, ${uhr} Uhr`
    }
  }
  return tag
}

// --- comments -----------------------------------------------------------------

export interface KommentarZeile {
  kommentar: BuschtelefonKommentar
  /** 0 on the top level, 1 for a reply, 2 at most — deeper threads share the last indent. */
  tiefe: number
  /** Added by the last replacement of this row's material. */
  neu: boolean
  /** A second run no longer saw it, or the platform removed it — greyed, never hidden. */
  verblasst: boolean
  /** What stands in front of the wording: the organisation, the first name, or «Person B». */
  autor: string
}

const HOECHSTE_TIEFE = 2

/**
 * Which comments the last replacement brought. The row carries only their
 * NUMBER (`neue_kommentare`, counted by the run on comment ids against the
 * list it replaced), so the view takes that many with the latest
 * `erstmals_freigegeben_am` — a comment the door released later than another
 * is newer by definition, and at a tie the later position in the cumulative
 * list wins.
 */
export function neueKommentarKennungen(
  fund: Pick<BuschtelefonFundFelder, 'kommentare' | 'neue_kommentare'>
): Set<string> {
  const anzahl = fund.neue_kommentare ?? 0
  const liste = fund.kommentare ?? []
  if (anzahl <= 0 || liste.length === 0) return new Set()
  const geordnet = liste
    .map((k, index) => ({ k, index }))
    .sort((a, b) => {
      const zeit = (b.k.erstmals_freigegeben_am ?? '').localeCompare(a.k.erstmals_freigegeben_am ?? '')
      return zeit !== 0 ? zeit : b.index - a.index
    })
  return new Set(geordnet.slice(0, anzahl).map((e) => e.k.kennung))
}

function kommentarAutor(k: BuschtelefonKommentar, mehrdeutig: ReadonlySet<string>): string {
  if (k.autor_name != null && k.autor_name.trim() !== '') return k.autor_name
  const vorname = k.autor_vorname?.trim() ?? ''
  if (vorname !== '') {
    // Two «Sandra» in one thread stay apart through their placeholder.
    return mehrdeutig.has(vorname) && k.autor_ref !== null ? `${vorname} (${k.autor_ref})` : vorname
  }
  return k.autor_ref !== null ? `Person ${k.autor_ref}` : 'Anonym'
}

/**
 * The comments as the desk lists them: in the door's order (oldest first,
 * replies behind their parent — the contract fixes it), each with its depth.
 * A reply whose parent is not in the list is shown on the top level.
 */
export function kommentarZeilen(
  fund: Pick<BuschtelefonFundFelder, 'kommentare' | 'neue_kommentare'>
): KommentarZeile[] {
  const liste = fund.kommentare ?? []
  const neu = neueKommentarKennungen(fund)
  const jeKennung = new Map(liste.map((k) => [k.kennung, k] as const))

  const refsJeVorname = new Map<string, Set<string>>()
  for (const k of liste) {
    const vorname = k.autor_vorname?.trim() ?? ''
    if (vorname === '' || k.autor_ref === null) continue
    const refs = refsJeVorname.get(vorname) ?? new Set<string>()
    refs.add(k.autor_ref)
    refsJeVorname.set(vorname, refs)
  }
  const mehrdeutig = new Set([...refsJeVorname].filter(([, refs]) => refs.size > 1).map(([name]) => name))

  function tiefeVon(k: BuschtelefonKommentar): number {
    let tiefe = 0
    let eltern = k.antwort_auf
    const gesehen = new Set<string>([k.kennung])
    // `gesehen` guards against a cycle in delivered data; it must never hang the desk.
    while (eltern !== null && tiefe < HOECHSTE_TIEFE && !gesehen.has(eltern)) {
      const naechster = jeKennung.get(eltern)
      if (naechster === undefined) break
      gesehen.add(eltern)
      tiefe += 1
      eltern = naechster.antwort_auf
    }
    return tiefe
  }

  return liste.map((k) => ({
    kommentar: k,
    tiefe: tiefeVon(k),
    neu: neu.has(k.kennung),
    verblasst: k.stand !== 'sichtbar',
    autor: kommentarAutor(k, mehrdeutig)
  }))
}

/** «nicht mehr gesehen» / «entfernt» — what stands beside a greyed comment. */
export function kommentarStandText(stand: string): string | null {
  if (stand === 'nicht_mehr_gesehen') return 'nicht mehr gesehen'
  if (stand === 'entfernt') return 'entfernt'
  return null
}

/**
 * The number on the comments toggle: what the row holds. Where the platform
 * shows more than were delivered, the toggle says so rather than looking
 * complete.
 */
export function kommentareKopf(
  fund: Pick<BuschtelefonFundFelder, 'kommentare' | 'kommentare_fehlend' | 'kommentare_stand'>
): string {
  const n = (fund.kommentare ?? []).length
  const fehlend = fund.kommentare_fehlend ?? 0
  if (fehlend > 0) return `Kommentare (${n}, ${fehlend} weitere nicht geliefert)`
  if (fund.kommentare_stand === 'teilweise') return `Kommentare (${n}, unvollständig gelesen)`
  return `Kommentare (${n})`
}

// --- the desk -----------------------------------------------------------------

/**
 * What stays on the desk: the open rows, and a taken-over row while its
 * Meldung is still being edited. Rejected, handed-up and lapsed rows leave at
 * once; so does a row whose Meldung is published, and a taken-over one whose
 * Meldung was discarded.
 */
export function bleibtAufDemTisch(
  fund: Pick<BuschtelefonFundFelder, 'entscheid'>,
  meldungStatus: string | null = null
): boolean {
  // A draft of the run that was published without a decision on the row has
  // done the row's work: the find leaves with it, like a taken-over one.
  if (fund.entscheid === 'offen') return meldungStatus !== 'publiziert'
  if (fund.entscheid !== 'uebernommen') return false
  if (meldungStatus === null) return false
  return meldungStatus !== 'publiziert' && meldungStatus !== 'verworfen'
}

export interface Filter {
  /** A municipality's id, `OHNE_GEMEINDE` for the unassigned rows, null for all. */
  gemeinde: string | null
  suche: string
}

function normalisiere(text: string): string {
  return text.toLocaleLowerCase('de-CH').normalize('NFD').replace(/\p{M}/gu, '')
}

export function passt(fund: BuschtelefonFundFelder, filter: Filter): boolean {
  if (filter.gemeinde === OHNE_GEMEINDE) {
    if (fund.gemeinde !== null) return false
  } else if (filter.gemeinde !== null && fund.gemeinde?.id !== filter.gemeinde) {
    return false
  }
  if (filter.suche.trim() === '') return true
  const suche = normalisiere(filter.suche.trim())
  return [
    fund.text ?? '',
    fund.quelle_name ?? '',
    fund.gemeinde?.name ?? '',
    fund.geteilt?.text ?? '',
    ...(fund.bilder ?? []).map((b) => b.text ?? ''),
    ...(fund.verlinkt ?? []).map((v) => v.titel ?? '')
  ]
    .map(normalisiere)
    .some((feld) => feld.includes(suche))
}

/**
 * Whether a find lies on top: its grade against the desk's threshold — the
 * run's rule, computed here so that moving the dial shows at once. A row the
 * Sichtung has not graded is never a proposal, and neither is one whose
 * material is gone: there is nothing left to write from.
 */
export function vorgeschlagen(
  fund: Pick<BuschtelefonFundFelder, 'vorschlag_wert' | 'material_geloescht_am' | 'status'>,
  schwelle: number = STANDARD_EINSTELLUNG.schwelle
): boolean {
  if (materialGeleert(fund) || fund.status === 'entfernt') return false
  return istVorschlag(fund.vorschlag_wert, schwelle)
}

function neuesteZuerst(a: BuschtelefonFundFelder, b: BuschtelefonFundFelder): number {
  const freigabe = (b.erstmals_freigegeben_am ?? '').localeCompare(a.erstmals_freigegeben_am ?? '')
  if (freigabe !== 0) return freigabe
  return (b.date_created ?? '').localeCompare(a.date_created ?? '')
}

export interface Tisch {
  /** What the Sichtung graded at or above the threshold — highest grade first, then newest. */
  vorschlaege: BuschtelefonFundFelder[]
  /** Everything else, one click away. Never hidden, only folded. */
  uebrige: BuschtelefonFundFelder[]
}

export function tisch(
  funde: readonly BuschtelefonFundFelder[],
  kanal: string,
  filter: Filter,
  meldungStatus: ReadonlyMap<string, string> = new Map(),
  schwelle: number = STANDARD_EINSTELLUNG.schwelle
): Tisch {
  const aufDemTisch = funde.filter(
    (f) => f.kanal === kanal && bleibtAufDemTisch(f, meldungStatus.get(f.id) ?? null) && passt(f, filter)
  )
  const vorschlaege = aufDemTisch
    .filter((f) => vorgeschlagen(f, schwelle))
    .sort((a, b) => (b.vorschlag_wert ?? 0) - (a.vorschlag_wert ?? 0) || neuesteZuerst(a, b))
  const uebrige = aufDemTisch.filter((f) => !vorgeschlagen(f, schwelle)).sort(neuesteZuerst)
  return { vorschlaege, uebrige }
}

/** The badge on the workbench: the proposals, plus what is taken over and not finished. */
export function anzahlArbeit(
  funde: readonly BuschtelefonFundFelder[],
  kanal: string,
  meldungStatus: ReadonlyMap<string, string> = new Map(),
  schwelle: number = STANDARD_EINSTELLUNG.schwelle
): number {
  return funde.filter((f) => {
    if (f.kanal !== kanal) return false
    if (!bleibtAufDemTisch(f, meldungStatus.get(f.id) ?? null)) return false
    return f.entscheid === 'uebernommen' || vorgeschlagen(f, schwelle)
  }).length
}

/** Which article belongs to which find — keyed by the find, so a discarded article cannot hide a later one. */
export function meldungJeFund<T extends { buschtelefon_fund?: { id: string } | null; status: string }>(
  meldungen: readonly T[]
): Map<string, T> {
  const karte = new Map<string, T>()
  for (const meldung of meldungen) {
    const ursprung = meldung.buschtelefon_fund ?? null
    if (ursprung === null) continue
    // A live article beats a discarded one, whatever the order of the list:
    // after a removed post the run discards the draft, and a later one counts.
    const bisher = karte.get(ursprung.id)
    if (bisher === undefined || bisher.status === 'verworfen') karte.set(ursprung.id, meldung)
  }
  return karte
}

/**
 * The sentence the run writes into `entwurf_bedenken` when its writer found no
 * Meldung in the material. A MIRROR of `KEIN_ENTWURF` in the extension
 * (`redaktion/buschtelefonmeldungen.ts`) — the two must stay identical, or the
 * row loses the one line that says why it has no draft.
 */
export const KEIN_ENTWURF = 'Kein Entwurf: Der Schreiber fand im Material keine Meldung.'

/** A Meldung that is still worked on — anything but none and a discarded one. */
function lebt(meldungStatus: string | null): boolean {
  return meldungStatus !== null && meldungStatus !== 'verworfen'
}

/**
 * Whether the row should say that the run's writer declined it: no live
 * Meldung, and the writer's refusal on the row. Without the line such a
 * proposal sits among the others without a draft and without a word why —
 * and «Meldung schreiben» pays a second model call for the same refusal.
 */
export function keinEntwurf(
  fund: Pick<BuschtelefonFundFelder, 'entwurf_bedenken'>,
  meldungStatus: string | null = null
): boolean {
  if (lebt(meldungStatus)) return false
  return (fund.entwurf_bedenken ?? '').startsWith(KEIN_ENTWURF)
}

/**
 * The writer's reservations shown above a live draft. Never the refusal: a
 * row whose Meldung exists has outgrown it (the editor wrote it herself, or
 * with her own facts).
 */
export function entwurfVorbehalt(
  fund: Pick<BuschtelefonFundFelder, 'entwurf_bedenken'>,
  meldungStatus: string | null = null
): string | null {
  if (!lebt(meldungStatus)) return null
  const bedenken = (fund.entwurf_bedenken ?? '').trim()
  if (bedenken === '' || bedenken.startsWith(KEIN_ENTWURF)) return null
  return bedenken
}

export interface Entscheide {
  ablehnen: boolean
  weiterreichen: boolean
  /** The Meldung is past its draft — the row says why the two buttons are gone. */
  meldungUnterwegs: boolean
}

/**
 * Which of the two decisions besides «Meldung schreiben» a row offers — the
 * extension's own conditions, so a click never meets a refusal. Handing up
 * needs an open row (`/weiterreichen` refuses anything else). Both need the
 * Meldung to be at most a draft: rejecting or handing up discards a DRAFT
 * with the row, never an article in the counter-check or approved — and the
 * decided row leaves the desk, the only place that article is rendered.
 */
export function entscheide(
  fund: Pick<BuschtelefonFundFelder, 'entscheid'>,
  meldungStatus: string | null = null
): Entscheide {
  const meldungUnterwegs = lebt(meldungStatus) && meldungStatus !== 'entwurf'
  const offenOderUebernommen = fund.entscheid === 'offen' || fund.entscheid === 'uebernommen'
  return {
    ablehnen: offenOderUebernommen && !meldungUnterwegs,
    weiterreichen: fund.entscheid === 'offen' && !meldungUnterwegs,
    meldungUnterwegs
  }
}

// --- a lead on the Chefredaktion's desk ------------------------------------------

// A find as a lead of the Chefredaktion reads it — LIVE, through the lead's
// foreign key (`BuschtelefonHinweisFund`). The lead itself carries no wording
// (`recherchehinweise` keeps revisions; `buschtelefon_funde` does not), so
// what is shown is what the find holds today, and the retention that empties
// the find empties the lead's view with it.

/** What a lead shows once its find was removed at the source or its material emptied. */
export const ORIGINAL_WEG = 'Original nicht mehr auffindbar'

/** Whether the find behind a lead still holds its material. */
export function fundNochDa(fund: Pick<BuschtelefonHinweisFund, 'status' | 'material_geloescht_am'>): boolean {
  return fund.status !== 'entfernt' && fund.material_geloescht_am === null
}

/** «Du bisch vo Aesch, wenn … · 8. November 2026» — the find's source and day, never its wording. */
export function fundKopf(fund: Pick<BuschtelefonHinweisFund, 'quelle_name' | 'veroeffentlicht_tag'>): string {
  return [fund.quelle_name, fund.veroeffentlicht_tag === null ? null : datumText(fund.veroeffentlicht_tag)]
    .filter((t): t is string => t !== null && t.trim() !== '')
    .join(' · ')
}

// --- the sources ----------------------------------------------------------------

export interface QuellenProblem {
  id: string
  name: string
  text: string
}

function tagText(iso: string): string {
  const zeit = new Date(iso)
  if (Number.isNaN(zeit.getTime())) return iso
  return zeit.toLocaleDateString('de-CH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Zurich'
  })
}

/**
 * The sources of a channel that were not, or only half, read in the run the
 * last release was built from. A quiet group and one whose reading has failed
 * for three days look the same on the desk otherwise. Inactive sources are
 * out: nobody tries to read them.
 */
export function quellenProbleme(
  quellen: readonly BuschtelefonQuelleFelder[],
  kanal: string | null = null
): QuellenProblem[] {
  return quellen
    .filter((q) => q.aktiv !== false && (kanal === null || q.kanal === kanal))
    .flatMap((q) => {
      const name = q.name ?? q.kennung
      const grund = q.letzter_fehler !== null && q.letzter_fehler.trim() !== '' ? `: ${q.letzter_fehler}` : ''
      if (q.stand === 'fehlgeschlagen' || (q.fehler_seit !== null && q.stand !== 'teilweise')) {
        const seit = q.fehler_seit === null ? '' : ` seit ${tagText(q.fehler_seit)}`
        return [{ id: q.id, name, text: `nicht gelesen${seit}${grund}` }]
      }
      if (q.stand === 'teilweise') return [{ id: q.id, name, text: `nur teilweise gelesen${grund}` }]
      if (q.stand === 'nicht_versucht') return [{ id: q.id, name, text: 'in diesem Lauf nicht versucht' }]
      return []
    })
}

export interface QuellenZahl {
  id: string
  name: string
  text: string
}

/**
 * What the Buschtelefon did NOT hand over, per source and in words: sorted
 * out as empty, too old on first sight, or held back for want of a link.
 * Shown so that nothing disappears silently — the contract's own reason for
 * the three counters.
 */
export function quellenZahlen(
  quellen: readonly BuschtelefonQuelleFelder[],
  kanal: string | null = null
): QuellenZahl[] {
  return quellen
    .filter((q) => kanal === null || q.kanal === kanal)
    .flatMap((q) => {
      const teile = [
        (q.n_aussortiert ?? 0) > 0 ? `${q.n_aussortiert} aussortiert (ohne Inhalt)` : null,
        (q.n_zu_alt ?? 0) > 0 ? `${q.n_zu_alt} zu alt` : null,
        (q.n_ausgelassen ?? 0) > 0 ? `${q.n_ausgelassen} ohne Link oder Kennung` : null
      ].filter((t): t is string => t !== null)
      if (teile.length === 0) return []
      const gesehen = q.n_beitraege_gesehen === null ? '' : ` von ${q.n_beitraege_gesehen} gesehenen`
      return [{ id: q.id, name: q.name ?? q.kennung, text: `${teile.join(', ')}${gesehen}` }]
    })
}

// --- the run --------------------------------------------------------------------

/** The hand-started fetch, mirrored from the extension's process (`GET /redaktion/buschtelefon/lauf`). */
export interface BuschtelefonLaufStatus {
  laeuft: boolean
  gestartet_um: string | null
  beendet_um: string | null
  ergebnis: Record<string, unknown> | null
  fehler: string | null
  /** False while a variable of the door is missing — the feed is off and says which. */
  eingerichtet?: boolean
  fehlend?: string[] | string | null
}

function anzahl(wert: unknown): number {
  if (typeof wert === 'number' && Number.isFinite(wert)) return wert
  return Array.isArray(wert) ? wert.length : 0
}

function fehlendText(fehlend: BuschtelefonLaufStatus['fehlend']): string {
  const liste = Array.isArray(fehlend) ? fehlend : typeof fehlend === 'string' ? [fehlend] : []
  return liste.length === 0 ? '' : ` Es fehlt: ${liste.join(', ')}.`
}

/** Whether the door is switched off for want of a variable — from the status or from the last result. */
export function nichtEingerichtet(status: BuschtelefonLaufStatus | null): string | null {
  if (status === null) return null
  const ergebnis = status.ergebnis
  const ausErgebnis = ergebnis !== null && ergebnis['status'] === 'nicht_eingerichtet'
  if (status.eingerichtet !== false && !ausErgebnis) return null
  const fehlend =
    status.eingerichtet === false
      ? status.fehlend
      : (ergebnis?.['fehlend'] as BuschtelefonLaufStatus['fehlend'])
  return `Das Buschtelefon ist auf diesem Server nicht eingerichtet — es wird nichts abgeholt.${fehlendText(fehlend)}`
}

/**
 * The status of a result whose call found another run under way and did
 * nothing (`holeAbEinzeln`, `redaktion/buschtelefonlauf.ts`) — it writes no
 * stand, so the run that WAS going speaks through the stand.
 */
const LEERLAUF = 'laeuft'

/** What the desk says about the fetch: under way, or what the last one brought. */
export function laufText(status: BuschtelefonLaufStatus): string | null {
  if (status.laeuft) {
    return 'Der Abruf ist unterwegs — Funde holen, sichten und die Entwürfe schreiben dauert einige Minuten; die Ansicht aktualisiert sich von selbst.'
  }
  if (status.beendet_um === null) return null
  if (status.ergebnis === null) return 'Der letzte Abruf hat nichts zurückgemeldet.'
  const e = status.ergebnis
  if (e['status'] === 'nicht_eingerichtet') return null
  // A call that found another run under way did nothing; its hint says so,
  // and «0 Funde gelesen» would read like a quiet day.
  if (e['status'] === LEERLAUF) return null
  const teile = [
    `${anzahl(e['gelesen'])} Funde gelesen`,
    `${anzahl(e['neu'])} neu`,
    `${anzahl(e['ersetzt'])} aktualisiert`,
    `${anzahl(e['gesichtet'])} gesichtet`,
    `${anzahl(e['entwuerfe'])} Entwürfe geschrieben`
  ]
  const wartend = anzahl(e['wartend'])
  if (wartend > 0) teile.push(`${wartend} Entwürfe warten auf den nächsten Lauf`)
  const ohneGemeinde = anzahl(e['ohneGemeinde'])
  if (ohneGemeinde > 0) teile.push(`${ohneGemeinde} ohne Gemeinde`)
  const entfernt = anzahl(e['entfernt'])
  if (entfernt > 0) teile.push(`${entfernt} an der Quelle entfernt`)
  const ungueltig = anzahl(e['ungueltig'])
  if (ungueltig > 0) teile.push(`${ungueltig} ungültig geliefert`)
  const fehler = anzahl(e['fehler'])
  if (fehler > 0) teile.push(`${fehler} Fehler`)
  const uhrzeit = new Date(status.beendet_um).toLocaleTimeString('de-CH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich'
  })
  return `Letzter Abruf um ${uhrzeit} Uhr — ${teile.join(', ')}.`
}

/** The errors and hints the last run named, as lines — never swallowed into a count alone. */
export function laufZeilen(status: BuschtelefonLaufStatus | null, feld: 'fehler' | 'hinweise'): string[] {
  const wert = status?.ergebnis?.[feld]
  if (!Array.isArray(wert)) return []
  return wert.filter((z): z is string => typeof z === 'string' && z.trim() !== '')
}

function zeitpunkt(iso: string | null): number | null {
  if (iso === null) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/**
 * The run the desk speaks about. The process status (`GET …/buschtelefon/lauf`)
 * knows only a run started by hand — and nothing after a restart or a deploy —
 * while every run, the scheduled ones at noon included, writes its result to
 * `buschtelefon_stand`. Without the stand, the normal day (nobody pressed the
 * button) showed no «Letzter Abruf» at all, and the draft cap and the refused
 * finds went unheard. A run under way always wins; otherwise the later one.
 * The stand's `letzter_abruf` is when its run STARTED, so the hand run that
 * wrote it ends after it and keeps its own, richer status.
 */
export function letzterLauf(
  lauf: BuschtelefonLaufStatus | null,
  stand: Pick<BuschtelefonStandFelder, 'letzter_abruf' | 'ergebnis'> | null
): BuschtelefonLaufStatus | null {
  if (lauf?.laeuft === true) return lauf
  const abruf = stand?.letzter_abruf ?? null
  const ausStand: BuschtelefonLaufStatus | null =
    abruf === null || abruf.trim() === ''
      ? null
      : {
          laeuft: false,
          gestartet_um: abruf,
          beendet_um: abruf,
          ergebnis: stand?.ergebnis ?? null,
          fehler: null
        }
  if (lauf === null || lauf.beendet_um === null) return ausStand ?? lauf
  // A hand call that met a run under way did nothing and ends AFTER the
  // stand's start stamp of the run it met — the stand is that run's result.
  if (lauf.ergebnis?.['status'] === LEERLAUF) return ausStand ?? lauf
  if (ausStand === null) return lauf
  const vomStand = zeitpunkt(ausStand.beendet_um)
  const vonHand = zeitpunkt(lauf.beendet_um)
  return vomStand !== null && vonHand !== null && vomStand > vonHand ? ausStand : lauf
}

export interface AbrufAnzeige {
  /** «Letzter Abruf um … — …», or «unterwegs»; null before any run. */
  text: string | null
  /** The door is switched off for want of a variable. */
  aus: string | null
  /** A hand-started run that threw — only while it is the latest run. */
  fehlgeschlagen: string | null
  /** The errors the latest run named, one per line. */
  fehler: string[]
  /** Its hints — without the release hint, which the desk shows on its own line. */
  hinweise: string[]
  /** The stand's joined error line, only where no result above carries the same errors already. */
  standFehler: string | null
}

/** Everything the head of the desk says about the fetch, from the process status and the stand together. */
export function abrufAnzeige(
  lauf: BuschtelefonLaufStatus | null,
  stand: Pick<
    BuschtelefonStandFelder,
    'letzter_abruf' | 'ergebnis' | 'letzter_fehler' | 'letzter_hinweis'
  > | null
): AbrufAnzeige {
  const letzter = letzterLauf(lauf, stand)
  const freigabeHinweis = (stand?.letzter_hinweis ?? '').trim()
  const standFehler = (stand?.letzter_fehler ?? '').trim()
  return {
    text: letzter === null ? null : laufText(letzter),
    // The live process knows the variables best; the stand's last result
    // speaks only where the process did not answer.
    aus: nichtEingerichtet(lauf) ?? (lauf?.eingerichtet === true ? null : nichtEingerichtet(letzter)),
    fehlgeschlagen: letzter?.fehler ?? null,
    fehler: laufZeilen(letzter, 'fehler'),
    hinweise: laufZeilen(letzter, 'hinweise').filter((h) => h.trim() !== freigabeHinweis),
    // The run writes the same errors twice — as a list into `ergebnis` and
    // joined into `letzter_fehler`. Shown once: the list where there is one.
    standFehler:
      standFehler !== '' && (letzter?.ergebnis ?? null) === null && (letzter?.fehler ?? null) === null
        ? standFehler
        : null
  }
}
