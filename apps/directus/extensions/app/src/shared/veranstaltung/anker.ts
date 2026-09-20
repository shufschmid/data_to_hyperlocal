// The anchor — what could make an Anlass a Meldung, decided by code.
//
// The editor's rules of September 2026, one per branch: waste dates belong to
// the Entsorgung desk and are routed there BEFORE the rhythm rule (Aesch's
// Grünabfuhr every three weeks would otherwise be a "monthly reminder");
// placeholders ("Blanko-Abstimmungstermin") are never events; a cancellation
// or a move is news wherever it stands; a Gremium is proposed because of its
// agenda, whatever its rhythm; a registration deadline anchors BEFORE the
// deadline, not before the date; the first date of a new series is news; a
// one-off is news; a running span begins and — only where one can drop in on
// any day — ends as a last chance; monthly or rarer is a reminder; weekly is
// routine, and a routine comes back as a Dauerangebot every six months, one
// per municipality and week. Nothing here judges news VALUE: that is the
// Sichtung's and the editor's, and the anchor stands beside the row as a
// fact so both can see why it is there.

import type { Anker, Dauerangebot, Zugang } from '../../types/schema'
import { alleDaten, type Heute } from '../gemeindeseite/datum'
import { naechsterTermin } from './anlass'
import {
  erkenneRhythmus,
  verschiebeTage,
  type RhythmusBefund
} from './rhythmus'

export type { Anker, Zugang }

/** How many days before the anchor an Anlass reaches the desk. */
export const VORSCHLAGSFENSTER_TAGE = 10
/** A routine comes back as a reminder this often. The editor's number. */
export const DAUERANGEBOT_INTERVALL_TAGE = 182
/** … and at most this many per municipality and week — the editor's dose. */
export const DAUERANGEBOTE_JE_WOCHE = 1
/** A running span shorter than this has no "last chance" — it was hardly there. */
const ENDET_AB_TAGEN = 7

/**
 * What names a collection date. Wider than the news desk's list on purpose:
 * the calendars print the categories the waste calendar itself uses
 * (Kunststoffsammlung, Altmetallabfuhr, Häckseltag), measured on Aesch,
 * Binningen, Münchenstein and Muttenz.
 */
export const ABFUHR_WORTE =
  /\b(?:abfuhr\w*|kehricht\w*|gr[üu]e?n(?:gut|abfuhr)\w*|papier(?:sammlung|abfuhr)\w*|karton(?:sammlung|abfuhr)\w*|altpapier\w*|h[äa]e?cksel(?:dienst|tag)\w*|altmetall\w*|sonderabf[äa]e?ll\w*|sperrgut\w*|kunststoffsammlung\w*|bioabf[äa]e?ll\w*|glassammlung\w*|sammelstell\w*)\b/iu

export function istAbfuhr(a: {
  titel: string
  kategorie?: string | null
  teaser?: string | null
}): boolean {
  return ABFUHR_WORTE.test(
    `${a.titel}\n${a.kategorie ?? ''}\n${a.teaser ?? ''}`.normalize('NFC')
  )
}

const PLATZHALTER = /\bblanko\b|\breserve-?termin\b|\bplatzhalter\b/iu
export function istPlatzhalter(titel: string): boolean {
  return PLATZHALTER.test(titel.normalize('NFC'))
}

const GREMIUM =
  /\beinwohnerrat\w*|\bgemeindeversammlung\w*|\bgemeinderatssitzung\w*|\bb[üu]rgergemeindeversammlung\w*|\babstimmung\w*|\burnengang\w*|\bwahl(?:en|sonntag|tag|wochenende)?\b|\blandratssitzung\w*/iu
/** A body whose sitting is proposed for its agenda, whatever its rhythm. */
export function istGremium(titel: string): boolean {
  return GREMIUM.test(titel.normalize('NFC'))
}

const AUSFALL =
  /\babgesagt\b|findet nicht statt|f[äa]llt aus|\bentf[äa]llt\b|\babsage\b/iu
const VERSCHOBEN = /\bverschoben\b|neues datum|neuer termin/iu
export function abgesagtOderVerschoben(
  text: string
): 'ausfall' | 'verschoben' | null {
  const t = text.normalize('NFC')
  if (AUSFALL.test(t)) return 'ausfall'
  if (VERSCHOBEN.test(t)) return 'verschoben'
  return null
}

// The captured tail may hold a full stop: "bis 21. September" is a date, not
// the end of the sentence, and the date reader sorts out what follows.
const FRIST_SATZ =
  /anmeld(?:ung|eschluss|efrist|en)[^\n]{0,80}?\bbis\b([^\n]{0,60})/iu

/** "Anmeldung bis 21. September in der Bibliothek" → the day. Forward inference for a bare day and month. */
export function anmeldefrist(text: string, heute: Heute): string | null {
  const treffer = FRIST_SATZ.exec(text.normalize('NFC'))
  if (treffer === null) return null
  return alleDaten(treffer[1] ?? '', heute)[0] ?? null
}

const PROGRAMM =
  /\banmeld\w*|\bkurs\w*|\blager\b|\bcamp\b|\bferienpass\b|\bteilnahmegeb[üu]hr|\bkosten\b|\bvoraussetzung\w*|\bprobe\w*|\bworkshop\w*|\bsemester\w*/iu
const OFFEN =
  /\bausstellung\w*|\beintritt frei\b|\böffentlich\w*|\bf[üu]hrung\w*|\böffnungszeiten\b|\bvernissage\b|\bfinissage\b|\bmuseum\b/iu

/**
 * Whether one can drop in on any day (an exhibition — its last day is a last
 * chance) or takes part over the whole span (a camp, a course — its end
 * concerns only the participants). The words decide; the text of a museum
 * that also asks for registration for a guided tour is read as open, because
 * the exhibition is what runs.
 */
export function erkenneZugang(text: string): Zugang {
  const t = text.normalize('NFC')
  const offen = OFFEN.test(t)
  const programm = PROGRAMM.test(t)
  if (offen && !programm) return 'offen'
  if (programm && !offen) return 'programm'
  if (offen && programm)
    return /\bausstellung\w*/iu.test(t) ? 'offen' : 'programm'
  return 'unbekannt'
}

export interface AnkerEingabe {
  titel: string
  termine: readonly string[]
  von: string
  bis: string | null
  spanne: boolean
  /** Teaser plus description — where the words are. */
  text: string
  kategorie: string | null
  teaser: string | null
  abgesagt: boolean
  serieSeit: string | null
  /** From the detail page, where it was read; otherwise inferred from the text. */
  zugang?: Zugang | null
  fristAm?: string | null
}

export interface Bekannt {
  /** No row of this source exists yet — everything is unknown, so nothing is "new". */
  erstlauf: boolean
  /** This series key already has a row. */
  bekannt: boolean
}

export interface AnkerBefund {
  anker: Anker
  /** The day the anchor hangs on: the date, the deadline, the last day. Null when every date is past. */
  ankerAm: string | null
  /** The code's reason, in words, for the row and the Sichtung. */
  grund: string
  hinweise: string[]
  rhythmus: RhythmusBefund
  zugang: Zugang
  fristAm: string | null
}

const datumDe = (iso: string): string => {
  const [j, m, t] = iso.split('-')
  return `${Number(t)}.${Number(m)}.${j}`
}

/**
 * The anchor of one Anlass on one day. The order of the branches is the rule
 * order above, and it is fixed on purpose: a cancelled waste collection is
 * still the Entsorgung desk's, a cancelled Gremium is an Ausfall before it is
 * a Gremium.
 */
export function berechneAnker(
  e: AnkerEingabe,
  heute: string,
  bekannt: Bekannt,
  heuteObj: Heute
): AnkerBefund {
  const rhythmus = erkenneRhythmus({
    termine: e.termine,
    text: e.text,
    spanne: e.spanne,
    serieSeit: e.serieSeit
  })
  const zugang = e.zugang ?? erkenneZugang(e.text)
  const fristAm = e.fristAm ?? anmeldefrist(e.text, heuteObj)
  const naechster = naechsterTermin(e.termine, heute)
  const hinweise: string[] = []
  const befund = (
    anker: Anker,
    ankerAm: string | null,
    grund: string
  ): AnkerBefund => ({
    anker,
    ankerAm,
    grund,
    hinweise,
    rhythmus,
    zugang,
    fristAm
  })

  if (istAbfuhr({ titel: e.titel, kategorie: e.kategorie, teaser: e.teaser }))
    return befund(
      'abfuhr',
      naechster,
      'Abfuhrtermin — gehört dem Entsorgungs-Tisch.'
    )
  if (istPlatzhalter(e.titel))
    return befund(
      'platzhalter',
      naechster,
      'Platzhalter im Kalender, kein Anlass.'
    )

  const ausfall = e.abgesagt
    ? (abgesagtOderVerschoben(e.text) ?? 'ausfall')
    : abgesagtOderVerschoben(e.text)
  if (ausfall !== null)
    return befund(
      ausfall,
      naechster ?? heute,
      ausfall === 'ausfall'
        ? 'Der Kalender sagt: abgesagt oder findet nicht statt.'
        : 'Der Kalender sagt: verschoben.'
    )

  if (istGremium(e.titel))
    return befund(
      'gremium',
      naechster,
      'Sitzung oder Urnengang — vorgeschlagen wegen der Traktanden.'
    )

  // A deadline counts only when it lies before the date it is for — a
  // "bis" the text reader found behind the event is some other deadline.
  if (
    fristAm !== null &&
    fristAm >= heute &&
    naechster !== null &&
    fristAm <= naechster
  )
    return befund(
      'frist',
      fristAm,
      `Anmeldung bis ${datumDe(fristAm)}, Termin am ${datumDe(naechster)}.`
    )
  if (fristAm !== null && fristAm < heute)
    hinweise.push(`Anmeldefrist ${datumDe(fristAm)} ist vorbei.`)

  const r = rhythmus.rhythmus
  const takt = rhythmus.ausText ? 'laut Text' : 'aus den Terminen'

  if (
    !bekannt.bekannt &&
    !bekannt.erstlauf &&
    (r === 'woechentlich' || r === 'monatlich' || r === 'laufend') &&
    e.von >= heute
  )
    return befund(
      'neu',
      e.von,
      `Neue Serie (${r}, ${takt}), erste Durchführung am ${datumDe(e.von)}.`
    )

  if (r === 'einmalig' || r === 'unbekannt')
    return befund('einmalig', naechster, 'Einmaliger Anlass.')

  if (r === 'laufend') {
    if (e.von >= heute)
      return befund('beginnt', e.von, `Beginnt am ${datumDe(e.von)}.`)
    if (e.bis !== null && e.bis >= heute) {
      const laenge = tage(e.von, e.bis)
      if (rhythmus.ganzjaehrig) {
        hinweise.push(
          `Kalender nennt ${datumDe(e.bis)} als Ende, der Text sagt «das ganze Jahr» — kein Anker.`
        )
        return befund('routine', null, 'Läuft ganzjährig laut Text.')
      }
      if (zugang !== 'offen') {
        hinweise.push(
          zugang === 'programm'
            ? 'Programm mit Teilnahme über die Dauer — das Ende ist keine letzte Gelegenheit.'
            : 'Zugang unklar — das Ende wird nicht als letzte Gelegenheit gemeldet.'
        )
        return befund('routine', null, `Läuft bis ${datumDe(e.bis)}.`)
      }
      if (laenge < ENDET_AB_TAGEN)
        return befund('routine', null, `Läuft nur ${laenge} Tage.`)
      return befund(
        'endet',
        e.bis,
        `Offen zugänglich seit ${datumDe(e.von)}, letzter Tag ${datumDe(e.bis)}.`
      )
    }
    return befund('routine', null, 'Laufend, ohne Ende im Fenster.')
  }

  if (rhythmus.abweichung !== null && rhythmus.abweichung >= heute)
    return befund(
      'abweichung',
      rhythmus.abweichung,
      `${r} ${takt}, der ${datumDe(rhythmus.abweichung)} fällt aus dem Muster.`
    )
  if (rhythmus.fehlend !== null && rhythmus.fehlend >= heute)
    return befund(
      'ausfall',
      rhythmus.fehlend,
      `${r} ${takt}, der erwartete ${datumDe(rhythmus.fehlend)} fehlt im Kalender.`
    )
  if (r === 'monatlich' || r === 'seltener')
    return befund(
      'erinnerung',
      naechster,
      `${r === 'monatlich' ? 'Monatlich' : 'Seltener als monatlich'} (${takt}), nächster Termin${naechster === null ? ' vorbei' : ` am ${datumDe(naechster)}`}.`
    )
  return befund('routine', null, `Wöchentlich ${takt} — Routine.`)
}

function tage(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000
  )
}

/** Inside the proposal window: from `tage` days before the anchor up to the anchor itself. */
export function imVorschlagsfenster(
  ankerAm: string | null,
  heute: string,
  tage = VORSCHLAGSFENSTER_TAGE
): boolean {
  if (ankerAm === null) return false
  return verschiebeTage(ankerAm, -tage) <= heute && heute <= ankerAm
}

export interface RoutineZeile {
  id: string
  zuletzt_vorgelegt_am: string | null
  dauerangebot: Dauerangebot | null
}

/**
 * Which routines come back as Dauerangebot today: never proposed, or proposed
 * longer than the interval ago; never the ones the editor set to "nie"; the
 * longest-waiting first, and only `max` of them — the rest is COUNTED, so the
 * run can say "9 Dauerangebote warten". On the first read of a calendar
 * every routine is a candidate; the dose is what spreads them over months.
 */
export function waehleDauerangebote(
  routinen: readonly RoutineZeile[],
  heute: string,
  max = DAUERANGEBOTE_JE_WOCHE
): { vorgelegt: string[]; warten: number } {
  const faellig = routinen
    .filter(
      (r) =>
        r.dauerangebot !== 'nie' &&
        (r.zuletzt_vorgelegt_am === null ||
          verschiebeTage(r.zuletzt_vorgelegt_am, DAUERANGEBOT_INTERVALL_TAGE) <=
            heute)
    )
    .sort((a, b) => {
      if (a.zuletzt_vorgelegt_am === null)
        return b.zuletzt_vorgelegt_am === null ? 0 : -1
      if (b.zuletzt_vorgelegt_am === null) return 1
      return a.zuletzt_vorgelegt_am.localeCompare(b.zuletzt_vorgelegt_am)
    })
  return {
    vorgelegt: faellig.slice(0, max).map((r) => r.id),
    warten: Math.max(0, faellig.length - max)
  }
}

/**
 * The editor's first verdict on a Dauerangebot sets its clock: taken over →
 * back in six months; rejected as "nicht relevant" → never again; any other
 * rejection only stamps the date (which the endpoint does anyway), so it does
 * not come back next week.
 */
export function dauerangebotNachEntscheid(
  entscheid: 'uebernommen' | 'abgelehnt' | 'weitergereicht',
  grund: string | null,
  heute: string
): { dauerangebot?: Dauerangebot; zuletzt_gemeldet_am?: string } {
  if (entscheid === 'uebernommen')
    return { dauerangebot: 'intervall', zuletzt_gemeldet_am: heute }
  if (entscheid === 'abgelehnt' && grund === 'nicht_relevant')
    return { dauerangebot: 'nie' }
  return {}
}
