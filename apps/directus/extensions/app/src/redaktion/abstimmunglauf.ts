import type {
  Abstimmungsart,
  Abstimmungsebene,
  Abstimmungszeile
} from '../shared/abstimmung'

// What the votes run decides, pure and testable without a database.
//
// Three rules live here, and the first one is the whole feature.
//
// **1. `counted` is the most important figure in the dataset, and it is not a
// figure.** While one row of a municipality still says no, that municipality
// has no result — not a provisional one, not an interim state to be phrased
// carefully. Nothing is written about it. The rows of a vote day exist on the
// portal DAYS in advance, all of them empty (measured 18 September 2026: the
// 27 September rows were there on the 18th, 430 of them, every one
// `counted: "False"`), so a run that did not check would write five articles
// about nothing at all.
//
// **2. Five Vorlagen are not five stories.** `vote_id` carries Initiative,
// Gegenvorschlag and Stichfrage together — that is measured and given, not a
// heuristic — and a reader who gets three notices about the Mehrwertabgabe
// reads none of them.
//
// **3. The Stichfrage is only a statement when both Vorlagen were accepted.**
// Otherwise it is a number without meaning: on 8 March 2026 both the Tempo-30
// initiative and its counter-proposal were rejected, and the Stichfrage still
// carries 1301 against 1665 votes. Code decides this, and the prompt states it
// as a fact rather than asking for it.

/** The canton's own figures for one part of a question, summed over all municipalities. */
export interface Kantonszahlen {
  ja: number
  nein: number
  prozentJa: number
  beteiligung: number | null
  stimmberechtigte: number
  leer: number
  ungueltig: number
  /** `angenommen`/`abgelehnt`, or for a Stichfrage the side that won. */
  antwort: string | null
  /** How many municipalities this sum covers. Complete, or it does not exist. */
  gemeinden: number
}

/** One part of a question — the Initiative, its Gegenvorschlag or the Stichfrage. */
export interface Vorlagenteil {
  art: Abstimmungsart
  titel: string
  url: string | null
  /** Null while one municipality of the canton is still counting. */
  kanton: Kantonszahlen | null
}

/** One question, as the newsroom writes about it: one article, one `vote_id`. */
export interface Vorlage {
  voteId: string
  datum: string
  ebene: Abstimmungsebene | null
  titel: string
  url: string | null
  teile: Vorlagenteil[]
}

const REIHENFOLGE: Readonly<Record<Abstimmungsart, number>> = {
  vorlage: 0,
  gegenvorschlag: 1,
  stichfrage: 2
}

function rundeAuf(wert: number, stellen: number): number {
  const faktor = 10 ** stellen
  return Math.round(wert * faktor) / faktor
}

/**
 * The canton's figures for one part — or nothing.
 *
 * **Complete or nothing, never a sample.** The sum is taken over every row
 * handed in, and a single uncounted municipality makes it null rather than
 * "the canton so far". A partial cantonal figure in an article is exactly the
 * "Kantonsschnitt aus 400 von 3'524 Zeilen" this house has already paid for.
 *
 * The arithmetic was verified on 18 September 2026 against dataset 10500, the
 * canton's own row for vote 20260614_E1: 49'114 / 62'177 / 44,131151665…
 * percent / 59,037150338… turnout / 192'865 eligible. The sum over the 86
 * municipality rows matches all five to thirteen decimals, which is why this
 * feed needs no second dataset.
 */
export function kantonsSumme(
  zeilen: readonly Abstimmungszeile[]
): Kantonszahlen | null {
  if (zeilen.length === 0) return null
  if (zeilen.some((zeile) => !zeile.ausgezaehlt)) return null

  let ja = 0
  let nein = 0
  let stimmberechtigte = 0
  let leer = 0
  let ungueltig = 0

  for (const zeile of zeilen) {
    if (zeile.ja === null || zeile.nein === null) return null
    ja += zeile.ja
    nein += zeile.nein
    stimmberechtigte += zeile.stimmberechtigte ?? 0
    leer += zeile.leer ?? 0
    ungueltig += zeile.ungueltig ?? 0
  }

  const abgegeben = ja + nein
  if (abgegeben === 0) return null

  const art = zeilen[0]?.art ?? 'vorlage'
  const prozentJa = (ja / abgegeben) * 100

  return {
    ja,
    nein,
    prozentJa,
    // Turnout the way the source computes it per municipality — every ballot
    // paper handed in, blank and invalid ones included, over the electorate.
    // Checked against the canton row to the tenth decimal.
    beteiligung:
      stimmberechtigte === 0
        ? null
        : ((abgegeben + leer + ungueltig) / stimmberechtigte) * 100,
    stimmberechtigte,
    leer,
    ungueltig,
    antwort: antwortAus(art, ja, nein),
    gemeinden: zeilen.length
  }
}

/**
 * Who won, in the vocabulary of the row's own kind.
 *
 * A Vorlage is accepted or rejected; a Stichfrage names a side, because its
 * `yeas` are votes for the Initiative and its `nays` votes for the
 * Gegenvorschlag. An exact tie is answered with null rather than a guess —
 * nothing in the data decides it.
 */
function antwortAus(
  art: Abstimmungsart,
  ja: number,
  nein: number
): string | null {
  if (ja === nein) return null
  if (art === 'stichfrage') return ja > nein ? 'initiative' : 'gegenvorschlag'
  return ja > nein ? 'angenommen' : 'abgelehnt'
}

/**
 * One question per `vote_id`, its parts in the order they stand on the ballot.
 *
 * The title and the address come from the Initiative itself: the three parts
 * carry three different addresses (measured on 27 September 2026 — `k3a`,
 * `k3b`, `k3c`), and the one an article links is the question's own.
 */
export function gruppiereNachVorlage(
  zeilen: readonly Abstimmungszeile[]
): Vorlage[] {
  const nachId = new Map<string, Abstimmungszeile[]>()
  for (const zeile of zeilen) {
    const bisher = nachId.get(zeile.voteId)
    if (bisher === undefined) nachId.set(zeile.voteId, [zeile])
    else bisher.push(zeile)
  }

  const vorlagen: Vorlage[] = []

  for (const [voteId, gruppe] of nachId) {
    const arten = [...new Set(gruppe.map((zeile) => zeile.art))].sort(
      (a, b) => REIHENFOLGE[a] - REIHENFOLGE[b]
    )

    const teile: Vorlagenteil[] = arten.map((art) => {
      const zeilenDerArt = gruppe.filter((zeile) => zeile.art === art)
      const erste = zeilenDerArt[0]
      return {
        art,
        titel: erste?.titel ?? '',
        url: erste?.url ?? null,
        kanton: kantonsSumme(zeilenDerArt)
      }
    })

    const fuehrend = teile.find((teil) => teil.art === 'vorlage') ?? teile[0]
    const erste = gruppe[0]

    vorlagen.push({
      voteId,
      datum: erste?.datum ?? '',
      ebene: erste?.ebene ?? null,
      titel: fuehrend?.titel ?? '',
      url: fuehrend?.url ?? null,
      teile
    })
  }

  return vorlagen.sort((a, b) => a.voteId.localeCompare(b.voteId))
}

/** How far one municipality has got on this vote day. */
export interface Gemeindestand {
  bfs: string
  gemeinde: string
  /** Every row of this municipality on this day is counted. */
  ausgezaehlt: boolean
  zeilen: number
  offen: number
}

/**
 * The counting state per municipality, over the WHOLE day rather than per
 * question.
 *
 * That is the rule as the newsroom stated it: nothing is written while one row
 * of this municipality on this date is still open. A municipality reports its
 * ballot as a whole, and an article about one of five questions written while
 * the other four are still being counted would be a scoop over an empty table.
 */
export function gemeindeStand(
  zeilen: readonly Abstimmungszeile[]
): Gemeindestand[] {
  const nachGemeinde = new Map<string, Gemeindestand>()

  for (const zeile of zeilen) {
    const bisher = nachGemeinde.get(zeile.bfs)
    if (bisher === undefined) {
      nachGemeinde.set(zeile.bfs, {
        bfs: zeile.bfs,
        gemeinde: zeile.gemeinde,
        ausgezaehlt: zeile.ausgezaehlt,
        zeilen: 1,
        offen: zeile.ausgezaehlt ? 0 : 1
      })
      continue
    }
    bisher.zeilen += 1
    if (!zeile.ausgezaehlt) {
      bisher.offen += 1
      bisher.ausgezaehlt = false
    }
  }

  return [...nachGemeinde.values()].sort((a, b) => a.bfs.localeCompare(b.bfs))
}

export interface Laufbilanz {
  ausgezaehlt: number
  offen: number
  /** German, for the run's result. Counting is not an error and must not read like one. */
  satz: string
}

/**
 * What the run says when it wrote nothing.
 *
 * A Sunday afternoon run that finds a canton in the middle of counting has
 * done its job perfectly. The result has to say so in words, or the next
 * person to read the log goes looking for a fault that is not there.
 */
export function laufBilanz(
  datum: string,
  stand: readonly Gemeindestand[]
): Laufbilanz {
  const ausgezaehlt = stand.filter((g) => g.ausgezaehlt).length
  const offen = stand.length - ausgezaehlt

  return {
    ausgezaehlt,
    offen,
    satz:
      offen === 0
        ? `Abstimmung vom ${datum}: alle ${stand.length} Gemeinden ausgezaehlt.`
        : `Abstimmung vom ${datum}: ${ausgezaehlt} von ${stand.length} Gemeinden ausgezaehlt, ${offen} zaehlen noch. Es wird nichts geschrieben, solange eine Zeile einer Gemeinde offen ist.`
  }
}

/** Whether the Stichfrage says anything at all — and, when it does not, why. */
export interface Stichfragenurteil {
  gilt: boolean
  grund: string
}

/**
 * The Stichfrage decides only when both Vorlagen were accepted.
 *
 * And «accepted» means by the CANTON: these are cantonal ballots, the canton
 * is the body whose yes counts, and a municipality's own yes decides nothing.
 * So the judgement needs the cantonal figures, which exist only once every
 * municipality is counted — until then the honest answer is that it cannot be
 * judged yet, not that it does not apply.
 */
export function stichfrageGilt(
  teile: readonly {
    art: Abstimmungsart
    kanton: Pick<Kantonszahlen, 'antwort'> | null
  }[]
): Stichfragenurteil {
  const vorlage = teile.find((teil) => teil.art === 'vorlage')
  const gegenvorschlag = teile.find((teil) => teil.art === 'gegenvorschlag')

  if (vorlage === undefined || gegenvorschlag === undefined) {
    return {
      gilt: false,
      grund:
        'Zu dieser Frage gibt es keinen Gegenvorschlag; eine Stichfrage entscheidet nichts.'
    }
  }

  if (vorlage.kanton === null || gegenvorschlag.kanton === null) {
    return {
      gilt: false,
      grund:
        'Der Kanton ist noch nicht fertig ausgezaehlt; ob die Stichfrage etwas entscheidet, steht noch nicht fest.'
    }
  }

  const beide =
    vorlage.kanton.antwort === 'angenommen' &&
    gegenvorschlag.kanton.antwort === 'angenommen'

  return beide
    ? {
        gilt: true,
        grund:
          'Der Kanton hat Initiative und Gegenvorschlag angenommen; die Stichfrage entscheidet.'
      }
    : {
        gilt: false,
        grund:
          'Der Kanton hat nicht beide Vorlagen angenommen; die Stichfrage entscheidet nichts und ihre Zahlen sagen nichts.'
      }
}

/** One municipality's own result for every part of one question. */
export interface Gemeindeergebnis {
  art: Abstimmungsart
  antwort: string | null
  ja: number | null
  nein: number | null
  prozentJa: number | null
  beteiligung: number | null
  stimmberechtigte: number | null
  leer: number | null
  ungueltig: number | null
}

export interface Gemeindezahlen {
  bfs: string
  gemeinde: string
  /** Every row of this municipality on this DAY — the rule from `gemeindeStand`. */
  ausgezaehlt: boolean
  ergebnisse: Gemeindeergebnis[]
}

/**
 * The newsroom's own municipalities, with their rows of this question.
 *
 * The other 76 are summed into the cantonal figure and stored nowhere else:
 * they are the comparison, not the subject. A municipality the newsroom covers
 * but the dataset does not know — Riehen belongs to Basel-Stadt — keeps its
 * row with no figures at all, so the gap is visible instead of silent.
 */
export function gemeindezahlen(
  vorlage: Vorlage,
  alleZeilen: readonly Abstimmungszeile[],
  gemeinden: readonly { bfs: string; name: string }[]
): Gemeindezahlen[] {
  const stand = new Map(gemeindeStand(alleZeilen).map((g) => [g.bfs, g]))

  return gemeinden.map((gemeinde) => {
    const eigene = alleZeilen.filter(
      (zeile) => zeile.bfs === gemeinde.bfs && zeile.voteId === vorlage.voteId
    )

    return {
      bfs: gemeinde.bfs,
      gemeinde: gemeinde.name,
      ausgezaehlt: stand.get(gemeinde.bfs)?.ausgezaehlt ?? false,
      ergebnisse: [...eigene]
        .sort((a, b) => REIHENFOLGE[a.art] - REIHENFOLGE[b.art])
        .map((zeile) => ({
          art: zeile.art,
          antwort: zeile.antwort,
          ja: zeile.ja,
          nein: zeile.nein,
          prozentJa:
            zeile.prozentJa === null ? null : rundeAuf(zeile.prozentJa, 1),
          beteiligung:
            zeile.beteiligung === null ? null : rundeAuf(zeile.beteiligung, 1),
          stimmberechtigte: zeile.stimmberechtigte,
          leer: zeile.leer,
          ungueltig: zeile.ungueltig
        }))
    }
  })
}

/** The previous ballot, as far as an article may name it. */
export interface Vergleich {
  datum: string
  gemeinden: { bfs: string; beteiligung: number }[]
}

/**
 * «Das letzte vergleichbare Mal», as one figure that actually compares.
 *
 * Yes-shares of different questions do not compare — the Neutralitätsinitiative
 * says nothing about the Mehrwertabgabe — but the TURNOUT does, and it is the
 * figure a local article reaches for anyway. The highest turnout of that day is
 * taken, because that is the question that brought people to the ballot box.
 */
export function vergleichAus(
  datum: string | null,
  zeilen: readonly Abstimmungszeile[],
  bfsNummern: readonly string[]
): Vergleich | null {
  if (datum === null) return null

  const gemeinden: { bfs: string; beteiligung: number }[] = []

  for (const bfs of bfsNummern) {
    const werte = zeilen
      .filter((zeile) => zeile.bfs === bfs && zeile.beteiligung !== null)
      .map((zeile) => zeile.beteiligung as number)
    if (werte.length === 0) continue
    gemeinden.push({ bfs, beteiligung: rundeAuf(Math.max(...werte), 1) })
  }

  return gemeinden.length === 0 ? null : { datum, gemeinden }
}

/** Everything the row of one Vorlage carries, built in one place. */
export interface Zeilenbau {
  vorlage: Vorlage
  /** Every row of the vote DAY — the counting state is a property of the day. */
  alleZeilen: readonly Abstimmungszeile[]
  gemeinden: readonly { bfs: string; name: string }[]
  stand: string
  hinweise: readonly string[]
  vergleich?: Vergleich | null
}

/**
 * One pure mapping from the read rows to the stored row.
 *
 * The run is wiring around this: what a row says about counting, about the
 * canton and about the Stichfrage is decided here, once, and the same function
 * answers for a Sunday at one o'clock and for the Monday after.
 */
export function zeilenfelder(bau: Zeilenbau): Record<string, unknown> {
  const stand = gemeindeStand(bau.alleZeilen)
  const urteil = stichfrageGilt(bau.vorlage.teile)

  const felder: Record<string, unknown> = {
    vote_id: bau.vorlage.voteId,
    datum: bau.vorlage.datum,
    titel: bau.vorlage.titel,
    ebene: bau.vorlage.ebene,
    teile: bau.vorlage.teile,
    gemeindezahlen: gemeindezahlen(bau.vorlage, bau.alleZeilen, bau.gemeinden),
    gemeinden_total: stand.length,
    gemeinden_ausgezaehlt: stand.filter((g) => g.ausgezaehlt).length,
    ausgezaehlt: stand.length > 0 && stand.every((g) => g.ausgezaehlt),
    stichfrage_gilt: urteil.gilt,
    stichfrage_grund: urteil.grund,
    quelle_url: bau.vorlage.url,
    stand: bau.stand,
    hinweise: [...bau.hinweise]
  }

  // The comparison is fetched once per vote day and never re-asked: an earlier
  // ballot's turnout cannot change. Left out means "not asked yet", never
  // "none" — so it is only written when there is something to write.
  if (bau.vergleich !== undefined && bau.vergleich !== null) {
    felder['vergleich'] = bau.vergleich
  }

  return felder
}
