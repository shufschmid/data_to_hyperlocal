// robots.txt, read and honoured.
//
// The municipal pages are public and server-rendered, and nothing here is
// crawled — only the news page an editor registered and the pages it links.
// The file still gets a say: one host asks for a ten-second spacing, another
// disallows the path its own RSS feed lives on. We read the file once per host
// and run, apply the rules that name us (or `*`), and treat an unreachable
// file as "not today". A small RFC 9309 subset, pure and tested against the
// real files.

export interface RobotsGruppe {
  agents: string[]
  allow: string[]
  disallow: string[]
  crawlDelay: number | null
}

export interface RobotsRegeln {
  gruppen: RobotsGruppe[]
}

/** The product token `buildUserAgent` emits — the name a robots.txt could address us by. */
export const UA_TOKEN = 'DieRedaktion'

function neueGruppe(): RobotsGruppe {
  return { agents: [], allow: [], disallow: [], crawlDelay: null }
}

/**
 * Lines `key: value`; keys case-insensitive; `#` starts a comment; a line
 * without a colon is ignored (one registered host ends its file with a bare
 * `Disallow`). Consecutive `User-agent` lines share one group.
 */
export function parseRobots(text: string): RobotsRegeln {
  const gruppen: RobotsGruppe[] = []
  let aktuelle: RobotsGruppe | null = null
  let letzteWarAgent = false

  for (const roh of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const zeile = roh.replace(/#.*$/, '').trim()
    if (zeile === '') continue
    const doppelpunkt = zeile.indexOf(':')
    if (doppelpunkt === -1) continue
    const key = zeile.slice(0, doppelpunkt).trim().toLowerCase()
    const wert = zeile.slice(doppelpunkt + 1).trim()

    if (key === 'user-agent') {
      if (!letzteWarAgent || aktuelle === null) {
        aktuelle = neueGruppe()
        gruppen.push(aktuelle)
      }
      aktuelle.agents.push(wert.toLowerCase())
      letzteWarAgent = true
      continue
    }

    letzteWarAgent = false
    if (aktuelle === null) continue
    if (key === 'allow') {
      if (wert !== '') aktuelle.allow.push(wert)
    } else if (key === 'disallow') {
      if (wert !== '') aktuelle.disallow.push(wert)
    } else if (key === 'crawl-delay') {
      const sekunden = Number(wert.replace(',', '.'))
      if (Number.isFinite(sekunden) && sekunden >= 0)
        aktuelle.crawlDelay = sekunden
    }
  }

  return { gruppen }
}

function vereinigt(gruppen: RobotsGruppe[]): RobotsGruppe {
  const ganz = neueGruppe()
  for (const g of gruppen) {
    ganz.agents.push(...g.agents)
    ganz.allow.push(...g.allow)
    ganz.disallow.push(...g.disallow)
    if (g.crawlDelay !== null)
      ganz.crawlDelay = Math.max(ganz.crawlDelay ?? 0, g.crawlDelay)
  }
  return ganz
}

/**
 * The rules that apply to us: every group naming our token, else every group
 * naming `*`, else none at all.
 */
export function gruppeFuer(
  regeln: RobotsRegeln,
  token = UA_TOKEN
): RobotsGruppe | null {
  const klein = token.toLowerCase()
  const eigene = regeln.gruppen.filter((g) => g.agents.includes(klein))
  if (eigene.length > 0) return vereinigt(eigene)
  const alle = regeln.gruppen.filter((g) => g.agents.includes('*'))
  if (alle.length > 0) return vereinigt(alle)
  return null
}

function musterZuRegex(muster: string): RegExp {
  const anker = muster.endsWith('$')
  const kern = anker ? muster.slice(0, -1) : muster
  const escaped = kern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}${anker ? '$' : ''}`)
}

/**
 * Longest-match semantics: the most specific Allow or Disallow that matches
 * decides; on a tie, Allow wins. No group for us means no restriction.
 */
export function darfLesen(
  regeln: RobotsRegeln,
  pfadMitQuery: string,
  token = UA_TOKEN
): boolean {
  const gruppe = gruppeFuer(regeln, token)
  if (gruppe === null) return true

  let bestesAllow = -1
  let bestesDisallow = -1
  for (const muster of gruppe.allow) {
    if (musterZuRegex(muster).test(pfadMitQuery))
      bestesAllow = Math.max(bestesAllow, muster.length)
  }
  for (const muster of gruppe.disallow) {
    if (musterZuRegex(muster).test(pfadMitQuery))
      bestesDisallow = Math.max(bestesDisallow, muster.length)
  }
  if (bestesDisallow === -1) return true
  return bestesAllow >= bestesDisallow
}

/** The host's requested spacing in seconds, or null when it asks for none. */
export function crawlDelaySekunden(
  regeln: RobotsRegeln,
  token = UA_TOKEN
): number | null {
  return gruppeFuer(regeln, token)?.crawlDelay ?? null
}
