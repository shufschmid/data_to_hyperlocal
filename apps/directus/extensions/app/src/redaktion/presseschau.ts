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
import type {
  Ablehnungsgrund,
  KandidatEntscheid,
  KandidatTyp
} from '../types/schema'
export { parseSpielbericht as parsePresseschau } from './spielbericht'

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

Gemeinde-Zuordnung: Der Auftrag nennt die Gemeinden, die das Blatt abdeckt.
Ordne JEDEN Kandidaten genau einer davon zu ("gemeinde"). Massgeblich ist der
Gemeinde-Index oben links auf der Seite; wo er fehlt (etwa auf der Front),
entscheide am Inhalt. Laesst es sich nicht entscheiden, nimm die erstgenannte
Gemeinde und benenne die Unsicherheit in "hinweise".

Geburtstags- und Jubilaeums-Portraets sind nur Kandidaten, wenn die
Lebensgeschichte selbst berichtenswert ist (eine Stadtmeisterin, eine
ungewoehnliche Karriere, eine historische Rolle). Ein gewoehnlicher runder
Geburtstag oder ein Ehejubilaeum ohne besondere Zutaten nimmt die Huerde nicht.

Recherche-Faehrten: Leserbriefe sind NIE Kandidaten — sie werden nie
ungeprueft uebernommen. Aber sie (und andere Beitraege) koennen Faehrten fuer
eigene Recherchen tragen: konkrete lokale Projekte, Konflikte oder
Missstaende, die jemand nachpruefen koennte (etwa geplante sechs Meter hohe
Hochwasserschutz-Daemme). Gib solche unter "recherchehinweise" zurueck, mit
Titel, Fundort ("Leserbrief '…', S. 2"), Begruendung und Gemeinde. Sei
zurueckhaltend: eine Faehrte ist ein ueberpruefbarer Ansatz, keine Meinung
und keine Stimmung.

Perlen: Eine Perle ist KURIOS UND UEBERoertlich — die Geschichte, die auch die
Stadt Basel amuesiert oder interessiert (nach dem Geschmack der Redaktion etwa:
pfeifende Hochhaeuser, die ein Dorf wachhalten; ein ausgebuexter Esel; eine
Bruecke, die "Sauschwaenzlibrugg" heisst; eine weltweit einmalige Messreihe).
Blosse Betroffenheit macht keine Perle. Markiere solche Kandidaten mit
"perle_vorschlag": true und begruende — und sei damit zurueckhaltend.

Regeln, ohne Ausnahme:
- Was unklar ist, gehoert nach "hinweise" — rate nicht. Ein fehlender Kandidat
  wird von der Redaktion nachgetragen; ein erfundener kostet Vertrauen.
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
          'perle_begruendung'
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
          perle_begruendung: { type: ['string', 'null'] }
        }
      }
    },
    recherchehinweise: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titel', 'fundort', 'begruendung', 'gemeinde'],
        properties: {
          titel: { type: 'string' },
          fundort: { type: ['string', 'null'] },
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
  /** From the published Meldung; null while unpublished (= no Perle yet). */
  perleBestaetigt: boolean | null
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

/**
 * What the newsroom taught us, as examples for the next inventory.
 *
 * No distillation call, no second memory system: the decisions themselves are
 * the memory, and this renders the recent ones as few-shot examples. Belongs
 * in the USER turn — it changes with every decision, and the system prompt
 * must stay byte-identical.
 */
export function lernDigest(
  entscheide: readonly LernEintrag[],
  korrekturen: readonly GemeindeKorrektur[] = [],
  faehrten: readonly FaehrtenUrteil[] = []
): string {
  const uebernommen = entscheide.filter((e) => e.entscheid === 'uebernommen')
  const abgelehnt = entscheide.filter((e) => e.entscheid === 'abgelehnt')
  const perlen = entscheide.filter(
    (e) => e.perleVorschlag && e.perleBestaetigt !== null
  )
  if (
    uebernommen.length === 0 &&
    abgelehnt.length === 0 &&
    perlen.length === 0 &&
    korrekturen.length === 0 &&
    faehrten.length === 0
  ) {
    return ''
  }

  const zeilen: string[] = [
    'Was die Redaktion bei frueheren Ausgaben dieses Blatts entschieden hat:'
  ]
  if (uebernommen.length > 0) {
    zeilen.push('', 'Uebernommen (solche Vorschlaege waren gut):')
    for (const e of uebernommen) zeilen.push(`- "${e.titel}" (${e.typ})`)
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
  if (perlen.length > 0) {
    zeilen.push('', 'Perlen-Urteile der Redaktion:')
    for (const e of perlen) {
      zeilen.push(
        `- "${e.titel}": ${e.perleBestaetigt === true ? 'als Perle bestaetigt' : 'doch keine Perle'}`
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
 * The one user turn of the inventory: the PDF first, then who and what this
 * is, then what the newsroom taught us so far.
 */
export function buildInventarMessages(
  pdfBase64: string,
  blatt: {
    name: string
    /** Covered municipalities, main one first — the assignment's answer set. */
    gemeinden: readonly string[]
    nummer: string | null
    datum: string | null
  },
  digest: string
): Anthropic.MessageParam[] {
  const abdeckung =
    blatt.gemeinden.length === 1
      ? `Gemeinde ${blatt.gemeinden[0]}`
      : `deckt die Gemeinden ${blatt.gemeinden.join(', ')} ab — ordne jeden Kandidaten und jede Recherche-Faehrte genau einer davon zu`
  const kopf =
    `Das ist die Ausgabe${blatt.nummer === null ? '' : ` Nr. ${blatt.nummer}`}` +
    ` des "${blatt.name}" (${abdeckung})` +
    `${blatt.datum === null ? '' : ` vom ${blatt.datum}`}.`

  return [
    {
      role: 'user',
      content: [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: pdfBase64
          }
        },
        {
          type: 'text',
          text: [
            kopf,
            '',
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
}

export interface InventarFaehrte {
  titel: string
  fundort: string | null
  begruendung: string | null
  gemeinde: string | null
}

export interface Inventar {
  kandidaten: InventarKandidat[]
  recherchehinweise: InventarFaehrte[]
  hinweise: string[]
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
  gemeinden: readonly string[] = []
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
  const ordneGemeindeZu = (
    wert: unknown,
    titel: string,
    still: boolean
  ): string => {
    const name =
      typeof wert === 'string'
        ? gemeindeKanon.get(wert.trim().toLowerCase())
        : undefined
    if (name !== undefined) return name
    if (!still && gemeinden.length > 1) {
      hinweise.push(
        `"${titel}": Gemeinde ${typeof wert === 'string' ? `"${wert}" nicht in der Abdeckung` : 'nicht zugeordnet'} — der Hauptgemeinde ${hauptGemeinde} zugeteilt, bitte pruefen.`
      )
    }
    return hauptGemeinde
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

    const gemeinde = ordneGemeindeZu(e.gemeinde, titel, false)

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

    kandidaten.push({
      titel,
      seite,
      typ,
      gemeinde,
      frontseite: e.frontseite === true,
      warum_exklusiv:
        typeof e.warum_exklusiv === 'string' ? e.warum_exklusiv.trim() : '',
      zusammenfassung,
      perle_vorschlag: e.perle_vorschlag === true,
      perle_begruendung:
        typeof e.perle_begruendung === 'string' &&
        e.perle_begruendung.trim() !== ''
          ? e.perle_begruendung.trim()
          : null
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

      recherchehinweise.push({
        titel,
        fundort:
          typeof e.fundort === 'string' && e.fundort.trim() !== ''
            ? e.fundort.trim()
            : null,
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
  /** Resolved PDF address for the source line; `#page=N` is appended in code. */
  pdfUrl: string | null
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

Antworte ausschliesslich mit JSON:
{"titel": "...", "lead": "...", "text": "..."}`

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
    fakten.zusammenfassung
  ]
}

export function buildPresseschauPrompt(fakten: PresseschauFakten): string {
  return [
    ...faktenZeilen(fakten),
    '',
    'Schreibe die Presseschau-Meldung. Verwende ausschliesslich diese Angaben.'
  ].join('\n')
}

/** Same facts, previous text, editor's instruction — system prompt unchanged. */
export function buildPresseschauRevision(
  fakten: PresseschauFakten,
  bisher: { titel: string | null; lead: string | null; text: string | null },
  anweisung: string
): string {
  return [
    ...faktenZeilen(fakten),
    '',
    'Bisherige Meldung:',
    `Titel: ${bisher.titel ?? ''}`,
    `Lead: ${bisher.lead ?? ''}`,
    bisher.text ?? '',
    '',
    'Anweisung der Redaktion:',
    anweisung,
    '',
    'Schreibe die Meldung neu. Setze die Anweisung um, aber verwende weiterhin ausschliesslich die Angaben oben.'
  ].join('\n')
}

/**
 * The source line, appended by code — never left to the model.
 *
 * `#page=N` opens the browser's PDF viewer straight on the piece, which is why
 * the resolved PDF address is used and not the archive page: its redirect can
 * lose the fragment.
 */
export function quelleZeile(fakten: PresseschauFakten): string {
  const kopf = `Quelle: ${fakten.blatt} Nr. ${fakten.nummer}`
  if (fakten.pdfUrl === null) return kopf
  const fragment = fakten.seite === null ? '' : `#page=${fakten.seite}`
  return `${kopf}, ${fakten.pdfUrl}${fragment}`
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
export function attributionsWarnung(
  text: string,
  fakten: Pick<PresseschauFakten, 'blatt' | 'nummer'>
): string | null {
  const klein = text.toLowerCase()
  const blattDa = klein.includes(fakten.blatt.toLowerCase())
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
