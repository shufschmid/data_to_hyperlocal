// The press review: what a weekly paper has exclusively, and the checks that
// keep our summaries fair.
//
// Two calls live here, with their prompts and validations side by side. The
// INVENTORY reads a whole issue and proposes candidates — only the paper's own
// journalism, never what the municipality publishes itself. The MELDUNG turns
// one picked candidate into a short summary in our own words, with a mandatory
// attribution and a source link the code appends deterministically.
//
// Fairness is enforced, not hoped for: `attributionsWarnung` proves the paper
// is named, and `ueberlappungsWarnungen` slides word-8-grams of our text over
// the issue's text layer — the check that tells "own words" from copying.

import type Anthropic from '@anthropic-ai/sdk'
import { alleDaten, heuteAus } from '../shared/gemeindeseite/datum'
import { seitenLink } from '../shared/wochenblatt/parse'
import { heuteIso } from './feiertage'
import { vorgabenZeilen } from './lernen'
import type { HinweisUrteil, Verwurf } from './lernsignale'
import { terminTageZeilen } from './termin'
import type {
  Ablehnungsgrund,
  KandidatEntscheid,
  KandidatTyp,
  KandidatZeitbezug
} from '../types/schema'
export { parseMeldungstext as parsePresseschau } from './spielbericht'

const TYPEN: ReadonlyArray<KandidatTyp> = [
  'interview',
  'reportage',
  'portraet',
  'hintergrund',
  'vereinsleben',
  'veranstaltung',
  'service',
  'erfolgsmeldung',
  'fotoverweis'
]

const ZEITBEZUEGE: ReadonlyArray<KandidatZeitbezug> = [
  'vorschau',
  'rueckschau',
  'keiner'
]

const ISO_TAG = /^\d{4}-\d{2}-\d{2}$/

// ---------------------------------------------------------------------------
// The inventory: one Opus call per issue.
// ---------------------------------------------------------------------------

export const INVENTAR_SYSTEM_PROMPT = `Du liest eine Ausgabe einer Schweizer Gemeinde-Wochenzeitung fuer eine lokale Redaktion und inventarisierst, was das Blatt EXKLUSIV hat.

Was ein Kandidat ist:
- Eigene journalistische Stuecke des Blatts: Interviews, Reportagen, Portraets,
  Hintergruende, aufgespuerte lokale Geschichten. Das ist der Kern.
- Beachte die Frontseite: Was dort angerissen wird, ist oft am interessantesten.
  Markiere solche Kandidaten mit "frontseite": true.
- Vereinsmeldungen sind oft ebenfalls exklusiv. Zukuenftiges (Anlaesse, offene
  Proben, Feste, Info-Abende) ist interessanter als Rueckblicke — Typ
  "veranstaltung" oder "service". Verlaengerte Ausstellungen und oeffentliche
  Anlaesse sind Kandidaten. Erfolgsmeldungen (Bestzeiten, Auszeichnungen) sind
  Kandidaten — Typ "erfolgsmeldung".
- Ein grosser Rueckblick mit vielen Fotos wird zum Kandidaten vom Typ
  "fotoverweis": die Meldung wird nur darauf verweisen, dass das Blatt dabei
  war und Fotos hat.
- Sportberichte zu lokalen Clubs: Resultate sind KEINE Kandidaten (die liest
  die Redaktion an der Quelle mit). Saisonvorschauen und Personalien (Ziele,
  Transfers, neue Funktionaere) sind Kandidaten — Typ "hintergrund".

Was KEIN Kandidat ist:
- Amtliche Publikationen und Gemeinde-Mitteilungen (Baupublikationen,
  Einwohnerrat, Schulhaus-Baustellen, Hallenbad-Zeiten) — die stehen
  tagesaktuell auf der Gemeindewebsite.
- Beitraege, die erkennbar auf Behoerden- oder Verbands-Medienmitteilungen
  beruhen ("wie X informierte").
- Agenda-Listen, Kirchenzettel, Inserate, PR, hauseigene Verlosungen.

Je Kandidat:
- "titel" wie gedruckt, "seite" als Zahl, "typ" aus der Liste.
- "warum_exklusiv": ein Satz, warum das nur hier steht.
- "zusammenfassung": 3 bis 5 Saetze NACKTE FAKTEN — Namen, Zahlen, Daten,
  Orte. Sie ist spaeter die einzige Quelle der Meldung, also muss alles
  Wesentliche drinstehen. Uebernimm keine ganzen Saetze des Blatts.
- Daten absolut ("am 26. August 2026"), nie relativ.

Gemeinde-Zuordnung: Der Auftrag nennt die Gemeinden, fuer die die Redaktion
arbeitet — NICHT alle Gemeinden, die das Blatt abdeckt. Ein Blatt deckt oft
mehr Gemeinden ab (Nachbargemeinden), die uns nichts angehen.
- Massgeblich ist der Rubrik-Kopf der Seite (oben, meist der Gemeindename in
  Grossbuchstaben, z.B. "ARLESHEIM", "MUENCHENSTEIN"). Nennt er eine Gemeinde
  AUS DEM AUFTRAG, ordne den Beitrag ihr zu.
- Nennt der Rubrik-Kopf eine Gemeinde, die NICHT im Auftrag steht (eine
  Nachbargemeinde wie z.B. Reinach oder Oberwil, wenn diese nicht genannt
  sind), gehoert die GANZE Seite nicht zu unserem Gebiet: lass alle ihre
  Beitraege weg — oder, falls du einen dennoch auffuehrst, setze "gemeinde"
  auf den FREMDEN Gemeindenamen, wie er im Kopf steht. Ordne solche Beitraege
  NIE einer Auftrags-Gemeinde zu — das waere falsch.
- Nur wo ein Rubrik-Kopf fehlt (etwa auf der Front), entscheide am Inhalt; auch
  dann zaehlt nur, was eine Auftrags-Gemeinde betrifft. Bleibt es unklar, nimm
  die erstgenannte Auftrags-Gemeinde und benenne die Unsicherheit in "hinweise".

Zeitbezug je Kandidat — die Redaktion blendet eine Vorschau aus, sobald ihr
Anlass vorbei ist:
- "zeitbezug": "vorschau", wenn der Beitrag etwas ANKUENDIGT, das erst noch
  stattfindet (ein Spiel, ein Fest, ein Konzert, eine Eroeffnung, ein
  Info-Abend); "rueckschau", wenn er von etwas berichtet, das schon
  stattgefunden hat — das Blatt war dabei, oft mit Bildern (ein "fotoverweis"
  ist immer "rueckschau"); "keiner" fuer alles ohne Anlass (Portraet,
  Hintergrund, Interview, Erfolgsmeldung).
- "anlass_am": NUR bei einer Vorschau der Tag des Anlasses als JJJJ-MM-TT, bei
  mehreren Tagen der LETZTE. Nur ein Tag, der im Beitrag steht; nennt der
  Beitrag keinen, ist "anlass_am" null. Bei "rueckschau" und "keiner" immer
  null.

Geburtstags- und Jubilaeums-Portraets sind nur Kandidaten, wenn die
Lebensgeschichte selbst berichtenswert ist (eine Stadtmeisterin, eine
ungewoehnliche Karriere, eine historische Rolle). Ein gewoehnlicher runder
Geburtstag oder ein Ehejubilaeum ohne besondere Zutaten nimmt die Huerde nicht.

Recherche-Faehrten: Leserbriefe sind NIE Kandidaten — sie werden nie
ungeprueft uebernommen. Aber sie (und andere Beitraege) koennen Faehrten fuer
eigene Recherchen tragen: konkrete lokale Projekte, Konflikte oder
Missstaende, die jemand nachpruefen koennte (etwa geplante sechs Meter hohe
Hochwasserschutz-Daemme). Gib solche unter "recherchehinweise" zurueck, mit
Titel, Fundort ("Leserbrief '…', S. 2"), Seite (als Zahl), Begruendung und
Gemeinde. Sei SEHR zurueckhaltend: hoechstens zwei bis drei Faehrten je
Ausgabe, und nur, was die Redaktion wirklich interessieren muss — eine
verpasste Faehrte ist verschmerzbar, ein Dutzend belanglose verstopfen den
Tisch. Eine Faehrte ist ein ueberpruefbarer Ansatz, keine Meinung und keine
Stimmung. Gibt eine Ausgabe nichts her, ist eine leere Liste die richtige
Antwort.

Perlen: Eine Perle ist KURIOS UND UEBERoertlich — die Geschichte, die auch die
Stadt Basel amuesiert oder interessiert (nach dem Geschmack der Redaktion etwa:
pfeifende Hochhaeuser, die ein Dorf wachhalten; ein ausgebuexter Esel; eine
Bruecke, die "Sauschwaenzlibrugg" heisst; eine weltweit einmalige Messreihe).
Blosse Betroffenheit macht keine Perle. Markiere solche Kandidaten mit
"perle_vorschlag": true und begruende — und sei damit zurueckhaltend.

Weiterreichen an die Chefredaktion: NUR wenn eine der nummerierten Regeln der
Redaktion (R1, R2, …) verlangt, dass solche Beitraege an die Chefredaktion
gehen, setze "empfehlung": "weiterreichen" und nenne die Nummer dieser Regel
in "empfehlung_regel". Ohne eine solche Regel sind beide null — du erfindest
keine Weitergabe.

Regeln, ohne Ausnahme:
- Was unklar ist, gehoert nach "hinweise" — rate nicht. Ein fehlender Kandidat
  wird von der Redaktion nachgetragen; ein erfundener kostet Vertrauen.
- Jeder Vorschlag kostet die Redaktion Zeit. Liegen gelassene und abgelehnte
  Vorschlaege sind Fehlvorschlaege. Schlage nur vor, was die Redaktion nach
  ihren Regeln und Beispielen uebernehmen wuerde — lieber drei treffende
  Kandidaten als zehn, von denen sie sieben ignoriert.
- Schweizer Rechtschreibung: "ss" statt "ß".`

export const INVENTAR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kandidaten', 'recherchehinweise', 'hinweise'],
  properties: {
    kandidaten: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'titel',
          'seite',
          'typ',
          'gemeinde',
          'frontseite',
          'warum_exklusiv',
          'zusammenfassung',
          'perle_vorschlag',
          'perle_begruendung',
          'empfehlung',
          'empfehlung_regel',
          'zeitbezug',
          'anlass_am'
        ],
        properties: {
          titel: { type: 'string' },
          seite: { type: ['integer', 'null'] },
          typ: { type: 'string', enum: [...TYPEN] },
          gemeinde: { type: ['string', 'null'] },
          frontseite: { type: 'boolean' },
          warum_exklusiv: { type: 'string' },
          zusammenfassung: { type: 'string' },
          perle_vorschlag: { type: 'boolean' },
          perle_begruendung: { type: ['string', 'null'] },
          // A nullable enum as type + enum is rejected by the API (measured
          // 15.09.2026: "Enum value 'weiterreichen' does not match declared
          // type [string, null]"); the anyOf form is accepted.
          empfehlung: {
            anyOf: [
              { type: 'string', enum: ['weiterreichen'] },
              { type: 'null' }
            ]
          },
          empfehlung_regel: { type: ['string', 'null'] },
          zeitbezug: { type: 'string', enum: [...ZEITBEZUEGE] },
          anlass_am: { type: ['string', 'null'] }
        }
      }
    },
    recherchehinweise: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titel', 'fundort', 'seite', 'begruendung', 'gemeinde'],
        properties: {
          titel: { type: 'string' },
          fundort: { type: ['string', 'null'] },
          seite: { type: ['integer', 'null'] },
          begruendung: { type: ['string', 'null'] },
          gemeinde: { type: ['string', 'null'] }
        }
      }
    },
    hinweise: { type: 'array', items: { type: 'string' } }
  }
} as const satisfies Record<string, unknown>

/** One past editorial decision, as the learning digest needs it. */
export interface LernEintrag {
  titel: string
  typ: KandidatTyp
  entscheid: KandidatEntscheid
  ablehnungsgrund: Ablehnungsgrund | null
  ablehnungskommentar: string | null
  perleVorschlag: boolean
  /**
   * The Chefredaktion's verdict on the proposal, straight from the candidate
   * — independent of any Meldung. Null while it sits on her desk.
   */
  perleBestaetigt: boolean | null
  /** Her reason, where she gave one. */
  perleKommentar?: string | null
  /** Taken over, but the Meldung written from it was discarded afterwards. */
  meldungVerworfen?: Verwurf | null
  /** For a hand-up: what the Chefredaktion made of it. Null while unknown. */
  faehrte?: HinweisUrteil | null
}

const GRUND_TEXT: Record<Ablehnungsgrund, string> = {
  nicht_relevant: 'nicht relevant',
  doublette: 'Doublette',
  veraltet: 'veraltet',
  falsche_gemeinde: 'falsche Gemeinde',
  andere: 'anderer Grund'
}

/** A municipality reassignment by the editor — the assignment's teacher. */
export interface GemeindeKorrektur {
  titel: string
  gemeinde: string
}

/** The editor's verdict on a proposed research lead. */
export interface FaehrtenUrteil {
  titel: string
  brauchbar: boolean
  kommentar: string | null
}

/** A Perle verdict across ALL papers — taste is the newsroom's, not a paper's. */
export interface PerlenUrteil {
  titel: string
  blatt: string | null
  bestaetigt: boolean
  kommentar: string | null
}

/** What frames the examples — see `lernsignale.ts`, where it is computed. */
export interface DigestRahmen {
  bilanz?: string
  verfallene?: readonly string[]
  kappung?: string
  perlen?: readonly PerlenUrteil[]
}

/** The example line for a taken-over row, with its fate if it had one. */
function verwurfText(v: Verwurf | null | undefined): string {
  if (v === null || v === undefined) return ''
  return ` — die Meldung dazu wurde danach verworfen${v.grund === null ? '' : `: ${v.grund}`}`
}

/**
 * What the newsroom taught us, as examples for the next inventory.
 *
 * No distillation call, no second memory system: the decisions themselves are
 * the memory, and this renders the recent ones as few-shot examples. Belongs
 * in the USER turn — it changes with every decision, and the system prompt
 * must stay byte-identical.
 *
 * A hand-up is rendered by what the Chefredaktion made of it: still on her
 * desk, confirmed as a lead, or binned. Rendering every hand-up as "good" —
 * as this did before — taught the inventory to propose more of what she
 * threw out, and a hand-up a RULE made is no example at all until she judged
 * it, or the automation would feed itself.
 */
export function lernDigest(
  entscheide: readonly LernEintrag[],
  korrekturen: readonly GemeindeKorrektur[] = [],
  faehrten: readonly FaehrtenUrteil[] = [],
  rahmen: DigestRahmen = {}
): string {
  const uebernommen = entscheide.filter((e) => e.entscheid === 'uebernommen')
  const abgelehnt = entscheide.filter((e) => e.entscheid === 'abgelehnt')
  const weitergereicht = entscheide.filter(
    (e) =>
      e.entscheid === 'weitergereicht' &&
      !(e.faehrte?.automatisch === true && e.faehrte.status === 'offen')
  )
  const offenBeiChefin = weitergereicht.filter(
    (e) =>
      e.faehrte === null ||
      e.faehrte === undefined ||
      e.faehrte.status === 'offen'
  )
  const bestaetigt = weitergereicht.filter(
    (e) => e.faehrte?.status === 'brauchbar'
  )
  const abgelegt = weitergereicht.filter(
    (e) =>
      e.faehrte?.status === 'kein_hinweis' ||
      e.faehrte?.status === 'zurueckgegeben'
  )
  const perlenGlobal = rahmen.perlen ?? []
  const perlen =
    perlenGlobal.length > 0
      ? []
      : entscheide.filter((e) => e.perleVorschlag && e.perleBestaetigt !== null)
  const verfallene = rahmen.verfallene ?? []
  const bilanz = rahmen.bilanz ?? ''
  if (
    uebernommen.length === 0 &&
    abgelehnt.length === 0 &&
    weitergereicht.length === 0 &&
    perlen.length === 0 &&
    perlenGlobal.length === 0 &&
    korrekturen.length === 0 &&
    faehrten.length === 0 &&
    verfallene.length === 0 &&
    bilanz === ''
  ) {
    return ''
  }

  const zeilen: string[] = [
    'Was die Redaktion bei frueheren Ausgaben dieses Blatts entschieden hat:'
  ]
  if (bilanz !== '') zeilen.push('', bilanz)
  if (verfallene.length > 0) {
    zeilen.push(
      '',
      'Liegen gelassen — Vorschlaege, die der Redaktion nicht einmal einen Klick wert waren:'
    )
    for (const titel of verfallene) zeilen.push(`- "${titel}"`)
  }
  if (uebernommen.length > 0) {
    zeilen.push('', 'Uebernommen (solche Vorschlaege waren gut):')
    for (const e of uebernommen) {
      zeilen.push(`- "${e.titel}" (${e.typ})${verwurfText(e.meldungVerworfen)}`)
    }
  }
  if (abgelehnt.length > 0) {
    zeilen.push('', 'Abgelehnt (solche Vorschlaege nicht mehr machen):')
    for (const e of abgelehnt) {
      const grund =
        e.ablehnungsgrund === null ? '' : ` — ${GRUND_TEXT[e.ablehnungsgrund]}`
      const kommentar =
        e.ablehnungskommentar === null ? '' : `: ${e.ablehnungskommentar}`
      zeilen.push(`- "${e.titel}" (${e.typ})${grund}${kommentar}`)
    }
  }
  if (offenBeiChefin.length > 0) {
    zeilen.push(
      '',
      'An die Chefredaktion weitergereicht (gute Vorschlaege, die erst verifiziert werden muessen — weiter solche machen):'
    )
    for (const e of offenBeiChefin) zeilen.push(`- "${e.titel}" (${e.typ})`)
  }
  if (bestaetigt.length > 0) {
    zeilen.push(
      '',
      'Weitergereicht und von der Chefredaktion als brauchbare Faehrte bestaetigt (weiter solche machen):'
    )
    for (const e of bestaetigt) {
      const kommentar =
        e.faehrte?.kommentar == null ? '' : ` — ${e.faehrte.kommentar}`
      zeilen.push(`- "${e.titel}" (${e.typ})${kommentar}`)
    }
  }
  if (abgelegt.length > 0) {
    zeilen.push(
      '',
      'Weitergereicht, aber von der Chefredaktion abgelegt — kein Hinweis (solche nicht mehr vorschlagen):'
    )
    for (const e of abgelegt) {
      const kommentar =
        e.faehrte?.kommentar == null ? '' : ` — ${e.faehrte.kommentar}`
      zeilen.push(`- "${e.titel}" (${e.typ})${kommentar}`)
    }
  }
  if (rahmen.kappung !== undefined && rahmen.kappung !== '') {
    zeilen.push(rahmen.kappung)
  }
  if (perlenGlobal.length > 0) {
    zeilen.push(
      '',
      'Perlen-Urteile der Chefredaktion, ueber alle Blaetter (Perle heisst: auch die Stadt will die Geschichte):'
    )
    for (const p of perlenGlobal) {
      const blatt = p.blatt === null ? '' : ` (${p.blatt})`
      const kommentar = p.kommentar === null ? '' : ` — ${p.kommentar}`
      zeilen.push(
        `- "${p.titel}"${blatt}: ${p.bestaetigt ? 'als Perle bestaetigt' : 'doch keine Perle'}${kommentar}`
      )
    }
  } else if (perlen.length > 0) {
    zeilen.push('', 'Perlen-Urteile der Redaktion:')
    for (const e of perlen) {
      const kommentar = e.perleKommentar == null ? '' : ` — ${e.perleKommentar}`
      zeilen.push(
        `- "${e.titel}": ${e.perleBestaetigt === true ? 'als Perle bestaetigt' : 'doch keine Perle'}${kommentar}`
      )
    }
  }
  if (korrekturen.length > 0) {
    zeilen.push(
      '',
      'Gemeinde-Korrekturen der Redaktion (solche Beitraege kuenftig gleich richtig zuordnen):'
    )
    for (const k of korrekturen) {
      zeilen.push(`- "${k.titel}" gehoert zu ${k.gemeinde}`)
    }
  }
  if (faehrten.length > 0) {
    zeilen.push('', 'Urteile ueber vorgeschlagene Recherche-Faehrten:')
    for (const f of faehrten) {
      const kommentar = f.kommentar === null ? '' : ` — ${f.kommentar}`
      zeilen.push(
        `- "${f.titel}": ${f.brauchbar ? 'brauchbare Faehrte' : 'keine Faehrte'}${kommentar}`
      )
    }
  }
  return zeilen.join('\n')
}

/**
 * How the issue reaches the inventory call: as the PDF itself, or — when the
 * file outgrows an API request — as its text layer, page by page.
 */
export type InventarQuelle =
  | { art: 'pdf'; base64: string }
  | { art: 'seitentexte'; seitenTexte: readonly string[] }

/**
 * Past this, the PDF stays home and the text layer travels: the API takes 32
 * MB per request, base64 inflates by a third, and issuu originals measure up
 * to 34 MB. Code decides the transport — never the model, never a retry.
 */
export const INVENTAR_PDF_MAX_BYTES = 20 * 1024 * 1024

export function brauchtTextTransport(pdfBytes: number): boolean {
  return pdfBytes > INVENTAR_PDF_MAX_BYTES
}

/**
 * The one user turn of the inventory: the issue first (PDF or page texts),
 * then who and what this is, then what the newsroom taught us so far.
 */
export function buildInventarMessages(
  quelle: InventarQuelle,
  blatt: {
    name: string
    /** Covered municipalities, main one first — the assignment's answer set. */
    gemeinden: readonly string[]
    nummer: string | null
    datum: string | null
  },
  digest: string,
  /** The desk's Sichtung rules, already rendered (`regelnBlock`) — user turn, like the digest. */
  regeln = ''
): Anthropic.MessageParam[] {
  const abdeckung =
    blatt.gemeinden.length === 1
      ? `Gemeinde ${blatt.gemeinden[0]}`
      : `deckt die Gemeinden ${blatt.gemeinden.join(', ')} ab — ordne jeden Kandidaten und jede Recherche-Faehrte genau einer davon zu`
  const kopf =
    `Das ist die Ausgabe${blatt.nummer === null ? '' : ` Nr. ${blatt.nummer}`}` +
    ` des "${blatt.name}" (${abdeckung})` +
    `${blatt.datum === null ? '' : ` vom ${blatt.datum}`}.`

  const ausgabe: Anthropic.ContentBlockParam =
    quelle.art === 'pdf'
      ? {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: quelle.base64
          }
        }
      : {
          type: 'text',
          text: [
            'Von dieser Ausgabe liegt nur der Textlayer vor (das PDF ist zu',
            'gross fuer die Anfrage) — keine Bilder. Fotoberichte erkennst du',
            'an Bildlegenden und Fototexten.',
            '',
            ...quelle.seitenTexte.map(
              (text, i) => `--- Seite ${i + 1} ---\n${text}`
            )
          ].join('\n')
        }

  return [
    {
      role: 'user',
      content: [
        ausgabe,
        {
          type: 'text',
          text: [
            kopf,
            '',
            ...(regeln === '' ? [] : [regeln, '']),
            ...(digest === '' ? [] : [digest, '']),
            'Inventarisiere die exklusiven Beitraege dieser Ausgabe als',
            'Kandidaten, und alles Unklare als "hinweise".'
          ].join('\n')
        }
      ]
    }
  ]
}

export interface InventarKandidat {
  titel: string
  seite: number | null
  typ: KandidatTyp
  /** Canonical municipality name out of the covered list. */
  gemeinde: string
  frontseite: boolean
  warum_exklusiv: string
  zusammenfassung: string
  perle_vorschlag: boolean
  perle_begruendung: string | null
  /** Only ever set when a numbered rule of the newsroom asked for it — checked by code. */
  empfehlung: 'weiterreichen' | null
  empfehlung_regel: string | null
  /** Announcement, report of something past, or neither. */
  zeitbezug: KandidatZeitbezug
  /** The event's day on a `vorschau` — null unless the code found it in the piece. */
  anlass_am: string | null
}

/**
 * What `parseInventar` checks a proposed event day against: the issue's own
 * text layer, and the day the issue appeared (a "Samstag, 3. Oktober" without
 * a year is read forward from there).
 */
export interface InventarDatumsGrundlage {
  seitenTexte?: readonly (string | null)[]
  stichtag?: string | null
}

export interface InventarFaehrte {
  titel: string
  fundort: string | null
  /** Where the piece stands — validated against OUR page count, like a candidate's. */
  seite: number | null
  begruendung: string | null
  gemeinde: string | null
}

export interface Inventar {
  kandidaten: InventarKandidat[]
  recherchehinweise: InventarFaehrte[]
  hinweise: string[]
}

/**
 * The hand-up recommendation as the answer carries it — a claim, kept as
 * given; `automatischeWeitergabe` in `lernen.ts` decides whether the cited
 * rule exists and is armed. Shared by the three Sichtungen.
 */
export function empfehlungAus(e: Record<string, unknown>): {
  empfehlung: 'weiterreichen' | null
  empfehlung_regel: string | null
} {
  const empfehlung =
    e['empfehlung'] === 'weiterreichen' ? 'weiterreichen' : null
  const nummer =
    typeof e['empfehlung_regel'] === 'string'
      ? e['empfehlung_regel'].trim()
      : ''
  return {
    empfehlung,
    empfehlung_regel: empfehlung === null || nummer === '' ? null : nummer
  }
}

/**
 * The model's answer is a promise, not a proof.
 *
 * The page number is checked against the page count WE extracted from the PDF
 * — a fact we hold, not the model's claim. A candidate that fails is dropped
 * and named in `hinweise`, never silently repaired.
 */
export function parseInventar(
  antwort: unknown,
  seiten: number | null,
  gemeinden: readonly string[] = [],
  grundlage: InventarDatumsGrundlage = {}
): Inventar {
  if (typeof antwort !== 'object' || antwort === null) {
    throw new Error('Antwort ist kein Objekt.')
  }
  const roh = antwort as Record<string, unknown>
  if (!Array.isArray(roh.kandidaten))
    throw new Error('Feld "kandidaten" fehlt.')

  const hinweise: string[] = Array.isArray(roh.hinweise)
    ? roh.hinweise.filter((h): h is string => typeof h === 'string')
    : []

  const hauptGemeinde = gemeinden[0] ?? ''
  // Case-insensitive lookup back to OUR canonical spelling — the model's
  // claim is matched against the handed list, never trusted verbatim.
  const gemeindeKanon = new Map(gemeinden.map((g) => [g.toLowerCase(), g]))
  // Returns the canonical covered municipality, or null when the candidate
  // does not belong to any of them.
  //
  // A paper often covers neighbouring municipalities we do NOT report on (the
  // Wochenblatt für das Birseck carries whole Reinach and Dornach sections;
  // the BiBo covers four municipalities of which only Bottmingen is ours). A
  // candidate the model files under a FOREIGN name is always dropped, never
  // refiled under the nearest covered municipality — that misfiling is the
  // exact bug this guards. An UNNAMED candidate is dropped only when several
  // covered municipalities compete; with a single one there is no ambiguity.
  const ordneGemeindeZu = (wert: unknown, titel: string): string | null => {
    const name =
      typeof wert === 'string'
        ? gemeindeKanon.get(wert.trim().toLowerCase())
        : undefined
    if (name !== undefined) return name

    const benannt = typeof wert === 'string' && wert.trim() !== ''
    if (!benannt && gemeinden.length <= 1) return hauptGemeinde

    hinweise.push(
      `"${titel}": ${benannt ? `Gemeinde "${String(wert).trim()}" gehoert nicht zum Gebiet` : 'keine Gemeinde aus dem Gebiet'} — nicht aufgenommen.`
    )
    return null
  }

  const kandidaten: InventarKandidat[] = []
  const gesehen = new Set<string>()

  for (const eintrag of roh.kandidaten) {
    if (typeof eintrag !== 'object' || eintrag === null) continue
    const e = eintrag as Record<string, unknown>

    const titel = typeof e.titel === 'string' ? e.titel.trim() : ''
    const zusammenfassung =
      typeof e.zusammenfassung === 'string' ? e.zusammenfassung.trim() : ''
    if (titel === '' || zusammenfassung === '') {
      hinweise.push(
        'Ein Kandidat ohne Titel oder Zusammenfassung wurde verworfen.'
      )
      continue
    }

    const typ = TYPEN.find((t) => t === e.typ)
    if (typ === undefined) {
      hinweise.push(
        `"${titel}": unbekannter Typ "${String(e.typ)}" — verworfen.`
      )
      continue
    }

    const gemeinde = ordneGemeindeZu(e.gemeinde, titel)
    if (gemeinde === null) continue

    let seite =
      typeof e.seite === 'number' && Number.isInteger(e.seite) ? e.seite : null
    if (seite !== null && seiten !== null && (seite < 1 || seite > seiten)) {
      hinweise.push(
        `"${titel}": Seite ${seite} liegt ausserhalb der Ausgabe (${seiten} Seiten) — Seitenangabe entfernt.`
      )
      seite = null
    }

    const schluessel = `${titel.toLowerCase()}|${seite ?? ''}`
    if (gesehen.has(schluessel)) continue
    gesehen.add(schluessel)

    const frontseite = e.frontseite === true
    const zeitbezug =
      ZEITBEZUEGE.find((z) => z === e.zeitbezug) ?? ('keiner' as const)
    const anlass_am =
      zeitbezug === 'vorschau'
        ? pruefeAnlasstag(e.anlass_am, {
            titel,
            zusammenfassung,
            seite: seite ?? (frontseite ? 1 : null),
            grundlage,
            hinweise
          })
        : null

    kandidaten.push({
      titel,
      seite,
      typ,
      gemeinde,
      frontseite,
      warum_exklusiv:
        typeof e.warum_exklusiv === 'string' ? e.warum_exklusiv.trim() : '',
      zusammenfassung,
      perle_vorschlag: e.perle_vorschlag === true,
      perle_begruendung:
        typeof e.perle_begruendung === 'string' &&
        e.perle_begruendung.trim() !== ''
          ? e.perle_begruendung.trim()
          : null,
      ...empfehlungAus(e),
      zeitbezug,
      anlass_am
    })
  }

  const recherchehinweise: InventarFaehrte[] = []
  if (Array.isArray(roh.recherchehinweise)) {
    for (const eintrag of roh.recherchehinweise) {
      if (typeof eintrag !== 'object' || eintrag === null) continue
      const e = eintrag as Record<string, unknown>
      const titel = typeof e.titel === 'string' ? e.titel.trim() : ''
      if (titel === '') continue

      // A lead without a covered municipality is still a lead — unlike a
      // candidate it never becomes an article, so null is honest here.
      const roheGemeinde =
        typeof e.gemeinde === 'string'
          ? gemeindeKanon.get(e.gemeinde.trim().toLowerCase())
          : undefined

      let faehrtenSeite =
        typeof e.seite === 'number' && Number.isInteger(e.seite)
          ? e.seite
          : null
      if (
        faehrtenSeite !== null &&
        seiten !== null &&
        (faehrtenSeite < 1 || faehrtenSeite > seiten)
      ) {
        faehrtenSeite = null
      }

      recherchehinweise.push({
        titel,
        fundort:
          typeof e.fundort === 'string' && e.fundort.trim() !== ''
            ? e.fundort.trim()
            : null,
        seite: faehrtenSeite,
        begruendung:
          typeof e.begruendung === 'string' && e.begruendung.trim() !== ''
            ? e.begruendung.trim()
            : null,
        gemeinde: roheGemeinde ?? null
      })
    }
  }

  return { kandidaten, recherchehinweise, hinweise }
}

/**
 * The event day of a Vorschau, bound to the piece the same way a termin is
 * bound to a municipal notice: the model names it, the CODE must find it —
 * in the summary, the title, or the text layer of the piece's page and the
 * next one (a Reportage runs over). A day nowhere in there is dropped and
 * named; the candidate stays, it only will not fold away by itself.
 */
function pruefeAnlasstag(
  roh: unknown,
  kontext: {
    titel: string
    zusammenfassung: string
    seite: number | null
    grundlage: InventarDatumsGrundlage
    hinweise: string[]
  }
): string | null {
  if (typeof roh !== 'string') return null
  const tag = roh.trim()
  if (!ISO_TAG.test(tag)) return null

  const seiten = kontext.grundlage.seitenTexte ?? []
  const teile = [kontext.titel, kontext.zusammenfassung]
  if (kontext.seite !== null) {
    for (const n of [kontext.seite, kontext.seite + 1]) {
      const text = seiten[n - 1]
      if (typeof text === 'string') teile.push(text)
    }
  }
  const stichtag = kontext.grundlage.stichtag ?? heuteIso()
  const funde = alleDaten(teile.join('\n'), heuteAus(stichtag))
  if (funde.includes(tag)) return tag

  kontext.hinweise.push(
    `"${kontext.titel}": Anlasstag ${tag} steht nicht im Beitrag — ohne Datum aufgenommen, die Vorschau wird nicht von selbst ausgeblendet.`
  )
  return null
}

/**
 * A preview whose event has passed: the desk folds it away, the next issue
 * lets it lapse. Only an OPEN candidate — one the editor took over, or one
 * a draft is being edited for, never folds away under her hands. A report
 * of something past ("rueckschau") never folds: the paper was there, and
 * that stays worth a line for a while.
 *
 * Mirrored by `vorschauVorbei` in the frontend's `lib/presseschau.ts`.
 */
export function vorschauVorbei(
  kandidat: {
    zeitbezug?: string | null
    anlass_am?: string | null
    entscheid: string
  },
  heute: string
): boolean {
  if (kandidat.entscheid !== 'offen') return false
  if (kandidat.zeitbezug !== 'vorschau') return false
  const tag = kandidat.anlass_am ?? null
  return tag !== null && tag < heute
}

/** How many drafts one click of «Alle Meldungen formulieren» writes. */
export const PRESSESCHAU_FORMULIEREN_JE_KLICK = 20

export interface FormulierKandidat {
  id: string
  entscheid: string
  zeitbezug?: string | null
  anlass_am?: string | null
  zusammenfassung: string | null
}

/**
 * Which candidates the bulk button writes a draft for, in desk order, and
 * how many the cap leaves waiting. Open ones only, none that already has a
 * Meldung, none without a fact summary (there is nothing to write FROM), and
 * no preview whose event has passed — that one is folded away on the desk
 * and is not worth a model call.
 */
export function formulierbare<T extends FormulierKandidat>(
  kandidaten: readonly T[],
  mitMeldung: ReadonlySet<string>,
  heute: string,
  hoechstens: number = PRESSESCHAU_FORMULIEREN_JE_KLICK
): { dran: T[]; wartend: number; ohneZusammenfassung: number } {
  const offen = kandidaten.filter(
    (k) =>
      k.entscheid === 'offen' &&
      !mitMeldung.has(k.id) &&
      !vorschauVorbei(k, heute)
  )
  const mitFakten = offen.filter(
    (k) => k.zusammenfassung !== null && k.zusammenfassung.trim() !== ''
  )
  const dran = mitFakten.slice(0, hoechstens)
  return {
    dran,
    wartend: mitFakten.length - dran.length,
    ohneZusammenfassung: offen.length - mitFakten.length
  }
}

// ---------------------------------------------------------------------------
// The Meldung: one Sonnet call per picked candidate.
// ---------------------------------------------------------------------------

export interface PresseschauFakten {
  /** The paper's name as printed — this exact string must appear in the text. */
  blatt: string
  /** As printed: "34", or "30/31". */
  nummer: string
  /** Publication date, `YYYY-MM-DD`, or null when the archive did not say. */
  datum: string | null
  gemeinde: string
  titel: string
  seite: number | null
  typ: KandidatTyp
  frontseite: boolean
  zusammenfassung: string
  /** Resolved PDF or reader address for the source line; the page link is appended in code. */
  pdfUrl: string | null
  /**
   * Every day the code found in the piece (summary plus page text) — the only
   * days the writer may name as its termin. Absent on a call that proposes
   * no termin.
   */
  datenImText?: readonly string[]
}

export const PRESSESCHAU_SYSTEM_PROMPT = `Du schreibst fuer eine lokale Redaktion in der Region Basel kurze Presseschau-Meldungen: eigene Zusammenfassungen dessen, was die Wochenzeitung einer Gemeinde exklusiv berichtet.

Regeln, ohne Ausnahme:
- Verwende NUR die Fakten aus den Angaben. Erfinde nichts und rechne nichts aus.
- Schreibe in EIGENEN WORTEN. Uebernimm keine Saetze und keine Formulierungen
  des Blatts — die Angaben sind bereits eine Faktenliste, bleib bei ihr.
- Nenne die Quelle IM TEXT, mit Namen und Nummer des Blatts. Je nach Art:
  ein Bericht: "wie das {Blatt} (Nr. {Nummer}) berichtet";
  eine Ankuendigung: "kuendigt {wer} im {Blatt} an";
  ein Fotoverweis: "Das {Blatt} war dabei und hat Fotos."
- Nenne Daten absolut ("am 26. August 2026"), niemals relativ ("morgen",
  "naechste Woche"). Der Text muss in fuenf Jahren noch stimmen.
- Schreibe nuechtern und knapp — die Meldung macht neugierig aufs Blatt,
  sie ersetzt es nicht.
- Schweizer Rechtschreibung: "ss" statt "ß".

Umfang: Titel (maximal 70 Zeichen), Lead (ein Satz), Text (ein bis zwei kurze
Absaetze, durch eine Leerzeile getrennt).

Zusaetzlich beurteilst du zwei Dinge FUER DEN NEWSLETTER — sie erscheinen
nicht im Text:
- "termin": Kuendigt der Beitrag etwas an, das an einem Tag stattfindet oder
  bis zu einem Tag gilt — ein Anlass, ein Spiel, eine Ausstellung, eine
  Anmeldefrist? Dann nenne "ideal" (den Tag des Anlasses oder die Frist, bei
  einer Ausstellung ihren ersten Tag) und "ende" (den letzten Tag, an dem die
  Meldung noch Sinn hat — bei einer Ausstellung ihr letzter Tag, sonst
  derselbe wie "ideal"). NUR Tage aus der Liste "Im Beitrag genannte Tage";
  steht der passende Tag nicht dort, ist "termin" null. Ein Rueckblick, ein
  Bildbericht, ein Portraet oder ein Hintergrund ohne Stichtag hat
  "termin": null.
- "wichtig": true, wenn die Sache fuer viele im Dorf zaehlt und eine FRUEHE
  Ankuendigung verdient — ein Dorffest, ein grosses Spiel, eine Eroeffnung,
  eine Veranstaltung, zu der das halbe Dorf kommt. false bei Routine und
  kleinen Anlaessen. Stehen unten Entscheide der Redaktion, richte dich
  danach.

Antworte ausschliesslich mit JSON:
{"titel": "...", "lead": "...", "text": "...", "termin": {"ideal": "JJJJ-MM-TT", "ende": "JJJJ-MM-TT"} | null, "wichtig": true | false}`

const TYP_TEXT: Record<KandidatTyp, string> = {
  interview: 'Interview des Blatts',
  reportage: 'Reportage des Blatts',
  portraet: 'Portraet des Blatts',
  hintergrund: 'Hintergrundbericht des Blatts',
  vereinsleben: 'Bericht aus dem Vereinsleben',
  veranstaltung: 'Ankuendigung einer Veranstaltung',
  service: 'Service-Ankuendigung',
  erfolgsmeldung: 'Erfolgsmeldung',
  fotoverweis:
    'grosser Bildbericht — nur darauf verweisen, dass das Blatt Fotos hat'
}

function faktenZeilen(fakten: PresseschauFakten): string[] {
  return [
    `Gemeinde: ${fakten.gemeinde}`,
    `Blatt: ${fakten.blatt}, Ausgabe Nr. ${fakten.nummer}` +
      (fakten.datum === null ? '' : ` vom ${fakten.datum}`),
    `Beitrag: "${fakten.titel}"` +
      (fakten.seite === null ? '' : ` auf Seite ${fakten.seite}`),
    `Art: ${TYP_TEXT[fakten.typ]}`,
    ...(fakten.frontseite
      ? ['Auf der Frontseite der Ausgabe angerissen.']
      : []),
    '',
    'Fakten aus dem Beitrag:',
    fakten.zusammenfassung,
    ...(fakten.datenImText === undefined
      ? []
      : terminTageZeilen(fakten.datenImText, 'Beitrag'))
  ]
}

export function buildPresseschauPrompt(
  fakten: PresseschauFakten,
  regeln: readonly string[] = [],
  /** What the newsroom decided about importance lately — `wichtigkeitDigest`, or ''. */
  wichtigkeit = ''
): string {
  return [
    ...faktenZeilen(fakten),
    ...vorgabenZeilen(regeln),
    ...(wichtigkeit === '' ? [] : ['', wichtigkeit]),
    '',
    'Schreibe die Presseschau-Meldung. Verwende ausschliesslich diese Angaben.'
  ].join('\n')
}

/** How much of the page's original text a revision may carry. A newspaper
 * page runs 4–8k characters; the cap only guards the pathological case. */
const MAX_QUELLTEXT = 12000

/**
 * Cut with a visible seam — a text that just stops reads as complete. Lives
 * here rather than in `sendung.ts`, which imports from this file; the other
 * direction was a circular dependency in the bundle.
 */
export function gekuerzt(text: string, hoechstens: number): string {
  if (text.length <= hoechstens) return text
  return `${text.slice(0, hoechstens)}\n[… Text gekuerzt — Ende fehlt]`
}

/**
 * Same facts, previous text, editor's instruction — system prompt unchanged.
 *
 * The revision ADDITIONALLY sees the page's original text where the issue
 * carries one. The first write is deliberately summary-only (the one-source
 * rule), but an instruction must be answerable from the whole original —
 * "was stand dort zur Finanzierung?" has no answer in a summary that left the
 * financing out. The overlap check keeps it a press review: reading material,
 * never copy.
 */
export function buildPresseschauRevision(
  fakten: PresseschauFakten,
  bisher: { titel: string | null; lead: string | null; text: string | null },
  anweisung: string,
  quelltext: string | null = null,
  regeln: readonly string[] = []
): string {
  const mitQuelltext = quelltext !== null && quelltext.trim() !== ''
  return [
    ...faktenZeilen(fakten),
    ...vorgabenZeilen(regeln),
    ...(mitQuelltext
      ? [
          '',
          'Originaltext der Seiten im Blatt — die Seite des Beitrags und die folgende (zum Nachschlagen; schreibe weiterhin in EIGENEN Worten, uebernimm keine Saetze):',
          gekuerzt(quelltext as string, MAX_QUELLTEXT)
        ]
      : []),
    '',
    'Bisherige Meldung:',
    `Titel: ${bisher.titel ?? ''}`,
    `Lead: ${bisher.lead ?? ''}`,
    bisher.text ?? '',
    '',
    'Anweisung der Redaktion:',
    anweisung,
    '',
    mitQuelltext
      ? 'Schreibe die Meldung neu. Setze die Anweisung um, aber verwende weiterhin ausschliesslich die Angaben und den Originaltext oben.'
      : 'Schreibe die Meldung neu. Setze die Anweisung um, aber verwende weiterhin ausschliesslich die Angaben oben.'
  ].join('\n')
}

/**
 * The source line, appended by code — never left to the model.
 *
 * The page link opens the reader straight on the piece: `#page=N` for a PDF
 * viewer, a path segment for an issuu reader (see `seitenLink`). The resolved
 * address is used and not the archive page, whose redirect can lose it.
 */
export function quelleZeile(fakten: PresseschauFakten): string {
  const kopf = `Quelle: ${fakten.blatt} Nr. ${fakten.nummer}`
  if (fakten.pdfUrl === null) return kopf
  if (fakten.seite === null) return `${kopf}, ${fakten.pdfUrl}`
  return `${kopf}, ${seitenLink(fakten.pdfUrl, fakten.seite)}`
}

/** Model text plus the deterministic source line — shared by write and revision. */
export function mitQuelle(text: string, fakten: PresseschauFakten): string {
  return `${text.trim()}\n\n${quelleZeile(fakten)}`
}

/**
 * The attribution has to survive every revision: the paper's name AND its
 * issue number, in the running text. Reported, then retried once — a press
 * review without its source is not a press review.
 */
/**
 * The names a paper may be called by in a text: its registered name, and —
 * where that name carries a parenthesis — the part before and the part inside
 * it. „BiBo (Birsigtal-Bote)" is written „der Bibo" in this house (a general
 * rule in „Gelerntes"), and a check insisting on the full registered string
 * would flag the prescribed form and force a rewrite into the wrong one.
 * Lower-cased and NFC, ready for `includes`; nothing shorter than three
 * letters, so a stray initial never counts as a name.
 */
export function blattNamen(blatt: string): string[] {
  const voll = blatt.normalize('NFC').trim()
  const namen = [voll]
  const klammer = /^(.*?)\s*\((.+)\)\s*$/.exec(voll)
  if (klammer !== null) namen.push(klammer[1] ?? '', klammer[2] ?? '')
  return [...new Set(namen.map((n) => n.trim().toLowerCase()))].filter(
    (n) => n.length >= 3
  )
}

export function attributionsWarnung(
  text: string,
  fakten: Pick<PresseschauFakten, 'blatt' | 'nummer'>
): string | null {
  // NFC on both sides: the paper's name comes from the database and the text
  // from the model, and an umlaut can be precomposed ("ü") in one and
  // decomposed ("u" + combining diaeresis) in the other — a mismatch that
  // reads identically but fails a raw `includes`.
  const klein = text.normalize('NFC').toLowerCase()
  const blattDa = blattNamen(fakten.blatt).some((name) => klein.includes(name))
  const nummerDa = new RegExp(
    `nr\\.?\\s*${fakten.nummer.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`,
    'i'
  ).test(text)

  if (blattDa && nummerDa) return null
  if (!blattDa)
    return `Die Quelle "${fakten.blatt}" wird im Text nicht genannt.`
  return `Die Ausgabenummer (Nr. ${fakten.nummer}) wird im Text nicht genannt.`
}

/**
 * Every digit in the text must come from the handed facts — the summary, the
 * issue number, the date, the page. Run BEFORE `mitQuelle` appends the URL,
 * whose digits are nobody's claim.
 */
export function zahlWarnungenPresseschau(
  text: string,
  fakten: PresseschauFakten
): string[] {
  const erlaubt = new Set<string>()
  const sammle = (quelle: string): void => {
    for (const treffer of quelle.matchAll(/\d+/g)) {
      erlaubt.add(treffer[0])
      // "08" in an ISO date is spoken as "8" in prose.
      erlaubt.add(String(Number(treffer[0])))
    }
  }
  sammle(fakten.zusammenfassung)
  sammle(fakten.titel)
  sammle(fakten.nummer)
  sammle(fakten.blatt)
  if (fakten.datum !== null) sammle(fakten.datum)
  if (fakten.seite !== null) erlaubt.add(String(fakten.seite))

  const gefunden = [...text.matchAll(/\d+/g)].map((t) => t[0])
  return [...new Set(gefunden.filter((z) => !erlaubt.has(z)))].map(
    (z) => `Zahl "${z}" steht nicht in den Angaben.`
  )
}

function worte(text: string): string[] {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w !== '')
}

/**
 * Verbatim overlap with the issue's text layer — the check that tells "own
 * words" from copying.
 *
 * Word-8-grams of our text are looked up in a set of the source's 8-grams;
 * every maximal shared run is reported. Eight words is past the length any
 * honest paraphrase shares by accident, while names, dates and titles (which
 * legitimately match) stay well below it.
 */
export function ueberlappungsWarnungen(
  text: string,
  quelltext: string,
  minWorte = 8
): string[] {
  const eigene = worte(text)
  if (eigene.length < minWorte) return []
  const quelle = worte(quelltext)
  if (quelle.length < minWorte) return []

  const gramme = new Set<string>()
  for (let i = 0; i + minWorte <= quelle.length; i += 1) {
    gramme.add(quelle.slice(i, i + minWorte).join(' '))
  }

  const warnungen: string[] = []
  let i = 0
  while (i + minWorte <= eigene.length && warnungen.length < 5) {
    if (!gramme.has(eigene.slice(i, i + minWorte).join(' '))) {
      i += 1
      continue
    }
    // Extend the shared run as far as it goes, then report it whole.
    let ende = i + minWorte
    while (
      ende < eigene.length &&
      gramme.has(eigene.slice(ende - minWorte + 1, ende + 1).join(' '))
    ) {
      ende += 1
    }
    const auszug = eigene.slice(i, Math.min(ende, i + 20)).join(' ')
    warnungen.push(
      `Woertliche Uebernahme aus dem Blatt: "${auszug}${ende - i > 20 ? ' …' : ''}"`
    )
    i = ende
  }
  return warnungen
}
