// Where an article's figures actually come from — as an address a reader can open.
//
// The rule the newsroom asked for: the office's web article when the agenda
// links one, otherwise the concrete data file. Never the bare host.
//
// This has to be built HERE and not by the model, and the reason is on record:
// asked for a source link without being given one, the model produced
// `<a href="https://www.statistik.bl.ch">…</a>` — plausible, generic, and not
// the source of anything. A link is a claim about where something can be
// verified, so it is arithmetic the model must not do. Same division of labour
// as the press review: the prompt asks for the sentence, the code owns the URL.

/** What a reader is sent to, and how the sentence should name it. */
export interface Quellenlink {
  url: string
  /** The name to use in the running text — the office, not the portal. */
  bezeichnung: string
  /** True when this is the office's own article rather than the data file. */
  webartikel: boolean
}

export const AMT = 'Statistisches Amt Basel-Landschaft'

/** The office's own article pages live under baselland.ch, not the portals. */
function istWebartikelAdresse(link: string | null): boolean {
  if (link === null) return false
  try {
    const host = new URL(link).host.toLowerCase()
    return host === 'baselland.ch' || host.endsWith('.baselland.ch')
  } catch {
    return false
  }
}

export interface QuellenEingabe {
  /** `ankuendigungen.link` of the agenda entry this dataset belongs to. */
  ankuendigungLink: string | null
  /** `quellen.typ`: `ods`, `statbl`, … */
  quelleTyp: string | null
  /** `datensaetze.externe_id` — the dataset id on the portal. */
  externeId: string | null
}

/**
 * The address to put in the article, or null when we cannot name one honestly.
 *
 * Null is a real answer: better no link than a made-up one, and the check below
 * then simply asks for no link at all.
 */
export function quellenlink(eingabe: QuellenEingabe): Quellenlink | null {
  if (istWebartikelAdresse(eingabe.ankuendigungLink)) {
    return {
      url: eingabe.ankuendigungLink as string,
      bezeichnung: AMT,
      webartikel: true
    }
  }

  const id = (eingabe.externeId ?? '').trim()
  if (id === '') return null

  // Verified against the live portals: both shapes answer 200 for a real id.
  if (eingabe.quelleTyp === 'ods') {
    return {
      url: `https://data.bl.ch/explore/dataset/${encodeURIComponent(id)}/`,
      bezeichnung: AMT,
      webartikel: false
    }
  }
  if (eingabe.quelleTyp === 'statbl') {
    return {
      url: `https://statistik.bl.ch/web_portal/${encodeURIComponent(id)}`,
      bezeichnung: AMT,
      webartikel: false
    }
  }

  return null
}

const ANKER = /<a\s+href=(?:"([^"]*)"|'([^']*)')\s*>([\s\S]*?)<\/a>/gi
const ADRESSE = /https?:\/\/[^\s"'<>)]+/gi

/**
 * What is wrong with the article's source link, in one sentence — or null.
 *
 * Two failures matter and they are different: no link at all, and a link that
 * points somewhere we never named. The second is the dangerous one, because it
 * looks right.
 */
export function quellenlinkWarnung(
  text: string,
  link: Quellenlink | null
): string | null {
  const adressen = [...text.matchAll(ADRESSE)].map((t) => t[0])

  if (link === null) {
    return adressen.length === 0
      ? null
      : `Der Text verlinkt ${adressen[0]}, obwohl fuer diesen Datensatz keine Quelladresse bekannt ist.`
  }

  const anker = [...text.matchAll(ANKER)].map((t) => t[1] ?? t[2] ?? '')
  if (anker.length === 0) {
    return `Es fehlt der Quellen-Link. Der Text muss die Quelle genau einmal als <a href="${link.url}">…</a> verlinken.`
  }

  const fremd = anker.find((a) => a !== link.url)
  if (fremd !== undefined) {
    return `Der Quellen-Link zeigt auf ${fremd} statt auf ${link.url}. Nur diese eine Adresse ist belegt.`
  }

  const andere = adressen.filter((a) => a !== link.url)
  if (andere.length > 0) {
    return `Der Text nennt zusaetzlich ${andere[0]}. Ausser der Quelle gehoert keine Adresse in die Meldung.`
  }

  return null
}

/**
 * Forces every anchor onto the address we actually know.
 *
 * The last line of defence, after the prompt and the one retry: a wrong URL is
 * the one error a reader cannot see and cannot check, so it never ships. The
 * anchor TEXT is left as the model wrote it — that is prose, and the retry has
 * already had its say about it.
 */
export function repariereQuellenlink(
  text: string,
  link: Quellenlink | null
): string {
  if (link === null) return text
  return text.replace(ANKER, (_treffer, doppelt, einfach, inhalt: string) => {
    void doppelt
    void einfach
    return `<a href="${link.url}">${inhalt}</a>`
  })
}
