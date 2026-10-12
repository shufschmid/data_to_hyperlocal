// The SMD desk: what OTHER media write about a municipality, delivered once a
// day as the Schweizer Mediendatenbank's dossier of the newsroom's saved
// search «gemeinden».
//
// Pure. The Directus-bound half is `smdlauf.ts`, the writer `smdmeldungen.ts`,
// the reader `shared/smd/` (the dossier) and `shared/verlage/` (the online
// address). Modelled on the Kanton desk, whose shape it shares — one row per
// municipality named, a Sichtung that sorts and never filters, three
// decisions that teach — and on the press review, whose rule it inherits: a
// Meldung in own words, the medium named in the text, an overlap check against
// the source.
//
// What is this desk's own, decided with the newsroom on 12 October 2026:
// a BLOG is not a document but its new entries (the dossier brings the whole
// blog every time one entry changed), a blog entry or an article is a
// candidate only if it NAMES a covered municipality with word boundaries
// (SMD's own search matches inside words), the online address is found by
// code through the publisher's door and labelled «(Abo)» where the page says
// it is paywalled, and where none is found the source line says «(Artikel
// nicht online verfügbar)» — towards the reader it is then as if we had read
// it in the printed paper.

import {
  datumDeutsch,
  lernDigest,
  parseTriage,
  TRIAGE_SCHEMA
} from './amtsblatt'
import type { LernEintrag, TriageUrteil } from './amtsblatt'
import { aufraeumAktion, type AufraeumZeile } from './gemeindeseite'
import { vorgabenZeilen } from './lernen'
import { gekuerzt, ueberlappungsWarnungen } from './presseschau'
import { gemeindeTreffer } from './sendung'
import { terminTageZeilen } from './termin'
import { kappe, TEXT_MAX_ZEICHEN } from '../shared/gemeindeseite/text'
import { normiereTitel, type SmdDokument } from '../shared/smd/parse'
import type { LinkErgebnis } from '../shared/verlage'

export { lernDigest, datumDeutsch, gemeindeTreffer, ueberlappungsWarnungen }
export type { LernEintrag }
export { TRIAGE_SCHEMA as SICHTUNG_SCHEMA, parseTriage as parseSichtung }
export type { TriageUrteil as SichtungsUrteil }
export {
  linkWarnungen,
  zeitWarnungen,
  parseMeldungstext as parseSmdMeldung
} from './spielbericht'

// ---------------------------------------------------------------------------
// 0. Candidates — a document, or a blog's new entries
// ---------------------------------------------------------------------------

/** A blog entry older than this many days before the dossier is archive, not news. */
export const BLOG_FENSTER_TAGE = 3

export type SmdArt = 'artikel' | 'blogeintrag'

export interface Kandidat {
  art: SmdArt
  /** Identity across dossiers — the same piece twice (SMD's 26-hour window) is one row. */
  schluessel: string
  medium: string
  datum: string
  /** Blog entries only: `HH:MM`. */
  zeit: string | null
  /** Blog entries only: the blog's name. */
  blog: string | null
  /** Blog entries only: the blog's headline of that day — what the publisher's sitemap lists its page under. */
  blogTitel: string | null
  rubrik: string | null
  titel: string
  lead: string | null
  autor: string | null
  text: string
  seiteVon: number
  seiteBis: number
}

const SCHLUESSEL_MAX = 300

/** `<medium>|<datum>|<titel>` for an article, `<medium>|blog|<name>|<datum>|<zeit>|<titel>` for an entry. */
export function schluesselFuer(teile: readonly string[]): string {
  return teile
    .map((t) => normiereTitel(t))
    .join('|')
    .slice(0, SCHLUESSEL_MAX)
}

function tageZwischen(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
  )
}

/**
 * What a document yields: itself, or — for a blog — one candidate per entry
 * inside the window. Entries older than the window are counted, never
 * stored: the dossier brings the whole blog, and a July entry in an October
 * dossier is archive.
 */
export function kandidatenAus(
  dokument: SmdDokument,
  dossierDatum: string,
  blogFensterTage: number = BLOG_FENSTER_TAGE
): { kandidaten: Kandidat[]; blogAlt: number } {
  if (dokument.blog === null) {
    return {
      kandidaten: [
        {
          art: 'artikel',
          schluessel: schluesselFuer([
            dokument.medium,
            dokument.datum,
            dokument.titel
          ]),
          medium: dokument.medium,
          datum: dokument.datum,
          zeit: null,
          blog: null,
          blogTitel: null,
          rubrik: dokument.rubrik,
          titel: dokument.titel,
          lead: dokument.lead,
          autor: dokument.autor,
          text: dokument.text,
          seiteVon: dokument.seiteVon,
          seiteBis: dokument.seiteBis
        }
      ],
      blogAlt: 0
    }
  }
  const kandidaten: Kandidat[] = []
  let blogAlt = 0
  for (const e of dokument.blog.eintraege) {
    if (tageZwischen(dossierDatum, e.datum) > blogFensterTage) {
      blogAlt += 1
      continue
    }
    kandidaten.push({
      art: 'blogeintrag',
      schluessel: schluesselFuer([
        dokument.medium,
        'blog',
        dokument.blog.name,
        e.datum,
        e.zeit,
        e.titel
      ]),
      medium: dokument.medium,
      datum: e.datum,
      zeit: e.zeit,
      blog: dokument.blog.name,
      blogTitel: dokument.titel,
      rubrik: dokument.rubrik,
      titel: e.titel,
      lead: null,
      autor: dokument.autor,
      text: e.text,
      seiteVon: dokument.seiteVon,
      seiteBis: dokument.seiteBis
    })
  }
  return { kandidaten, blogAlt }
}

/**
 * The covered municipalities a candidate names — title, lead and text, with
 * word boundaries: SMD's own search matched «Aesch» inside «Aeschenplatz»,
 * and the broadcasts' pre-filter already knows better.
 */
export function vorfilter(
  kandidat: Pick<Kandidat, 'titel' | 'lead' | 'text'>,
  gemeinden: ReadonlyArray<{ id: string; name: string }>
): Array<{ id: string; name: string }> {
  const treffer = new Set(
    gemeindeTreffer(
      `${kandidat.titel}\n${kandidat.lead ?? ''}\n${kandidat.text}`,
      gemeinden.map((g) => g.name)
    )
  )
  return gemeinden.filter((g) => treffer.has(g.name))
}

/** The stored text is capped like every other desk's; the cap is said on the row. */
export function gekappterText(text: string): {
  text: string
  abgeschnitten: boolean
} {
  return kappe(text, TEXT_MAX_ZEICHEN)
}

export type LinkStatus =
  | 'gefunden'
  | 'nicht_gefunden'
  | 'keine_tuer'
  | 'fehler'
  | 'manuell'

export interface LinkFelder {
  link_url: string | null
  link_status: LinkStatus
  link_abo: boolean | null
  link_titel: string | null
  link_hinweis: string | null
}

/** The row's link columns from the searcher's answer. */
export function linkFelderAus(ergebnis: LinkErgebnis): LinkFelder {
  switch (ergebnis.status) {
    case 'gefunden':
      return {
        link_url: ergebnis.treffer.url,
        link_status: 'gefunden',
        link_abo: ergebnis.treffer.abo,
        link_titel: ergebnis.treffer.titel,
        link_hinweis: `gefunden über ${ergebnis.treffer.weg}`
      }
    case 'keine_tuer':
      return {
        link_url: null,
        link_status: 'keine_tuer',
        link_abo: null,
        link_titel: null,
        link_hinweis: 'für dieses Medium gibt es keine Verlagstür'
      }
    default:
      return {
        link_url: null,
        link_status: ergebnis.status,
        link_abo: null,
        link_titel: null,
        link_hinweis: ergebnis.hinweis
      }
  }
}

// ---------------------------------------------------------------------------
// 1. Sichtung — sorts, never filters
// ---------------------------------------------------------------------------

/** Byte-identical across a run; everything per municipality goes into the user turn. */
export const SMD_SICHTUNG_SYSTEM_PROMPT = `Du sichtest fuer eine lokale Redaktion in der Region Basel Beitraege anderer Medien (Tageszeitungen online, Magazine, Radios), die eine bestimmte Gemeinde beim Namen nennen, und entscheidest, welche davon eine Redaktorin fuer DIESE Gemeinde ansehen sollte.
Die Beitraege kommen aus der Schweizer Mediendatenbank, die nach dem Namen der Gemeinde gesucht hat. Der Name allein sagt nichts: die Frage ist immer, ob der Beitrag von der Gemeinde HANDELT — dort geschieht etwas, wird etwas entschieden, steht jemand von dort im Zentrum — oder ob er sie bloss ERWAEHNT: in einer Aufzaehlung, als Wohnort einer Person, als Adresse, als Vergleich, als Spielort eines auswaertigen Vereins.
Dafuer spricht: eigene Berichterstattung des Mediums ueber die Gemeinde (eine Reportage, ein Interview, eine Recherche, ein Hintergrund), ein Entscheid oder Konflikt im Dorf, ein Verein oder eine Institution der Gemeinde als Hauptsache, ein Sportresultat eines Vereins der Gemeinde, das das Medium selbst beschreibt.
Dagegen: die Gemeinde ist ein Name unter vielen (Resultatlisten mit zwanzig Vereinen, Veranstaltungsagenden, Wetterlagen, Listen von Standorten); Polizei- und Behoerdenmitteilungen, die das Medium bloss weitergibt — die erreicht die Redaktion direkt ueber andere Tische; Werbung, Pressedienste, Stellen; ein Beitrag ueber eine Firma oder Person, bei dem die Gemeinde nur als Sitz oder Wohnort faellt.
Ein Eintrag aus einem Newsblog ist ein Beitrag wie jeder andere: beurteile den Eintrag, nicht den Blog.
Im Zweifel: nein. Die nicht vorgeschlagenen Beitraege verschwinden nicht, sie stehen der Redaktion weiterhin zur Verfuegung — ein falsches Ja kostet Aufmerksamkeit, ein falsches Nein kostet einen Klick. Die Bilanz und die Beispiele der Redaktion zeigen, was sie tatsaechlich aufgreift; ein Vorschlag, den sie liegen liess oder als "nur am Rand erwaehnt" ablehnte, war ein Fehlvorschlag.
Begruende jeden Entscheid in EINEM kurzen Satz, der sagt WARUM, nicht WAS.
Weiterreichen an die Chefredaktion: NUR wenn eine der nummerierten Regeln der Redaktion (R1, R2, …) verlangt, dass solche Beitraege an die Chefredaktion gehen, setze "empfehlung": "weiterreichen" und nenne die Nummer dieser Regel in "empfehlung_regel". Ohne eine solche Regel sind beide null.
Antworte ausschliesslich mit JSON:
{"urteile": [{"nummer": 1, "vorschlag": true, "begruendung": "...", "empfehlung": null, "empfehlung_regel": null}]}`

/** One piece as the Sichtung sees it. */
export interface SmdSichtungsZeile {
  id: string
  titel: string
  auszug: string
  datum: string
  medium: string
  /** The blog's name for an entry, null for an article. */
  blog: string | null
  /** The other covered municipalities the same piece names. */
  weitereGemeinden: readonly string[]
  textAbgeschnitten: boolean
}

export const AUSZUG_ZEICHEN = 400

/** The lead where there is one, else the text's opening — one line. */
export function auszugVon(
  zeile: { lead: string | null; text: string | null },
  max = AUSZUG_ZEICHEN
): string {
  const quelle =
    (zeile.lead ?? '').trim() !== '' ? (zeile.lead ?? '') : (zeile.text ?? '')
  return gekuerzt(quelle.replace(/\s+/g, ' ').trim(), max)
}

export function buildSmdSichtungPrompt(
  gemeinde: string,
  zeilen: readonly SmdSichtungsZeile[],
  digest: string,
  /** The desk's Sichtung rules, already rendered (`regelnBlock`) — user turn, like the digest. */
  regeln = ''
): string {
  const eintrag = (z: SmdSichtungsZeile, i: number): string[] => {
    const kopf = [
      z.medium,
      z.blog === null ? null : `Blog «${z.blog}»`,
      datumDeutsch(z.datum)
    ]
      .filter((t): t is string => t !== null && t !== '')
      .join(' · ')
    const zeilenDazu = [`${i + 1}. [${kopf}] "${z.titel}"`]
    if (z.auszug !== '') zeilenDazu.push(`   Auszug: ${z.auszug}`)
    if (z.weitereGemeinden.length > 0)
      zeilenDazu.push(
        `   (nennt auch ${z.weitereGemeinden.join(', ')} — beurteile nur den Bezug zu ${gemeinde})`
      )
    if (z.textAbgeschnitten)
      zeilenDazu.push('   (Der Text wurde beim Lesen gekuerzt.)')
    return zeilenDazu
  }
  return [
    `Gemeinde: ${gemeinde}`,
    '',
    `Neue Beitraege anderer Medien, die ${gemeinde} nennen:`,
    ...zeilen.flatMap(eintrag),
    ...(regeln === '' ? [] : ['', regeln]),
    ...(digest === '' ? [] : ['', digest]),
    '',
    `Beurteile alle ${zeilen.length} und antworte fuer jede mit ihrer Nummer.`
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 2. Cleanup — the municipal desk's two rules, no event branch
// ---------------------------------------------------------------------------

export function aufraeumAktionSmd(
  zeile: Omit<AufraeumZeile, 'veranstaltung_am'>,
  heute: string,
  fensterTage = 0
): 'verfallen' | 'loeschen' | null {
  return aufraeumAktion(
    { ...zeile, veranstaltung_am: null },
    heute,
    fensterTage
  )
}

// ---------------------------------------------------------------------------
// 3. The Meldung
// ---------------------------------------------------------------------------

export interface SmdFakten {
  gemeinde: string
  medium: string
  art: SmdArt
  datum: string
  zeit: string | null
  blog: string | null
  rubrik: string | null
  titel: string
  lead: string | null
  autor: string | null
  text: string
  textAbgeschnitten: boolean
  /** The online address where the door found one; null means «nicht online verfügbar». */
  link: { url: string; abo: boolean | null } | null
  weitereGemeinden: readonly string[]
  /** Every calendar day CODE found in the wording — the only days the model may name as termin. */
  datenImText: readonly string[]
}

export const SMD_MELDUNG_SYSTEM_PROMPT = `Du schreibst fuer eine lokale Redaktion in der Region Basel kurze Meldungen fuer EINE Gemeinde aus Beitraegen anderer Medien — eine Presseschau: was eine Tageszeitung, ein Magazin oder ein Radio ueber diese Gemeinde berichtet hat.
Regeln, ohne Ausnahme:
- Verwende NUR die Fakten aus dem uebergebenen Wortlaut. Erfinde nichts und
  rechne nichts aus.
- Schreibe in EIGENEN Worten. Der Beitrag ist das Werk des anderen Mediums,
  nicht unsere Meldung: uebernimm keine Saetze, keine Formulierungen. Fasse
  die Sache aus Sicht der Gemeinde zusammen: was bedeutet sie fuer die Leute
  dort. Wer den ganzen Beitrag lesen will, findet ihn ueber die Quellenzeile.
- Nenne das Medium IM TEXT als Quelle, mit dem Namen, wie er uebergeben wird
  (z. B. "wie bzbasel.ch berichtet", "schreibt bazonline.ch"), bei einem
  Blog-Eintrag auch den Blog ("im Blog «Regiosport-Aktuell» von bzbasel.ch").
  Zitate aus dem Beitrag sind erlaubt, kurz und als solche gekennzeichnet.
- Nenne Daten ABSOLUT ("am 10. Oktober 2026"), niemals relativ ("gestern",
  "am Samstag" ohne Datum). Der Text muss in fuenf Jahren noch stimmen.
- Keine Namen von Privatpersonen, die nur Betroffene sind (Unfallopfer,
  Beschuldigte, Zeugen). Personen, die oeffentlich handeln — Politikerinnen,
  Vereinspraesidenten, Trainerinnen, Spielerinnen, Wirte, die das Medium
  selbst mit Namen nennt —, darfst du nennen.
- POLIZEILICHES: Schreibe ueber den Ort und das Ereignis, nie ueber eine
  Person. Keine Kennzeichen, kein Alter und keine Herkunft als
  Kennzeichnung einer Person, sofern es nicht die Sache selbst ist (ein
  Aufruf nach Zeugen bleibt ein Aufruf).
- Zahlen genau so, wie sie im Wortlaut stehen. Keine Adressen, keine Links —
  die Quellenzeile setzt der Code.
- Schreibe nuechtern und knapp. Keine Wertung, keine Dramatisierung.
- Schweizer Rechtschreibung: "ss" statt "ß". Umlaute schreibst du als
  Umlaute (ä, ö, ü), nie als ae, oe, ue.
Umfang: Titel (maximal 70 Zeichen, nennt die Gemeinde, wo sie die Sache
ist), Lead (ein Satz), Text (ein bis zwei kurze Absaetze, durch eine
Leerzeile getrennt).
Zusaetzlich beurteilst du zwei Dinge FUER DEN NEWSLETTER — sie erscheinen
nicht im Text:
- "termin": Hat der Beitrag einen Tag, an dem er fuer die Leserin zaehlt —
  ein Anlass am, eine Frist bis, eine Aenderung gueltig ab? Dann nenne
  "ideal" (den ersten Tag, an dem es gilt, oder die Frist) und "ende" (den
  letzten Tag, an dem die Meldung noch Sinn hat; sonst derselbe wie
  "ideal"). NUR Tage aus der Liste "Im Wortlaut genannte Tage"; steht der
  passende Tag nicht dort, ist "termin" null. Ein Bericht ueber etwas, das
  vorbei ist, hat "termin": null.
- "wichtig": true, wenn die Sache fuer viele im Dorf zaehlt und eine FRUEHE
  Ankuendigung verdient. false bei Routine und bei Berichten ueber Vergangenes.
  Stehen unten Entscheide der Redaktion, richte dich danach.
Antworte ausschliesslich mit JSON:
{"titel": "...", "lead": "...", "text": "...", "termin": {"ideal": "JJJJ-MM-TT", "ende": "JJJJ-MM-TT"} | null, "wichtig": true | false}`

export const MAX_TEXT = 12_000

function beitragsZeile(
  fakten: Pick<SmdFakten, 'art' | 'medium' | 'blog' | 'datum' | 'zeit'>
): string {
  const wann =
    fakten.zeit === null
      ? datumDeutsch(fakten.datum)
      : `${datumDeutsch(fakten.datum)}, ${fakten.zeit} Uhr`
  return fakten.art === 'blogeintrag'
    ? `Eintrag im Blog «${fakten.blog ?? ''}» von ${fakten.medium} vom ${wann}`
    : `Beitrag von ${fakten.medium} vom ${wann}`
}

function faktenZeilen(fakten: SmdFakten): string[] {
  return [
    `Gemeinde: ${fakten.gemeinde}`,
    `Medium (so im Text nennen): ${fakten.medium}`,
    beitragsZeile(fakten),
    ...(fakten.rubrik === null || fakten.art === 'blogeintrag'
      ? []
      : [`Rubrik: ${fakten.rubrik}`]),
    ...(fakten.autor === null ? [] : [`Autor/in laut Medium: ${fakten.autor}`]),
    ...(fakten.weitereGemeinden.length > 0
      ? [
          `Der Beitrag nennt auch ${fakten.weitereGemeinden.join(', ')} — die Meldung ist fuer ${fakten.gemeinde}.`
        ]
      : []),
    `Titel des Beitrags: "${fakten.titel}"`,
    ...(fakten.lead === null || fakten.lead.trim() === ''
      ? []
      : [`Lead: ${fakten.lead.trim()}`]),
    '',
    'Wortlaut des Beitrags:',
    gekuerzt(fakten.text.trim(), MAX_TEXT),
    ...(fakten.textAbgeschnitten
      ? [
          '',
          'Der Wortlaut liegt nur unvollstaendig vor (beim Lesen gekuerzt) — behaupte keine Vollstaendigkeit.'
        ]
      : []),
    ...terminTageZeilen(fakten.datenImText)
  ]
}

export function buildSmdPrompt(
  fakten: SmdFakten,
  regeln: readonly string[] = [],
  /** What the newsroom decided about importance lately — `wichtigkeitDigest`, or ''. */
  wichtigkeit = ''
): string {
  return [
    ...faktenZeilen(fakten),
    ...vorgabenZeilen(regeln),
    ...(wichtigkeit === '' ? [] : ['', wichtigkeit]),
    '',
    'Schreibe die Meldung. Verwende ausschliesslich diese Angaben, in eigenen Worten.'
  ].join('\n')
}

/** Same facts, previous text, editor's instruction — system prompt unchanged. */
export function buildSmdRevision(
  fakten: SmdFakten,
  bisher: { titel: string | null; lead: string | null; text: string | null },
  anweisung: string,
  regeln: readonly string[] = [],
  wichtigkeit = ''
): string {
  return [
    ...faktenZeilen(fakten),
    ...vorgabenZeilen(regeln),
    ...(wichtigkeit === '' ? [] : ['', wichtigkeit]),
    '',
    'Bisherige Meldung:',
    `Titel: ${bisher.titel ?? ''}`,
    `Lead: ${bisher.lead ?? ''}`,
    bisher.text ?? '',
    '',
    'Anweisung der Redaktion:',
    anweisung,
    '',
    'Schreibe die Meldung neu. Setze die Anweisung um, aber verwende weiterhin ausschliesslich die Angaben oben, in eigenen Worten.'
  ].join('\n')
}

/** The newsroom's wording of 12 October 2026 for a piece the door could not find. */
export const NICHT_ONLINE = '(Artikel nicht online verfügbar)'

/**
 * The link text: «Artikel auf bzbasel.ch (Abo)». The label is set where the
 * page says it is paywalled or did not say — most of these are — and left
 * off only where the page said the piece is free.
 */
export function linkText(fakten: Pick<SmdFakten, 'medium' | 'link'>): string {
  const abo = fakten.link === null || fakten.link.abo !== false ? ' (Abo)' : ''
  return `Artikel auf ${fakten.medium}${abo}`
}

/** The source line, appended by code: the medium, the day, and the address or its absence. */
export function quelleZeile(fakten: SmdFakten): string {
  const ort =
    fakten.link === null
      ? NICHT_ONLINE
      : `<a href="${fakten.link.url}">${linkText(fakten)}</a>`
  return `Quelle: ${beitragsZeile(fakten)} — ${ort}`
}

export function mitQuelle(text: string, fakten: SmdFakten): string {
  return `${text.trim()}\n\n${quelleZeile(fakten)}`
}

const QUELLENZEILE = /\n{2,}Quelle: [^\n]*$/
/** The stored text without its source line — for a revision, so the model cannot copy it. */
export function ohneQuelle(text: string | null): string | null {
  if (text === null) return null
  return text.replace(QUELLENZEILE, '').trimEnd()
}

// ---------------------------------------------------------------------------
// The checks — a prompt is a request, a check is a rule
// ---------------------------------------------------------------------------

/** How the house may also call a medium — the newsroom's short names beside the domain. */
const MEDIUM_ALIASE: Readonly<Record<string, readonly string[]>> = {
  'bzbasel.ch': ['bz basel', 'bz'],
  'bazonline.ch': ['basler zeitung', 'baz'],
  'schweizheute.ch': ['schweiz heute'],
  'nzz.ch': ['nzz', 'neue zürcher zeitung']
}

/** Every spelling of a medium the attribution check accepts, lowercase. */
export function mediumNamen(medium: string): string[] {
  const voll = medium.normalize('NFC').trim().toLowerCase()
  const namen = [voll, ...(MEDIUM_ALIASE[voll] ?? [])]
  const ohneEndung = voll.replace(/\.(ch|com|de|net|org)$/, '')
  if (ohneEndung !== voll && ohneEndung.length >= 3) namen.push(ohneEndung)
  return [...new Set(namen)]
}

const ATTRIBUTION =
  /berichte|schreib|meld|laut\b|gem[äa]e?ss\b|zufolge|nach angaben|so (?:die|der|das)\b|heisst es|wie .{0,50}?(?:berichtet|schreibt|meldet|festh[äa]lt|erfahren hat|recherchiert)/i

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The medium must be named AS the source — by its domain or one of the
 * house's short names, with a word that says it is telling us.
 */
export function attributionsWarnung(
  text: string,
  fakten: Pick<SmdFakten, 'medium'>
): string | null {
  const klein = text.normalize('NFC').toLowerCase()
  const genannt = mediumNamen(fakten.medium).some((name) =>
    new RegExp(`(?<![\\p{L}])${escape(name)}(?![\\p{L}])`, 'u').test(klein)
  )
  if (!genannt) return `Die Meldung nennt ${fakten.medium} nicht als Quelle.`
  if (!ATTRIBUTION.test(klein))
    return `Die Meldung sagt nicht, dass ${fakten.medium} die Quelle ist ("wie ${fakten.medium} berichtet").`
  return null
}

/**
 * Every digit in the text must come from the handed material. Run BEFORE
 * `mitQuelle` appends the address, whose digits are nobody's claim.
 */
export function zahlWarnungen(text: string, fakten: SmdFakten): string[] {
  const erlaubt = new Set<string>()
  const sammle = (quelle: string | null): void => {
    if (quelle === null) return
    for (const treffer of quelle.matchAll(/\d+/g)) {
      erlaubt.add(treffer[0])
      erlaubt.add(String(Number(treffer[0])))
    }
  }
  sammle(fakten.titel)
  sammle(fakten.lead)
  sammle(fakten.datum)
  sammle(fakten.zeit)
  sammle(fakten.text)
  const gefunden = [...text.matchAll(/\d+/g)].map((t) => t[0])
  return [...new Set(gefunden.filter((z) => !erlaubt.has(z)))].map(
    (z) => `Zahl "${z}" steht nicht in den Angaben.`
  )
}
