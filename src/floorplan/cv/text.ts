import type { RoomType } from '../../domain/types';
import type { Box, RgbaImage } from './raster';

/** A recognised word. Confidence in [0, 1]. Box in image pixels. */
export interface OcrWord {
  text: string;
  confidence: number;
  box: Box;
}

/**
 * OCR boundary. Implementations: tesseract.js (offline, see ocrTesseract.ts), a server-side
 * service, or a fixed list in tests. Keys for hosted OCR must never live in the browser.
 */
export interface OcrProvider {
  readonly name: string;
  recognize(
    image: RgbaImage,
    opts?: { region?: Box; scale?: number; charWhitelist?: string; singleLine?: boolean },
  ): Promise<OcrWord[]>;
}

/** Text lines assembled from words that share a baseline. */
export interface TextLine {
  text: string;
  words: OcrWord[];
  box: Box;
  confidence: number;
}

export function groupLines(words: OcrWord[]): TextLine[] {
  const ws = words.filter((w) => w.text.trim());
  const h = (w: OcrWord) => w.box.y1 - w.box.y0;
  const cy = (w: OcrWord) => (w.box.y0 + w.box.y1) / 2;
  // 1. Bands of words whose vertical centres agree (tallest words first anchor a band).
  const bands: { cy: number; h: number; words: OcrWord[] }[] = [];
  for (const w of [...ws].sort((a, b) => h(b) - h(a))) {
    // The smaller height decides, so one tall junk box (a window read as "I") cannot pull
    // the lines above and below it into one band.
    const band = bands.find((b) => Math.abs(cy(w) - b.cy) < 0.5 * Math.min(h(w), b.h));
    if (band) band.words.push(w);
    else bands.push({ cy: cy(w), h: h(w), words: [w] });
  }
  // 2. Within a band, sort by x and split where the gap is larger than ~1.6 text heights.
  const lines: OcrWord[][] = [];
  for (const b of bands) {
    const sorted = b.words.sort((p, q) => p.box.x0 - q.box.x0);
    const lineH = b.words.map(h).sort((p, q) => p - q)[Math.floor(b.words.length / 2)]!;
    let cur: OcrWord[] = [];
    for (const w of sorted) {
      const last = cur[cur.length - 1];
      if (last && w.box.x0 - last.box.x1 > 1.6 * lineH) {
        lines.push(cur);
        cur = [];
      }
      cur.push(w);
    }
    if (cur.length) lines.push(cur);
  }
  return lines
    .map((l) => ({
      words: l,
      text: l.map((w) => w.text).join(' '),
      box: {
        x0: Math.min(...l.map((w) => w.box.x0)),
        y0: Math.min(...l.map((w) => w.box.y0)),
        x1: Math.max(...l.map((w) => w.box.x1)),
        y1: Math.max(...l.map((w) => w.box.y1)),
      },
      confidence: Math.min(...l.map((w) => w.confidence)),
    }))
    .sort((p, q) => p.box.y0 - q.box.y0 || p.box.x0 - q.box.x0);
}

// ── Room names ──────────────────────────────────────────────────────────────────────

const LEXICON: [string, RoomType][] = [
  ['BEDROOM', 'bedroom'],
  ['BED', 'bedroom'],
  ['MASTER', 'bedroom'],
  ['LIVING', 'living'],
  ['LOUNGE', 'living'],
  ['RECEPTION', 'living'],
  ['SITTING', 'living'],
  ['FAMILY', 'living'],
  ['KITCHEN', 'kitchen'],
  ['DINING', 'dining'],
  ['DINER', 'dining'],
  ['BATHROOM', 'bathroom'],
  ['BATH', 'bathroom'],
  ['SHOWER', 'bathroom'],
  ['ENSUITE', 'bathroom'],
  ['EN-SUITE', 'bathroom'],
  ['WC', 'toilet'],
  ['W.C.', 'toilet'],
  ['TOILET', 'toilet'],
  ['CLOAKROOM', 'toilet'],
  ['HALL', 'hall'],
  ['HALLWAY', 'hall'],
  ['ENTRANCE', 'hall'],
  ['LANDING', 'hall'],
  ['CORRIDOR', 'hall'],
  ['BALCONY', 'balcony'],
  ['TERRACE', 'balcony'],
  ['UTILITY', 'utility'],
  ['STUDY', 'living'],
  ['OFFICE', 'living'],
  ['STORE', 'storage'],
  ['STORAGE', 'storage'],
  ['CUPBOARD', 'storage'],
  ['WARDROBE', 'storage'],
];

/** OCR digit/letter confusions, used ONLY to compare against the lexicon (text is not rewritten). */
const ALPHA_CONFUSIONS: Record<string, string> = {
  '0': 'O',
  '1': 'I',
  '5': 'S',
  '8': 'B',
  '6': 'G',
  '|': 'I',
};

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length]![b.length]!;
}

export interface RoomNameMatch {
  /** Text exactly as OCR read it. */
  raw: string;
  /** Lexicon words recognised (e.g. KITCHEN, LOUNGE, DINER). */
  words: string[];
  type: RoomType;
  /** OCR confidence reduced for every correction needed to match. */
  confidence: number;
  corrections: number;
}

const COMBINED_TYPES: Partial<Record<string, RoomType>> = {
  'kitchen+living': 'kitchen-living',
  'kitchen+dining': 'kitchen-living',
  'kitchen+living+dining': 'kitchen-living',
  'dining+living': 'living',
};

/**
 * Recognise a room name. "BED ROOM", "BEDR00M" and "Kitchen/Lounge/Diner" match; anything
 * that would need more than one correction per 5 letters is rejected rather than guessed.
 */
/** Words that often accompany a room name without changing what the room is. */
const NEUTRAL_WORDS = new Set([
  'ROOM',
  'AREA',
  'MAIN',
  'PRINCIPAL',
  'GUEST',
  'OPEN',
  'PLAN',
  'SMALL',
  'LARGE',
  'DOUBLE',
  'SINGLE',
  'WALK',
  'IN',
  'NO',
  'THE',
  'AND',
]);

export function matchRoomName(raw: string, ocrConfidence = 1): RoomNameMatch | null {
  // Parenthesised text is a note ("(excluding Balcony)"), not a label.
  if (/[()]/.test(raw)) return null;
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9/&.\-| ]/g, ' ');
  // Re-join words split by OCR ("BED ROOM") before splitting on separators.
  const joined = cleaned.replace(/\bBED\s+ROOM\b/g, 'BEDROOM').replace(/\bBATH\s+ROOM\b/g, 'BATHROOM');
  const parts = joined.split(/[\s/&+,]+|\bAND\b/).filter((p) => p.length >= 2 && !/^\d+$/.test(p));
  const words: string[] = [];
  const types: RoomType[] = [];
  let corrections = 0;
  let unmatched = 0;
  for (const part of parts) {
    const candidate = part.replace(/[0-9|]/g, (c) => ALPHA_CONFUSIONS[c] ?? c);
    let best: { word: string; type: RoomType; d: number } | null = null;
    for (const [word, type] of LEXICON) {
      const d = levenshtein(candidate, word);
      const allowed = word.length <= 3 ? 0 : word.length <= 5 ? 1 : 2;
      if (d <= allowed && (!best || d < best.d)) best = { word, type, d };
    }
    if (!best) {
      if (/^[A-Z]{3,}$/.test(part) && !NEUTRAL_WORDS.has(part)) unmatched++;
      continue;
    }
    words.push(best.word);
    types.push(best.type);
    corrections += best.d + (candidate !== part ? 1 : 0);
  }
  // A sentence that merely mentions a room ("Ceiling height reduced in kitchen") is not a label.
  if (!words.length || unmatched > words.length) return null;
  const set = [...new Set(types)].sort();
  const type =
    set.length === 1
      ? set[0]!
      : (COMBINED_TYPES[set.join('+')] ?? (set.includes('kitchen') ? 'kitchen-living' : set[0]!));
  return {
    raw,
    words,
    type,
    corrections,
    confidence: +(ocrConfidence * Math.max(0.3, 1 - 0.12 * corrections)).toFixed(3),
  };
}

// ── Dimensions ──────────────────────────────────────────────────────────────────────

export interface ParsedDimension {
  /** Metres. */
  values: number[];
  unit: 'm' | 'mm';
  raw: string;
}

const NUM = String.raw`(\d{1,2}[.,]\d{1,3})`;

/**
 * Parse printed dimensions: "3.84m x 2.66m", "6.39 x 3.77 m", "4200 x 3100 mm", "3.20",
 * "5.40 m". Imperial values are ignored. Returns null when the text is not a dimension.
 */
export function parseDimension(text: string): ParsedDimension | null {
  const t = text.replace(/[×X]/g, 'x').replace(/\s+/g, ' ').trim();
  if (/['"’”]/.test(t) && !/\d\s*m\b/.test(t)) return null; // imperial only
  const pair =
    t.match(new RegExp(`${NUM}\\s*m?\\s*x\\s*${NUM}\\s*m\\b`, 'i')) ??
    t.match(new RegExp(`^${NUM}\\s*m?\\s*x\\s*${NUM}\\s*m?$`, 'i'));
  if (pair) return { values: [num(pair[1]!), num(pair[2]!)], unit: 'm', raw: text };
  const mmPair = t.match(/\b(\d{3,5})\s*x\s*(\d{3,5})\s*(mm)?\b/i);
  if (mmPair) return { values: [Number(mmPair[1]) / 1000, Number(mmPair[2]) / 1000], unit: 'mm', raw: text };
  const single = t.match(new RegExp(`^${NUM}\\s*m?$`, 'i'));
  if (single) return { values: [num(single[1]!)], unit: 'm', raw: text };
  const singleMm = t.match(/^(\d{3,5})\s*(mm)?$/i);
  if (singleMm && Number(singleMm[1]) >= 300)
    return { values: [Number(singleMm[1]) / 1000], unit: 'mm', raw: text };
  return null;
}

const num = (s: string) => Number(s.replace(',', '.'));

/** Text that looks numeric but failed to parse (e.g. "3.7/m"): worth a second, closer read. */
export const looksLikeDimension = (text: string): boolean =>
  /\d[.,]\d/.test(text) || /^\d{3,5}$/.test(text.trim());

/** "Approx. 57.4 sq. metres" / "57.4 m²" → 57.4 */
export function parseArea(text: string): number | null {
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:sq\.?\s*(?:m\b|metres|meters)|m²|m2|square\s+met)/i);
  return m ? num(m[1]!) : null;
}

export function parseFloorLabel(text: string): string | null {
  const m = text.match(
    /\b(ground|first|second|third|fourth|fifth|lower ground|upper|basement|top)\s+floor\b/i,
  );
  return m ? m[0].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}

// ── Reading a plan ──────────────────────────────────────────────────────────────────

export interface PlanText {
  names: { match: RoomNameMatch; box: Box }[];
  dimensions: { parsed: ParsedDimension; box: Box; confidence: number; refined: boolean }[];
  reportedAreaM2?: number;
  floorLabel?: string;
  words: OcrWord[];
}

const inside = (w: OcrWord, r: Box) => {
  const cx = (w.box.x0 + w.box.x1) / 2;
  const cy = (w.box.y0 + w.box.y1) / 2;
  return cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1;
};

/**
 * Each proposed text line is read on its own (single-line mode, enlarged): whole-page layout
 * analysis can merge a label with nearby door arcs, or treat a walled area as a picture. The
 * page pass still supplies text outside the proposals (and inside one whose own read failed);
 * page "words" far taller than real text are junk and dropped.
 */
async function readWords(
  img: RgbaImage,
  ocr: OcrProvider,
  regions: Box[],
  regionImage: RgbaImage,
): Promise<OcrWord[]> {
  const page = await ocr.recognize(img);
  const heights = regions.map((r) => r.y1 - r.y0).sort((a, b) => a - b);
  const typical = heights.length ? heights[Math.floor(heights.length / 2)]! : Infinity;
  const plausible = page.filter((w) => w.box.y1 - w.box.y0 <= 2.5 * typical);
  const meanConf = (ws: OcrWord[]) => ws.reduce((a, w) => a + w.confidence, 0) / Math.max(1, ws.length);
  // A reading that makes sense (a dimension, a room name, an area) beats one that does not.
  const score = (ws: OcrWord[]) => {
    if (!ws.length) return -1;
    const t = ws.map((w) => w.text).join(' ');
    const meaningful = parseDimension(t) || parseArea(t) !== null || parseFloorLabel(t) || matchRoomName(t);
    return meanConf(ws) + (meaningful ? 0.5 : 0);
  };
  const words: OcrWord[] = [];
  const usePage: Box[] = [];
  for (const region of regions) {
    const read = (await ocr.recognize(regionImage, { region, scale: 3, singleLine: true })).filter(
      (w) => w.confidence >= 0.3 && /[A-Za-z0-9/&]/.test(w.text),
    );
    const pageIn = plausible.filter((w) => inside(w, region));
    // Keep whichever reading of this line is more confident.
    if (read.length && score(read) >= score(pageIn) - 0.05) words.push(...read);
    else usePage.push(region);
  }
  words.push(
    ...plausible.filter((w) => !regions.some((r) => inside(w, r)) || usePage.some((r) => inside(w, r))),
  );
  return words;
}

/**
 * OCR the whole plan, then re-read suspicious numeric tokens from an upscaled crop with a
 * digit whitelist. No text is ever "auto-corrected" into a value it did not read.
 */
export async function readPlanText(
  img: RgbaImage,
  ocr: OcrProvider,
  opts: { regions?: Box[]; regionImage?: RgbaImage } = {},
): Promise<PlanText> {
  const clean = opts.regionImage ?? img;
  const words = await readWords(img, ocr, opts.regions ?? [], clean);
  const lines = groupLines(words);
  const out: PlanText = { names: [], dimensions: [], words };
  for (const line of lines) {
    const area = parseArea(line.text);
    if (area !== null && out.reportedAreaM2 === undefined) out.reportedAreaM2 = area;
    const floor = parseFloorLabel(line.text);
    if (floor && !out.floorLabel) out.floorLabel = floor;
    if (area !== null || floor) continue;

    let dim = parseDimension(line.text);
    let refined = false;
    let confidence = line.confidence;
    if (!dim && looksLikeDimension(line.text)) {
      // Second read of the whole line, 3× larger, digits only.
      const pad = 3;
      const region = {
        x0: line.box.x0 - pad,
        y0: line.box.y0 - pad,
        x1: line.box.x1 + pad,
        y1: line.box.y1 + pad,
      };
      const again = await ocr.recognize(clean, {
        region,
        scale: 3,
        charWhitelist: '0123456789.,mx ',
        singleLine: true,
      });
      const text = again.map((w) => w.text).join(' ');
      const parsed = parseDimension(text);
      if (parsed) {
        dim = parsed;
        refined = true;
        // Numeric words only (a lone "x" separator often scores 0); a second read costs 10 %.
        const numeric = again.filter((w) => /\d/.test(w.text));
        confidence = (numeric.reduce((a, w) => a + w.confidence, 0) / Math.max(1, numeric.length)) * 0.9;
      }
    }
    if (dim) {
      out.dimensions.push({ parsed: dim, box: line.box, confidence: +confidence.toFixed(3), refined });
      continue;
    }
    const name = matchRoomName(line.text, line.confidence);
    if (name) out.names.push({ match: name, box: line.box });
  }
  return out;
}
