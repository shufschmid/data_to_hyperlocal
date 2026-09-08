// How large a plan sheet may be before it cannot travel to the model.
//
// The Claude API refuses any image wider or taller than 8000 pixels — measured
// on Binningen's Baugesuch 0275/2026, whose sheet 3 is a 8433-pixel-wide scan
// well under the BYTE cap (scans compress well), so the size guard in
// `fetchPlanbilder` never saw it coming and the whole reading failed with a
// raw 400 in `plan_fazit`.
//
// Oversized sheets are LEFT OUT rather than resized: shrinking would need an
// image codec in the bundle, and the newsroom decided the honest note — this
// Meldung was written from fewer sheets than the file holds — is enough. The
// note is deterministic and travels with the row (`plan_blaetter`), the desk
// and the article both state it.
//
// The dimensions are read from the file HEADER, not by decoding the image: a
// JPEG names its size in the SOF segment, a PNG in the IHDR chunk. No
// dependency, a few dozen bytes of reading.

/** The API's hard limit per image edge. */
export const PLAN_MAX_KANTE = 8000

export interface BildMasse {
  breite: number
  hoehe: number
}

const PNG_SIGNATUR = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
])

function pngMasse(b: Buffer): BildMasse | null {
  if (b.length < 24 || !b.subarray(0, 8).equals(PNG_SIGNATUR)) return null
  if (b.toString('latin1', 12, 16) !== 'IHDR') return null
  return { breite: b.readUInt32BE(16), hoehe: b.readUInt32BE(20) }
}

/**
 * Walks the JPEG markers to the frame header (SOF), which carries the size.
 *
 * SOF is any of 0xC0-0xCF except DHT (0xC4), JPGext (0xC8) and DAC (0xCC) —
 * baseline and progressive scans both. Reaching the scan data without a frame
 * header means the file is broken; null, not a guess.
 */
function jpegMasse(b: Buffer): BildMasse | null {
  if (b.length < 4 || b.readUInt8(0) !== 0xff || b.readUInt8(1) !== 0xd8)
    return null
  let i = 2
  while (i + 9 < b.length) {
    if (b.readUInt8(i) !== 0xff) {
      i += 1
      continue
    }
    const marker = b.readUInt8(i + 1)
    // fill bytes and standalone markers carry no length word
    if (marker === 0xff) {
      i += 1
      continue
    }
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      i += 2
      continue
    }
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return { hoehe: b.readUInt16BE(i + 5), breite: b.readUInt16BE(i + 7) }
    }
    if (marker === 0xda) return null
    i += 2 + b.readUInt16BE(i + 2)
  }
  return null
}

/**
 * The pixel size of a sheet, or null when the header cannot be read.
 *
 * Decided by the magic bytes, not the URL's extension — a gallery is free to
 * serve a PNG under a `.jpg` name.
 */
export function bildMasse(puffer: Buffer): BildMasse | null {
  return pngMasse(puffer) ?? jpegMasse(puffer)
}

/**
 * Whether a sheet fits through the API.
 *
 * Unknown dimensions count as passt: a header this code cannot read is far more
 * likely a variant of a fine image than an oversized one, and dropping it on a
 * hunch would silently cost a normal sheet. If it IS oversized, the reading
 * fails exactly as loudly as before — nothing gets worse.
 */
export function passtDurchsLimit(puffer: Buffer): boolean {
  const masse = bildMasse(puffer)
  if (masse === null) return true
  return masse.breite <= PLAN_MAX_KANTE && masse.hoehe <= PLAN_MAX_KANTE
}
