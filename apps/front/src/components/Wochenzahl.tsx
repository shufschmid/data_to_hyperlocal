'use client'

import Typography from '@mui/material/Typography'

// Die eine Zahl, die der Redaktion selbst gefehlt hat.
//
// Das Lagebild vom 15. September nennt sie D8: drei Systeme warten auf denselben
// Menschen, und niemand misst, wie lange. Die Tische zaehlen zwar ihre Badges,
// aber jeder fuer sich; was diese Woche insgesamt geschehen ist und wie alt das
// aelteste Wartende ist, stand nirgends.
//
// Gerechnet wird im Bundle (`redaktion/bilanz.ts`), hier steht nur die Anzeige.
// Eine Zeile, kein Reiter: sie soll nebenbei gelesen werden, nicht aufgesucht.

export interface WochenzahlBilanz {
  fenster_tage: number
  gesamt: {
    offen: number
    freigegeben: number
    aeltester_tage: number | null
    publiziert_im_fenster: number
  }
}

export interface WochenzahlProps {
  bilanz: WochenzahlBilanz | null
}

/**
 * Der Satz zur Bilanz, oder null.
 *
 * Getrennt von der Komponente, damit die Formulierung ohne DOM pruefbar ist —
 * und weil hier die eine Entscheidung steckt, die keine Anzeige ist: was
 * weggelassen wird, wenn es null ist. Eine «0 Tage» hiesse «das aelteste ist von
 * heute», und das ist etwas anderes als «es wartet nichts».
 */
export function wochenzahlText(bilanz: WochenzahlBilanz | null): string | null {
  if (bilanz === null) return null
  const { offen, freigegeben, aeltester_tage, publiziert_im_fenster } = bilanz.gesamt
  const teile = [
    `${publiziert_im_fenster} publiziert`,
    `${offen} offen`,
    ...(freigegeben > 0 ? [`${freigegeben} unterschrieben`] : []),
    ...(aeltester_tage === null ? [] : [`aeltester Entwurf ${aeltester_tage} Tage`])
  ]
  const fenster = bilanz.fenster_tage === 7 ? 'Diese Woche' : `Diese ${bilanz.fenster_tage} Tage`
  return `${fenster}: ${teile.join(', ')}`
}

export function Wochenzahl({ bilanz }: WochenzahlProps) {
  const text = wochenzahlText(bilanz)
  if (text === null) return null
  return (
    <Typography variant="body2" color="text.secondary">
      {text}
    </Typography>
  )
}
