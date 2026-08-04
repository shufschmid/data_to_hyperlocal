'use client'

import { createTheme } from '@mui/material/styles'

// One theme for the whole app. Change colours, radii and typography here — not with
// `sx` overrides scattered across components.
//
// The font stack is deliberately system fonts: `next/font/google` downloads at build
// time, which breaks a `docker build` on a machine without internet access. Ship a
// font file under public/ and reference it with @font-face if you need a brand font.
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'data-mui-color-scheme' },
  colorSchemes: { light: true, dark: true },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: [
      'system-ui',
      '-apple-system',
      'Segoe UI',
      'Roboto',
      'Helvetica Neue',
      'Arial',
      'sans-serif'
    ].join(','),
    h1: { fontSize: '1.75rem', fontWeight: 600 },
    h2: { fontSize: '1.25rem', fontWeight: 600 }
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiPaper: { defaultProps: { variant: 'outlined' } }
  }
})
