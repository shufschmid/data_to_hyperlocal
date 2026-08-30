import { render, screen } from '@testing-library/react'
import { Artikeltext } from './Artikeltext'

// Der Quellenverweis ist das eine Stueck Auszeichnung in einer Meldung. Er kommt
// vom Backend und zeigt auf die geprueste Adresse; hier wird nur sichergestellt,
// dass er als Link ankommt und nicht als sichtbare Tags — und dass sonst nichts
// zur Auszeichnung wird.

const QUELLE = 'https://data.bl.ch/explore/dataset/10230/'

describe('Artikeltext', () => {
  it('macht aus dem Quellenverweis einen echten Link', () => {
    render(
      <Artikeltext
        text={`In Pratteln entstanden 22 Wohnungen, wie das <a href="${QUELLE}">Statistische Amt meldet</a>.`}
      />
    )

    const link = screen.getByRole('link', { name: 'Statistische Amt meldet' })
    expect(link).toHaveAttribute('href', QUELLE)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('zeigt keine rohen Tags', () => {
    const { container } = render(<Artikeltext text={`Das <a href="${QUELLE}">Amt</a> meldet.`} />)
    expect(container.textContent).toBe('Das Amt meldet.')
  })

  it('trennt Absaetze wie bisher', () => {
    render(<Artikeltext text={'Erster Absatz.\n\nZweiter Absatz.'} />)
    expect(screen.getByText('Erster Absatz.')).toBeInTheDocument()
    expect(screen.getByText('Zweiter Absatz.')).toBeInTheDocument()
  })

  // Der Sicherheitspunkt: nichts wird per innerHTML gesetzt, also kann auch
  // nichts eingeschleust werden. Fremde Tags bleiben sichtbarer Text.
  it('macht aus fremden Tags keine Auszeichnung', () => {
    const { container } = render(<Artikeltext text={'Hallo <script>alert(1)</script> und <b>fett</b>.'} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('<script>alert(1)</script>')
  })

  it('vertraegt fehlenden Text', () => {
    const { container } = render(<Artikeltext text={null} />)
    expect(container.textContent).toBe('')
  })
})
