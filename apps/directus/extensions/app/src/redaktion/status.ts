import type { Entscheidung, Meldung, MeldungStatus } from '../types/schema'

// The editorial state machine, as a table rather than a pile of conditionals.
//
// It lives here, pure, and is enforced by a hook rather than by the endpoints —
// because the endpoints are not the only way in. Sämi is an administrator: he
// can open `meldungen` in the Directus admin UI and set `status` by hand, and a
// rule that only the endpoint checks is a rule that does not hold.
//
// The invariant worth protecting above all: an article sent out for
// counter-checking must not reach `publiziert` without someone approving it.

export const UEBERGAENGE: Readonly<
  Record<MeldungStatus, readonly MeldungStatus[]>
> = {
  // The editor's call: send it out, approve it directly, publish it directly,
  // or drop it.
  entwurf: ['in_pruefung', 'freigegeben', 'publiziert', 'verworfen'],
  // Deliberately no `publiziert` here. Once an article is out for checking,
  // the only way forward is through a recorded decision — that is the whole
  // point of sending it.
  in_pruefung: ['freigegeben', 'entwurf', 'verworfen'],
  freigegeben: ['publiziert', 'entwurf', 'verworfen'],
  // A published article can be pulled back or retracted.
  publiziert: ['entwurf', 'verworfen'],
  verworfen: ['entwurf']
}

export function istUebergangErlaubt(
  von: MeldungStatus,
  nach: MeldungStatus
): boolean {
  if (von === nach) return true
  return (UEBERGAENGE[von] ?? []).includes(nach)
}

/** Fields an article must have before it may go out at all. */
export function hatInhalt(
  meldung: Pick<Meldung, 'titel' | 'lead' | 'text'>
): boolean {
  return (
    typeof meldung.titel === 'string' &&
    meldung.titel.trim() !== '' &&
    typeof meldung.lead === 'string' &&
    meldung.lead.trim() !== '' &&
    typeof meldung.text === 'string' &&
    meldung.text.trim() !== ''
  )
}

/**
 * Only an unambiguous yes counts.
 *
 * `unklar` is what the classifier returns for a reply it could not read as a
 * decision — a shrug, a question, a thumbs-up emoji on the wrong message. It
 * must never be treated as approval; the article goes back to the editor
 * instead.
 */
export function istFreigegeben(entscheidung: Entscheidung | null): boolean {
  return entscheidung === 'ja'
}

export interface Pruefung {
  erlaubt: boolean
  /** German, because this reaches the browser and the admin UI. */
  grund?: string
}

export type MeldungZustand = Pick<
  Meldung,
  'status' | 'titel' | 'lead' | 'text' | 'entscheidung' | 'freigegeben_am'
>

/**
 * Whether a message may move from its current state to `nach`.
 *
 * Everything the caller needs to know is decided here, so the hook, the
 * endpoints and any future caller cannot disagree about what is allowed.
 */
export function pruefeUebergang(
  aktuell: MeldungZustand,
  nach: MeldungStatus
): Pruefung {
  if (aktuell.status === nach) return { erlaubt: true }

  if (!istUebergangErlaubt(aktuell.status, nach)) {
    return {
      erlaubt: false,
      grund:
        aktuell.status === 'in_pruefung' && nach === 'publiziert'
          ? 'Eine Meldung in der Gegenpruefung kann nicht direkt publiziert werden. Sie braucht zuerst eine Freigabe.'
          : `Der Wechsel von "${aktuell.status}" zu "${nach}" ist nicht vorgesehen.`
    }
  }

  if (
    (nach === 'in_pruefung' || nach === 'publiziert') &&
    !hatInhalt(aktuell)
  ) {
    return {
      erlaubt: false,
      grund: 'Die Meldung hat noch keinen vollstaendigen Text.'
    }
  }

  // Coming out of a counter-check, the decision has to say yes. This is the
  // rule the whole review flow exists for.
  if (
    nach === 'freigegeben' &&
    aktuell.status === 'in_pruefung' &&
    !istFreigegeben(aktuell.entscheidung)
  ) {
    return {
      erlaubt: false,
      grund:
        aktuell.entscheidung === null
          ? 'Es liegt noch keine Rueckmeldung aus der Gegenpruefung vor.'
          : 'Die Rueckmeldung aus der Gegenpruefung ist keine eindeutige Freigabe.'
    }
  }

  if (nach === 'publiziert' && aktuell.status === 'freigegeben') {
    if (aktuell.freigegeben_am === null) {
      return {
        erlaubt: false,
        grund:
          'Der Freigabezeitpunkt fehlt — die Freigabe ist nicht nachvollziehbar.'
      }
    }
  }

  return { erlaubt: true }
}

/**
 * Whether an edit to the article text invalidates an approval that was given.
 *
 * The same principle as clearing a stale summary when its source changes: an
 * approval refers to the text somebody read. Rewriting the text afterwards and
 * keeping the approval would publish something nobody checked.
 */
export function inhaltGeaendert(
  aktuell: Pick<Meldung, 'titel' | 'lead' | 'text'>,
  payload: Record<string, unknown>
): boolean {
  for (const feld of ['titel', 'lead', 'text'] as const) {
    if (!(feld in payload)) continue
    const neu = payload[feld]
    if (typeof neu !== 'string') continue
    if (neu !== (aktuell[feld] ?? '')) return true
  }
  return false
}

/** What a content edit resets, so an approval cannot outlive the text it covered. */
export function ruecksetzungNachAenderung(
  aktuell: Pick<Meldung, 'status'>
): Record<string, unknown> | null {
  if (aktuell.status !== 'freigegeben' && aktuell.status !== 'in_pruefung') {
    return null
  }

  return {
    status: 'entwurf',
    entscheidung: null,
    entscheidung_klartext: null,
    freigegeben_am: null,
    freigabe_token_hash: null,
    freigabe_token_ablauf: null
  }
}
