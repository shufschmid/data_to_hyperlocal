import {
  extractOrderedLines,
  loadPdfDocument,
  reflowParagraphs,
  SMD_FOOTER_RE,
  SMD_PAGE_NUMBER_RE,
  type Line,
  type Paragraph
} from '../shared/pdf-text'

// Parses a Punkt6 (Tele Basel) SMD "Dossier" PDF - same underlying SMD system as
// the Regionaljournal dossiers (identical footer, identical two-column layout,
// identical "HH:MM:SS text" transcript convention - see shared/pdf-text.ts), but a
// different show-specific header and, crucially, a different document shape: one
// PDF is always ONE continuous episode transcript, never several segments each
// restarting their own timeline the way a Regionaljournal dossier can.

export type { Paragraph }

export interface Punkt6Segment {
  broadcastDate: string // ISO "YYYY-MM-DD"
  headline: string // "punkt6 vom DD.MM.YYYY", taken verbatim from the PDF
  paragraphs: Paragraph[]
}

// "© teleBasel DD-MM-YYYY" repeats on every page - it's not part of the transcript,
// and the episode's own broadcast date comes from HEADLINE_RE instead, so this is
// only used to strip the line, never to read the date from it.
const COPYRIGHT_LINE_RE = /^©\s*teleBasel\s+\d{2}-\d{2}-\d{4}/
const HEADLINE_RE = /^punkt6 vom (\d{2})\.(\d{2})\.(\d{4})$/

// Defensive safety net for a word run that lost its space (e.g. "InhaberinGerdaMaise"
// instead of "Inhaberin Gerda Maise"). This looked like a real risk from the PDF's
// chat-rendered text during planning, but parsing the actual file with pdfjs-dist
// (see __fixtures__/TEBV_2026-08-25.pdf, exercised in pdf-parser.test.ts) shows
// pdfjs-dist's own extraction already spaces this PDF correctly throughout - the
// garbling was an artifact of that other rendering path, not of pdfjs-dist. Kept
// as a cheap, harmless fallback (only fires on a genuine lowercase-to-uppercase
// run) in case a future dossier hits the same font/kerning quirk.
function splitStuckWords(text: string): string {
  return text.replace(/([a-zäöüß])([A-ZÄÖÜ])/g, '$1 $2')
}

/**
 * Pure orchestration over already-extracted PDF lines: finds the headline/date in
 * the preamble, reflows the rest into timestamped paragraphs. Split out from
 * parsePunkt6Dossier so it's unit-testable with hand-built Line[] fixtures,
 * independent of pdfjs-dist and a real PDF file.
 */
export function buildPunkt6Segment(lines: Line[]): Punkt6Segment {
  const firstTimestampIndex = lines.findIndex((l) =>
    /^\d{2}:\d{2}:\d{2}\s/.test(l.text)
  )
  if (firstTimestampIndex === -1) {
    throw new Error('Punkt6 dossier PDF has no timestamped transcript')
  }

  const preambleLines = lines.slice(0, firstTimestampIndex)
  const bodyLines = lines.slice(firstTimestampIndex)

  const headlineLine = preambleLines.find((l) => HEADLINE_RE.test(l.text))
  if (!headlineLine) {
    throw new Error(
      'Punkt6 dossier PDF has no "punkt6 vom DD.MM.YYYY" headline'
    )
  }
  const [, dd, mm, yyyy] = HEADLINE_RE.exec(headlineLine.text) as unknown as [
    string,
    string,
    string,
    string
  ]

  const paragraphs = reflowParagraphs(bodyLines).map((p) => ({
    ...p,
    text: splitStuckWords(p.text)
  }))

  return {
    broadcastDate: `${yyyy}-${mm}-${dd}`,
    headline: headlineLine.text,
    paragraphs
  }
}

export async function parsePunkt6Dossier(
  buffer: Buffer
): Promise<Punkt6Segment> {
  const doc = await loadPdfDocument(buffer)

  const lines: Line[] = []
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const pageLines = (await extractOrderedLines(page)).filter(
      (l) =>
        !SMD_FOOTER_RE.test(l.text) &&
        !SMD_PAGE_NUMBER_RE.test(l.text) &&
        !COPYRIGHT_LINE_RE.test(l.text)
    )
    lines.push(...pageLines)
  }

  return buildPunkt6Segment(lines)
}
