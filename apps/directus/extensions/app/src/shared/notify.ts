// How an approval request reaches a person.
//
// An interface rather than a mail call, because the channel is the part most
// likely to change: today it is a link the editor passes on, tomorrow it may be
// WhatsApp. Everything around it — the token, the state machine, the decision
// handling — stays identical, which is the whole point of putting a seam here.
//
// WhatsApp is deliberately not implemented yet. Meta's Groups API caps a group
// at eight participants and can only serve groups it created itself, so it
// cannot watch the newsroom's existing ones. Slotting it in later means adding
// a class here and nothing else.

export interface Benachrichtigung {
  /** Channel-specific address. Ignored by the link notifier. */
  empfaenger: string | null
  betreff: string
  text: string
  link: string
}

export interface Zustellung {
  kanal: string
  /** What the channel calls this delivery, for the audit trail. */
  referenz: string
  /** Shown to the editor. The link notifier puts the link itself here. */
  hinweis: string
}

export interface Notifier {
  send(nachricht: Benachrichtigung): Promise<Zustellung>
}

/**
 * The honest default: hand the link back and let the editor pass it on.
 *
 * Not a placeholder for a mail sender — a deliberate choice. The container has
 * no MTA (`EMAIL_TRANSPORT="sendmail"` with nothing behind it), so a mail
 * notifier would report success and deliver nothing, which is worse than
 * telling the editor to copy a link.
 */
export class LinkNotifier implements Notifier {
  async send(nachricht: Benachrichtigung): Promise<Zustellung> {
    return {
      kanal: 'link',
      referenz: nachricht.link,
      hinweis: `Link zum Weitergeben: ${nachricht.link}`
    }
  }
}

/** Wording of the request, in one place so every channel says the same thing. */
export function baueFreigabeNachricht(
  gemeinde: string,
  titel: string,
  link: string
): Benachrichtigung {
  return {
    empfaenger: null,
    betreff: `Gegenlesen: ${titel}`,
    text: [
      `Fuer ${gemeinde} ist eine Meldung entstanden:`,
      '',
      titel,
      '',
      'Bitte einmal draufschauen und danach freigeben oder ablehnen.'
    ].join('\n'),
    link
  }
}
