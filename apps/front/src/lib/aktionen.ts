// Which editorial actions the proxy forwards, as shapes rather than a
// pass-through. Without an allowlist the route would hand any path a caller
// invented straight to Directus, as the signed-in user.
//
// A module of its own, and not a constant beside the handler, for one measured
// reason: the handler imports `next/server`, so a test that reaches the list
// through it never runs. Pure here, tested in `aktionen.test.ts` against the
// paths the workspace actually calls.
//
// **An allowlist that nothing checks is a trap, and it sprang twice on 18
// September 2026.** A new button was wired to `amtsblatt/:id/vorgeschichte`
// and a new form to `gemeinden/:id/veranstaltungen-url`, both shipped, and
// both answered «Unbekannte Aktion» in production — the endpoints existed, the
// callers existed, only this list did not know them. Nothing failed at build
// time, because a string a component builds and a regex in this file have no
// connection a compiler can see. The test is that connection.

/** Actions the workspace may POST. */
export const ERLAUBT: RegExp[] = [
  /^tabellen$/i,
  /^spielberichte$/i,
  /^spielberichte\/publizieren$/i,
  /^ankuendigungen$/i,
  /^datensaetze\/[0-9a-f-]{36}\/lauf$/i,
  /^laeufe\/[0-9a-f-]{36}\/(chat|publizieren|pruefung|verwerfen)$/i,
  /^meldungen\/[0-9a-f-]{36}\/(chat|publizieren|pruefung|verwerfen|freigeben)$/i,
  /^entsorgung\/kalender$/i,
  /^entsorgung\/kalender\/[0-9a-f-]{36}\/(extrahieren|pruefen|meldungen|freigeben)$/i,
  /^quellen\/lauf$/i,
  /^gemeinden$/i,
  /^gemeinden\/[0-9a-f-]{36}\/plz$/i,
  /^gemeinden\/[0-9a-f-]{36}\/news-url$/i,
  /^gemeindeseiten\/pruefen$/i,
  /^gemeindeseiten\/publizieren$/i,
  /^gemeindeseiten\/[0-9a-f-]{36}\/(meldung|ablehnen|weiterreichen)$/i,
  // Die Anlaesse und ihre Kalender. `dauerangebot` ist der Schalter auf einer
  // Routine; die Kalenderpflege laeuft als POST-Verben, weil der Proxy nur
  // GET und POST weiterleitet.
  /^veranstaltungen\/[0-9a-f-]{36}\/(meldung|ablehnen|weiterreichen|dauerangebot)$/i,
  /^veranstaltungsquellen$/i,
  /^veranstaltungsquellen\/[0-9a-f-]{36}(\/loeschen)?$/i,
  // Die Suedanflug-Quote: eine Meldung je betroffener Gemeinde, die im Koerper
  // steht. Ein Monatsblatt, mehrere Meldungen.
  /^suedanflug\/[0-9a-f-]{36}\/meldung$/i,
  /^abstimmungen\/pruefen$/i,
  /^abstimmungen\/[0-9a-f-]{36}\/meldung$/i,
  /^vereine$/i,
  /^vereine\/[0-9a-f-]{36}$/i,
  /^wochenblaetter$/i,
  /^wochenblaetter\/[0-9a-f-]{36}\/gemeinden$/i,
  /^wochenblaetter\/pruefen$/i,
  /^ausgaben\/[0-9a-f-]{36}\/inventar$/i,
  /^kandidaten\/[0-9a-f-]{36}\/(meldung|ablehnen|gemeinde|weiterreichen|perle)$/i,
  /^hinweise\/[0-9a-f-]{36}\/(bewerten|zurueck)$/i,
  /^wissen$/i,
  /^sendungen\/[0-9a-f-]{36}\/(meldung|ablehnen|weiterreichen)$/i,
  /^amtsblatt\/pruefen$/i,
  /^amtsblatt\/[0-9a-f-]{36}\/(meldung|ablehnen|weiterreichen|unterlagen|vorgeschichte)$/i
]

// Die zwei Laeufe und die Bilanz: der Zustand eines von Hand gestarteten Laufs
// lebt im Prozess der Erweiterung, und die Bilanz ist eine Rechnung ueber alle
// Tische. Alles andere, was der Arbeitsplatz liest, geht ueber GraphQL.
export const LESBAR: RegExp[] = [/^quellen\/lauf$/i, /^gemeindeseiten\/lauf$/i, /^bilanz$/i]

export function darfSchreiben(ziel: string): boolean {
  return ERLAUBT.some((muster) => muster.test(ziel))
}

export function darfLesen(ziel: string): boolean {
  return LESBAR.some((muster) => muster.test(ziel))
}
