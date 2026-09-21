// Einen maschinell geschriebenen Entwurf zurueckziehen, wenn die Redaktion
// seine Zeile ablehnt.
//
// Seit dem 21. September 2026 schreibt der Gemeindeseiten-Lauf die Meldung zu
// jedem Vorschlag von sich aus, damit nur noch „publizieren" zu klicken ist.
// Damit steht auf der Zeile, die abgelehnt wird, meistens schon ein Artikel —
// und ein Artikel ueber etwas, das die Redaktion nicht bringen will, hat auf
// keinem Tisch etwas verloren.
//
// **Nur der ENTWURF.** Was schon publiziert ist, wird hier nicht
// zurueckgezogen (das ist eine eigene, bewusste Handlung), und was in der
// Gegenpruefung liegt, gehoert fuer den Moment der gegenlesenden Person.
// Beides der Redaktion unter den Haenden wegzunehmen, waere schlimmer als ein
// Entwurf zu viel.

interface MeldungsDienst {
  readByQuery(query: Record<string, unknown>): Promise<unknown[]>
  updateOne(
    key: string,
    payload: Record<string, unknown>
  ): Promise<string | number>
}

/**
 * Verwirft den Entwurf, der an dieser Zeile haengt — falls es einen gibt.
 *
 * Gibt zurueck, wie viele verworfen wurden: null Entwuerfe sind der
 * Normalfall (die Redaktion entscheidet oft, bevor der Lauf geschrieben hat)
 * und kein Fehler.
 */
export async function verwirfEntwurfZu(
  meldungen: MeldungsDienst,
  filter: Record<string, unknown>,
  grund: string
): Promise<number> {
  const entwuerfe = (await meldungen.readByQuery({
    filter: { ...filter, status: { _eq: 'entwurf' } },
    fields: ['id'],
    limit: -1
  })) as Array<{ id: string }>

  for (const entwurf of entwuerfe) {
    await meldungen.updateOne(entwurf.id, {
      status: 'verworfen',
      fehler: grund
    })
  }
  return entwuerfe.length
}
