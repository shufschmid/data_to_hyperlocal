import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AlleMeldungFelder, AmtsblattFelder, GemeindeFelder } from '@/graphql/redaktion'
import { Amtsblatt } from './Amtsblatt'

function eintrag(ueber: Partial<AmtsblattFelder> = {}): AmtsblattFelder {
  return {
    id: 'a',
    publikations_id: 'p',
    publikationsnummer: null,
    kanton: 'BL',
    gruppe: 'bauen',
    rubrik_name: 'Baugesuch',
    titel: 'Baugesuch - Solaranlage, Aesch',
    publiziert_am: '2026-08-27',
    frist: '2026-09-07',
    amt: 'Bauinspektorat',
    pdf_url: 'https://amtsblattportal.ch/api/v1/publications/p/pdf',
    angaben: null,
    unterlagen: null,
    planbefunde: null,
    plan_status: 'offen',
    plan_fazit: null,
    vorschlag: true,
    vorschlag_begruendung: 'Solaranlage mit Aussenwirkung.',
    entscheid: 'offen',
    ablehnungsgrund: null,
    gemeinde: { id: 'g1', name: 'Aesch' },
    ...ueber
  }
}

const GEMEINDEN: GemeindeFelder[] = [
  { id: 'g1', name: 'Aesch', bezirk: 'Arlesheim', bfs_nummer: 2761, plz: ['4147'], aktiv: true }
]

const HEUTE = '2026-08-31'

function meldung(ueber: Partial<AlleMeldungFelder> = {}): AlleMeldungFelder {
  return {
    id: 'm-1',
    titel: 'Baugesuch für vier Mehrfamilienhäuser am Holeeweg',
    lead: 'Einsprache bis zum 7. September 2026.',
    text: 'Text.',
    status: 'entwurf',
    verarbeitung: 'idle',
    zeit_warnungen: null,
    fehler: null,
    publiziert_am: null,
    erscheint_am: null,
    date_created: '2026-08-31',
    gemeinde: { id: 'g1', name: 'Aesch', bezirk: 'Arlesheim' },
    lauf: null,
    spiel: null,
    kandidat: null,
    amtsblattmeldung: { id: 'a' },
    perle: null,
    ...ueber
  }
}

describe('Amtsblatt', () => {
  // Der gemeldete Fehler: nach „Meldung schreiben" war die Zeile weg, und
  // nichts sagte, wo der Artikel geblieben war. Er wird hier redigiert.
  it('haelt die Zeile und zeigt die Meldung, sobald sie geschrieben ist', () => {
    render(
      <Amtsblatt
        eintraege={[eintrag({ entscheid: 'uebernommen' })]}
        gemeinden={GEMEINDEN}
        meldungen={[meldung()]}
        heute={HEUTE}
      />
    )

    expect(screen.getByText('Baugesuch - Solaranlage, Aesch')).toBeInTheDocument()
    expect(screen.getByText('Baugesuch für vier Mehrfamilienhäuser am Holeeweg')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Meldung schreiben' })).not.toBeInTheDocument()
  })

  it('laesst die Zeile gehen, sobald die Meldung publiziert ist', () => {
    render(
      <Amtsblatt
        eintraege={[eintrag({ entscheid: 'uebernommen' })]}
        gemeinden={GEMEINDEN}
        meldungen={[meldung({ status: 'publiziert' })]}
        heute={HEUTE}
      />
    )

    expect(screen.getByText(/Nichts auf dem Tisch/)).toBeInTheDocument()
  })

  it('zeigt Titel, Amt und die Frist absolut', () => {
    render(<Amtsblatt eintraege={[eintrag()]} gemeinden={GEMEINDEN} heute={HEUTE} />)

    expect(screen.getByText('Baugesuch - Solaranlage, Aesch')).toBeInTheDocument()
    expect(screen.getByText(/Bauinspektorat/)).toBeInTheDocument()
    expect(screen.getByText('Frist: 7. September 2026')).toBeInTheDocument()
  })

  it('nennt die Begruendung der Sichtung', () => {
    render(<Amtsblatt eintraege={[eintrag()]} gemeinden={GEMEINDEN} heute={HEUTE} />)

    expect(screen.getByText('Solaranlage mit Aussenwirkung.')).toBeInTheDocument()
  })

  // Nothing is thrown away: what the triage did not propose is folded, not
  // dropped, and the button says so.
  it('klappt die uebrigen weg, ohne sie zu verschweigen', async () => {
    render(
      <Amtsblatt
        eintraege={[eintrag({ id: 'ja' }), eintrag({ id: 'nein', vorschlag: false, titel: 'Whirlpool' })]}
        gemeinden={GEMEINDEN}
        heute={HEUTE}
      />
    )

    expect(screen.queryByText('Whirlpool')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Übrige 1 anzeigen/ }))
    expect(screen.getByText('Whirlpool')).toBeInTheDocument()
  })

  it('verlinkt die amtliche Publikation und die Unterlagen', () => {
    render(
      <Amtsblatt
        eintraege={[
          eintrag({
            unterlagen: [
              {
                art: 'plaene',
                bezeichnung: 'Baugesuchsplaene',
                url: 'https://bgauflage.bl.ch/x',
                lesbar: true
              },
              { art: 'karte', bezeichnung: 'Karte', url: 'https://geoview.bl.ch/x', lesbar: false }
            ]
          })
        ]}
        gemeinden={GEMEINDEN}
        heute={HEUTE}
      />
    )

    expect(screen.getByRole('link', { name: /Amtliche Publikation/ })).toHaveAttribute(
      'href',
      'https://amtsblattportal.ch/api/v1/publications/p/pdf'
    )
    // Die Beschriftung kommt aus der Art, nicht aus dem gespeicherten Text —
    // sonst behalten alte Zeilen eine alte Schreibweise für immer.
    expect(screen.getByRole('link', { name: /Baugesuchspläne/ })).toHaveAttribute(
      'href',
      'https://bgauflage.bl.ch/x'
    )
    expect(screen.getByRole('link', { name: /Lage/ })).toBeInTheDocument()
  })

  // The editor's own door to the plans — offered only where there is something
  // we can actually read.
  it('bietet das Lesen der Unterlagen an, wo es geht', async () => {
    const onUnterlagen = jest.fn().mockResolvedValue(undefined)
    render(
      <Amtsblatt
        eintraege={[
          eintrag({
            unterlagen: [{ art: 'plaene', bezeichnung: 'Plaene', url: 'u', lesbar: true }]
          })
        ]}
        gemeinden={GEMEINDEN}
        heute={HEUTE}
        onUnterlagen={onUnterlagen}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'Unterlagen lesen und einbeziehen' }))

    expect(onUnterlagen).toHaveBeenCalledWith('a')
  })

  it('bietet es nicht an, wo nichts Lesbares dranhaengt', () => {
    render(
      <Amtsblatt
        eintraege={[eintrag({ unterlagen: [{ art: 'ebau', bezeichnung: 'eBau', url: 'u', lesbar: false }] })]}
        gemeinden={GEMEINDEN}
        heute={HEUTE}
      />
    )

    expect(screen.queryByRole('button', { name: 'Unterlagen lesen und einbeziehen' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /eBau/ })).toBeInTheDocument()
  })

  it('zeigt die Befunde aus den Plaenen auf Klick', async () => {
    render(
      <Amtsblatt
        eintraege={[
          eintrag({
            plan_status: 'gelesen',
            plan_fazit: 'Die Plaene tragen die Meldung.',
            planbefunde: ['16 Wohnungen (Blatt 5 von 8)']
          })
        ]}
        gemeinden={GEMEINDEN}
        heute={HEUTE}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: /Was in den Unterlagen steht \(1\)/ }))

    expect(screen.getByText('Die Plaene tragen die Meldung.')).toBeInTheDocument()
    expect(screen.getByText(/16 Wohnungen/)).toBeInTheDocument()
  })

  it('reicht das Uebernehmen und das Weiterreichen weiter', async () => {
    const onUebernehmen = jest.fn().mockResolvedValue(undefined)
    const onWeiterreichen = jest.fn().mockResolvedValue(undefined)
    render(
      <Amtsblatt
        eintraege={[eintrag()]}
        gemeinden={GEMEINDEN}
        heute={HEUTE}
        onUebernehmen={onUebernehmen}
        onWeiterreichen={onWeiterreichen}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'Meldung schreiben' }))
    expect(onUebernehmen).toHaveBeenCalledWith('a')

    await userEvent.click(screen.getByRole('button', { name: 'An Chefredaktion' }))
    expect(onWeiterreichen).toHaveBeenCalledWith('a', null)
  })

  // The reason is the learning signal — it rides into the next triage.
  it('fragt beim Ablehnen nach dem Grund', async () => {
    const onAblehnen = jest.fn().mockResolvedValue(undefined)
    render(<Amtsblatt eintraege={[eintrag()]} gemeinden={GEMEINDEN} heute={HEUTE} onAblehnen={onAblehnen} />)

    await userEvent.click(screen.getByRole('button', { name: 'Ablehnen' }))
    await userEvent.type(screen.getByLabelText('Kommentar'), 'Privates Kleinbauwerk.')
    await userEvent.click(screen.getByRole('button', { name: 'Ablehnen' }))

    expect(onAblehnen).toHaveBeenCalledWith('a', 'nicht_relevant', 'Privates Kleinbauwerk.')
  })

  // Without a postcode the portal returns nothing for the SHAB half — and an
  // absence looks exactly like "nothing was published".
  it('warnt bei Gemeinden ohne Postleitzahl', () => {
    render(
      <Amtsblatt
        eintraege={[]}
        gemeinden={[...GEMEINDEN, { ...GEMEINDEN[0]!, id: 'g2', name: 'Dornach', plz: null }]}
        heute={HEUTE}
      />
    )

    expect(screen.getByText(/Handelsregister, Konkurse und Betreibungen unsichtbar/)).toBeInTheDocument()
    expect(screen.getByText(/Dornach/)).toBeInTheDocument()
  })

  it('sagt es, wenn nichts auf dem Tisch liegt', () => {
    render(<Amtsblatt eintraege={[]} gemeinden={GEMEINDEN} heute={HEUTE} />)

    expect(screen.getByText(/Nichts auf dem Tisch/)).toBeInTheDocument()
  })
})
