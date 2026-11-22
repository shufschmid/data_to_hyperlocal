// Der Eingangskorb des Tischs «data to hyperlocal».
//
// Bis zum 22. November 2026 war dieser Tisch eine Zeitleiste: alles, was die
// fuenf Zufluesse melden, in einer Liste nach Datum. Gemessen an jenem Tag
// standen zuoberst vier Abstimmungstermine bis Oktober 2027, darunter in einer
// Folge Agenda-Eintraege, Portal-Zweige («geaendert», ohne Knopf) und sechs
// Suedanflug-Monate mit offenen Knoepfen — Neues, Angefangenes und Erledigtes
// durcheinander. Die Redaktion: ich will wissen, da ist ein neuer Datensatz,
// und dann etwas daraus machen oder ihn vergessen; was publiziert ist, gehoert
// nach unten; Abstimmungstermine braucht es so weit voraus nicht.
//
// Darum sortiert der Tisch jetzt nach dem, was zu TUN ist, nicht nach dem
// Datum. Dieselben Eintraege (`zeitleiste()` baut sie weiterhin), sechs Faecher:
//
//   neu              ohne Entscheid, hoechstens vierzehn Tage alt — die Arbeit
//   inArbeit         Meldungen sind geschrieben und noch nicht alle draussen
//   demnaechst       was erst kommt: ein Abstimmungssonntag der naechsten
//                    Woche, ein Agenda-Eintrag mit Termin in der Zukunft
//   liegenGeblieben  aelter als vierzehn Tage und nie entschieden, oder ein
//                    Lauf, dessen Entwuerfe seit vierzehn Tagen niemand anfasst
//   erledigt         alles publiziert oder verworfen, oder abgelegt
//   suedanflugVerlauf  die frueheren Monate der Suedanflug-Quote ohne Meldung
//
// Nichts wird geloescht und kein Status aendert sich: die Faecher sind eine
// Ansicht, und jede Zeile behaelt in jedem Fach ihre Knoepfe. Pur, damit die
// Regel pruefbar ist.

import { ARCHIV_TAGE } from './archiv'
import { istAbgelegt, type ZeitleistenEintrag } from './redaktion'

/** So lange gilt ein Eintrag als neu, ein Lauf als in Arbeit und Erledigtes als frisch. */
export const EINGANG_TAGE = ARCHIV_TAGE

/** Was der Korb von einer Meldung wissen muss. */
export interface KorbMeldung {
  status: string
  publiziert_am: string | null
  date_created: string | null
}

export interface KorbQuellen<M extends KorbMeldung = KorbMeldung> {
  /** Alle datierten Eintraege der Zeitleiste — ungekappt. */
  datiert: readonly ZeitleistenEintrag[]
  /** Angekuendigt, noch ohne Termin. */
  ohneDatum: readonly ZeitleistenEintrag[]
  zuLauf?: ReadonlyMap<string, readonly M[]>
  zuSuedanflug?: ReadonlyMap<string, readonly M[]>
  zuAbstimmung?: ReadonlyMap<string, readonly M[]>
  /** JJJJ-MM-TT. */
  heute: string
}

export interface Eingangskorb {
  neu: ZeitleistenEintrag[]
  inArbeit: ZeitleistenEintrag[]
  demnaechst: ZeitleistenEintrag[]
  ohneTermin: ZeitleistenEintrag[]
  liegenGeblieben: ZeitleistenEintrag[]
  /** Erledigt in den letzten vierzehn Tagen, das Neueste zuerst. */
  erledigt: ZeitleistenEintrag[]
  /** Frueher erledigt — auf Verlangen. */
  erledigtAelter: ZeitleistenEintrag[]
  suedanflugVerlauf: ZeitleistenEintrag[]
  /** Was auf der Zeile dazu steht: «3 von 10 offen», «abgelegt», «ohne Entscheid». */
  anmerkungen: Map<string, string>
}

function tag(wert: string | null | undefined): string | null {
  return wert == null || wert === '' ? null : wert.slice(0, 10)
}

function tageSeit(von: string | null, heute: string): number | null {
  if (von === null) return null
  const ms = Date.parse(`${heute}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)
  return Number.isNaN(ms) ? null : Math.floor(ms / 86_400_000)
}

/** Aelter als das Fenster. Ein unbekanntes Alter versteckt nie — die Regel von `lib/archiv.ts`. */
function zuAlt(von: string | null, heute: string): boolean {
  const alter = tageSeit(von, heute)
  return alter !== null && alter > EINGANG_TAGE
}

/** Die Meldungen, die an diesem Eintrag haengen — ueber Lauf, Monatsblatt oder Abstimmungstag. */
export function meldungenZu<M extends KorbMeldung>(
  eintrag: ZeitleistenEintrag,
  quellen: Pick<KorbQuellen<M>, 'zuLauf' | 'zuSuedanflug' | 'zuAbstimmung'>
): readonly M[] {
  if (eintrag.herkunft === 'suedanflug')
    return eintrag.quoteId === null ? [] : (quellen.zuSuedanflug?.get(eintrag.quoteId) ?? [])
  if (eintrag.herkunft === 'abstimmung')
    return eintrag.abstimmungIds.flatMap((id) => quellen.zuAbstimmung?.get(id) ?? [])
  if (eintrag.laufId !== null) return quellen.zuLauf?.get(eintrag.laufId) ?? []
  return []
}

const FERTIG = new Set(['publiziert', 'verworfen'])

/** Der juengste Tag, an dem an diesen Meldungen etwas geschah — geschrieben oder publiziert. */
function letzteBewegung(meldungen: readonly KorbMeldung[]): string | null {
  let juengster: string | null = null
  for (const m of meldungen) {
    for (const wert of [tag(m.publiziert_am), tag(m.date_created)]) {
      if (wert !== null && (juengster === null || wert > juengster)) juengster = wert
    }
  }
  return juengster
}

function datumKurz(iso: string): string {
  const [, m, t] = iso.split('-')
  return `${Number(t)}.${Number(m)}.`
}

export function eingangskorb<M extends KorbMeldung>(quellen: KorbQuellen<M>): Eingangskorb {
  const { heute } = quellen
  const korb: Eingangskorb = {
    neu: [],
    inArbeit: [],
    demnaechst: [],
    ohneTermin: [...quellen.ohneDatum],
    liegenGeblieben: [],
    erledigt: [],
    erledigtAelter: [],
    suedanflugVerlauf: [],
    anmerkungen: new Map()
  }
  /** Wann ein erledigter Eintrag erledigt wurde — danach wird er sortiert und gefenstert. */
  const erledigtAm = new Map<string, string | null>()

  // Nur der NEUESTE Monat der Suedanflug-Quote kann neu sein: das Blatt kommt
  // einmal im Monat, und die 45 davor sind Verlauf, kein Eingang.
  const neuesterMonat =
    quellen.datiert
      .filter((e) => e.herkunft === 'suedanflug')
      .reduce<ZeitleistenEintrag | null>(
        (bisher, e) => (bisher === null || (e.datum ?? '') > (bisher.datum ?? '') ? e : bisher),
        null
      )?.id ?? null

  for (const eintrag of quellen.datiert) {
    const datum = tag(eintrag.datum)

    // Was erst kommt. Die Zeitleiste reicht einen Abstimmungstermin nur noch
    // in der Woche davor herein; ein Agenda-Eintrag mit Termin wartet hier.
    if (eintrag.herkunft === 'abstimmungstermin' || (datum !== null && datum > heute)) {
      korb.demnaechst.push(eintrag)
      continue
    }

    const meldungen = meldungenZu(eintrag, quellen)
    const mitLauf = eintrag.laufId !== null

    if (meldungen.length > 0 || mitLauf) {
      const offen = meldungen.filter((m) => !FERTIG.has(m.status)).length
      if (meldungen.length > 0 && offen === 0) {
        erledigtAm.set(eintrag.id, letzteBewegung(meldungen) ?? datum)
        const draussen = meldungen.filter((m) => m.status === 'publiziert').length
        korb.anmerkungen.set(
          eintrag.id,
          draussen === 0 ? 'alle verworfen' : `${draussen} von ${meldungen.length} publiziert`
        )
        continue
      }
      // Ein Lauf ohne Meldungen schreibt gerade; sein Alter ist das des Eintrags.
      const bewegung = letzteBewegung(meldungen) ?? datum
      if (zuAlt(bewegung, heute)) {
        korb.liegenGeblieben.push(eintrag)
        korb.anmerkungen.set(
          eintrag.id,
          `${offen} von ${meldungen.length} offen` +
            (bewegung === null ? '' : ` · seit ${datumKurz(bewegung)} unberührt`)
        )
      } else {
        korb.inArbeit.push(eintrag)
        korb.anmerkungen.set(
          eintrag.id,
          meldungen.length === 0 ? 'wird geschrieben' : `${offen} von ${meldungen.length} offen`
        )
      }
      continue
    }

    if (istAbgelegt(eintrag)) {
      erledigtAm.set(eintrag.id, tag(eintrag.abgelegtAm) ?? datum)
      korb.anmerkungen.set(eintrag.id, 'abgelegt')
      continue
    }

    if (eintrag.herkunft === 'suedanflug' && eintrag.id !== neuesterMonat) {
      korb.suedanflugVerlauf.push(eintrag)
      continue
    }

    if (zuAlt(datum, heute)) {
      korb.liegenGeblieben.push(eintrag)
      korb.anmerkungen.set(eintrag.id, 'ohne Entscheid')
      continue
    }

    korb.neu.push(eintrag)
  }

  // Erledigtes: das Neueste zuerst, und nur vierzehn Tage lang auf einen Blick.
  const nachErledigung = quellen.datiert
    .filter((e) => erledigtAm.has(e.id))
    .sort((a, b) => (erledigtAm.get(b.id) ?? '').localeCompare(erledigtAm.get(a.id) ?? ''))
  for (const eintrag of nachErledigung) {
    ;(zuAlt(erledigtAm.get(eintrag.id) ?? null, heute) ? korb.erledigtAelter : korb.erledigt).push(eintrag)
  }

  // Was kommt, in der Reihenfolge, in der es kommt.
  korb.demnaechst.sort((a, b) => (a.datum ?? '').localeCompare(b.datum ?? ''))
  return korb
}
