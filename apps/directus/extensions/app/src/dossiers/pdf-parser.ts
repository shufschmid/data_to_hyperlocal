import {
  clusterIntoBlocks,
  extractOrderedLines,
  joinBlockLines,
  loadPdfDocument,
  reflowParagraphs,
  SMD_FOOTER_RE,
  SMD_PAGE_NUMBER_RE,
  type Line,
  type Paragraph
} from '../shared/pdf-text'

// Parses an SMD "Dossier" PDF (SRF Regionaljournal Basel Baselland transcripts).
// The generic line/paragraph extraction (column split, hyphen-aware joining,
// HH:MM:SS reflow) lives in shared/pdf-text.ts, shared with the Punkt6 dossier
// PDFs (punkt6/pdf-parser.ts) - same SMD system, same layout, different
// show-specific markers, which is what stays in this file.
//
// Ported from the Python PoC's pdf_parser.py; see shared/pdf-text.ts for why
// pdfjs-dist needed extra work PyMuPDF gave for free.

export type { Paragraph }

export interface Segment {
  broadcastDate: string // ISO "YYYY-MM-DD", from the PDF's own date header
  headline: string
  teaserBlocks: string[]
  paragraphs: Paragraph[]
}

const MARKER_TEXT = '[Automatische Transkription]'
const SUBTITLE_TEXT = 'Regionaljournal Basel Baselland'
const DATE_HEADER_RE = /srf Audio (\d{2})-(\d{2})-(\d{4})\s*$/

interface SegmentAccumulator {
  broadcastDate: string
  headline: string
  teaserBlocks: string[]
  bodyLines: Line[]
}

export async function parseDossier(buffer: Buffer): Promise<Segment[]> {
  const doc = await loadPdfDocument(buffer)

  const accumulators: SegmentAccumulator[] = []

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const lines = (await extractOrderedLines(page)).filter(
      (l) => !SMD_FOOTER_RE.test(l.text) && !SMD_PAGE_NUMBER_RE.test(l.text)
    )

    const markerIndex = lines.findIndex((l) => l.text === MARKER_TEXT)

    let bodyLines: Line[]

    if (markerIndex !== -1) {
      const preambleLines = lines.slice(0, markerIndex)
      const dateLine = preambleLines.find((l) => DATE_HEADER_RE.test(l.text))
      if (!dateLine) {
        throw new Error(
          `Segment starting on PDF page ${pageNum} has no "srf Audio DD-MM-YYYY" date header`
        )
      }
      const dateMatch = DATE_HEADER_RE.exec(dateLine.text) as unknown as [
        string,
        string,
        string,
        string
      ]
      const [, dd, mm, yyyy] = dateMatch
      const broadcastDate = `${yyyy}-${mm}-${dd}`

      const rest = preambleLines.filter(
        (l) => l !== dateLine && l.text !== SUBTITLE_TEXT
      )
      const blocks = clusterIntoBlocks(rest)
      const [headlineBlock, ...teaserBlockLines] = blocks
      const headline = headlineBlock ? joinBlockLines(headlineBlock) : ''
      const teaserBlocks = teaserBlockLines.map(joinBlockLines)

      accumulators.push({
        broadcastDate,
        headline,
        teaserBlocks,
        bodyLines: []
      })
      bodyLines = lines.slice(markerIndex + 1)
    } else {
      const current = accumulators.at(-1)
      if (!current) continue // front matter (e.g. table of contents) before the first segment
      bodyLines = lines.filter((l) => !DATE_HEADER_RE.test(l.text)) // strip the repeated per-page date header
    }

    accumulators.at(-1)?.bodyLines.push(...bodyLines)
  }

  return accumulators.map((acc) => ({
    broadcastDate: acc.broadcastDate,
    headline: acc.headline,
    teaserBlocks: acc.teaserBlocks,
    paragraphs: reflowParagraphs(acc.bodyLines)
  }))
}
