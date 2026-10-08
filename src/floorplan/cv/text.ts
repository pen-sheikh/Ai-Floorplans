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

interface LexEntry {
  /** Upper-case ASCII spelling (accents are stripped from OCR text before matching). */
  word: string;
  /** 'unknown': a real room name that does not determine one of the model's room types. */
  type: RoomType;
  /** Display word for abbreviations ("BR" → "Bedroom"); otherwise the word itself. */
  display?: string;
  /** How strongly the word implies the type (ambiguous words such as "Zimmer" are weak). */
  weight?: number;
}

/**
 * Room-name vocabulary: English, common abbreviations, and frequent French, German, Spanish,
 * Italian and Dutch words. General vocabulary only — never names copied from a specific plan.
 */
const LEXICON: LexEntry[] = [
  // Bedrooms
  { word: 'BEDROOM', type: 'bedroom' },
  { word: 'BED', type: 'bedroom', display: 'Bedroom' },
  { word: 'BEDRM', type: 'bedroom', display: 'Bedroom' },
  { word: 'BDRM', type: 'bedroom', display: 'Bedroom' },
  { word: 'BR', type: 'bedroom', display: 'Bedroom', weight: 0.7 },
  { word: 'MASTER', type: 'bedroom', display: 'Master Bedroom' },
  { word: 'SLEEPOUT', type: 'bedroom', weight: 0.7 },
  { word: 'NURSERY', type: 'bedroom' },
  { word: 'CHAMBRE', type: 'bedroom' },
  { word: 'SCHLAFZIMMER', type: 'bedroom' },
  { word: 'KINDERZIMMER', type: 'bedroom' },
  { word: 'ZIMMER', type: 'bedroom', weight: 0.45 },
  { word: 'DORMITORIO', type: 'bedroom' },
  { word: 'HABITACION', type: 'bedroom', weight: 0.7 },
  { word: 'SLAAPKAMER', type: 'bedroom' },
  // Living
  { word: 'LIVING', type: 'living' },
  { word: 'LOUNGE', type: 'living' },
  { word: 'RECEPTION', type: 'living' },
  { word: 'SITTING', type: 'living' },
  { word: 'FAMILY', type: 'living', weight: 0.8 },
  { word: 'SALON', type: 'living' },
  { word: 'SEJOUR', type: 'living' },
  { word: 'WOHNZIMMER', type: 'living' },
  { word: 'WOHNEN', type: 'living' },
  { word: 'SALA', type: 'living', weight: 0.8 },
  { word: 'ESTAR', type: 'living' },
  { word: 'SOGGIORNO', type: 'living' },
  { word: 'WOONKAMER', type: 'living' },
  // Kitchen
  { word: 'KITCHEN', type: 'kitchen' },
  { word: 'KITCHENETTE', type: 'kitchen' },
  { word: 'KIT', type: 'kitchen', display: 'Kitchen', weight: 0.8 },
  { word: 'KITCH', type: 'kitchen', display: 'Kitchen' },
  { word: 'CUISINE', type: 'kitchen' },
  { word: 'KUCHE', type: 'kitchen', display: 'Küche' },
  { word: 'KUECHE', type: 'kitchen', display: 'Küche' },
  { word: 'COCINA', type: 'kitchen' },
  { word: 'CUCINA', type: 'kitchen' },
  { word: 'KEUKEN', type: 'kitchen' },
  // Dining
  { word: 'DINING', type: 'dining' },
  { word: 'DINER', type: 'dining' },
  { word: 'ESSZIMMER', type: 'dining' },
  { word: 'ESSEN', type: 'dining', weight: 0.8 },
  { word: 'COMEDOR', type: 'dining' },
  // Bathrooms and toilets
  { word: 'BATHROOM', type: 'bathroom' },
  { word: 'BATH', type: 'bathroom', display: 'Bathroom' },
  { word: 'SHOWER', type: 'bathroom' },
  { word: 'ENSUITE', type: 'bathroom' },
  { word: 'EN-SUITE', type: 'bathroom' },
  { word: 'T&B', type: 'bathroom', display: 'Bathroom' },
  { word: 'WASHROOM', type: 'bathroom', weight: 0.8 },
  { word: 'BAD', type: 'bathroom', display: 'Bad', weight: 0.8 },
  { word: 'BADEZIMMER', type: 'bathroom' },
  { word: 'SDB', type: 'bathroom', display: 'Salle de bains' },
  { word: 'BANO', type: 'bathroom', display: 'Baño' },
  { word: 'BAGNO', type: 'bathroom' },
  { word: 'BADKAMER', type: 'bathroom' },
  { word: 'WC', type: 'toilet', display: 'WC' },
  { word: 'W.C.', type: 'toilet', display: 'WC' },
  { word: 'TOILET', type: 'toilet' },
  { word: 'TOILETS', type: 'toilet', display: 'Toilet' },
  { word: 'TOILETTES', type: 'toilet' },
  { word: 'LAVATORY', type: 'toilet' },
  { word: 'CLOAKROOM', type: 'toilet' },
  { word: 'CLOAKS', type: 'toilet', display: 'Cloakroom' },
  { word: 'POWDER', type: 'toilet', display: 'Powder Room' },
  // Circulation
  { word: 'HALL', type: 'hall' },
  { word: 'HALLWAY', type: 'hall' },
  { word: 'ENTRANCE', type: 'hall' },
  { word: 'ENTRY', type: 'hall' },
  { word: 'LANDING', type: 'hall' },
  { word: 'CORRIDOR', type: 'hall' },
  { word: 'LOBBY', type: 'hall' },
  { word: 'FOYER', type: 'hall' },
  { word: 'PASSAGE', type: 'hall' },
  { word: 'VESTIBULE', type: 'hall' },
  { word: 'FLUR', type: 'hall' },
  { word: 'DIELE', type: 'hall' },
  { word: 'ENTREE', type: 'hall', display: 'Entrée' },
  { word: 'PASILLO', type: 'hall' },
  { word: 'RECIBIDOR', type: 'hall' },
  { word: 'INGRESSO', type: 'hall' },
  { word: 'GANG', type: 'hall', weight: 0.7 },
  // Outdoor
  { word: 'BALCONY', type: 'balcony' },
  { word: 'TERRACE', type: 'balcony' },
  { word: 'LOGGIA', type: 'balcony' },
  { word: 'BALKON', type: 'balcony' },
  { word: 'TERRASSE', type: 'balcony' },
  { word: 'BALCON', type: 'balcony' },
  { word: 'TERRAZA', type: 'balcony' },
  { word: 'VERANDA', type: 'balcony' },
  // Utility and storage
  { word: 'UTILITY', type: 'utility' },
  { word: 'LAUNDRY', type: 'utility' },
  { word: 'WD', type: 'utility', display: 'Laundry', weight: 0.8 },
  { word: 'BOILER', type: 'utility' },
  { word: 'BUANDERIE', type: 'utility' },
  { word: 'HAUSWIRTSCHAFT', type: 'utility' },
  { word: 'LAVANDERIA', type: 'utility' },
  { word: 'STORE', type: 'storage' },
  { word: 'STORAGE', type: 'storage' },
  { word: 'CUPBOARD', type: 'storage' },
  { word: 'CPD', type: 'storage', display: 'Cupboard' },
  { word: 'CLOSET', type: 'storage' },
  { word: 'CLOS', type: 'storage', display: 'Closet' },
  { word: 'WARDROBE', type: 'storage' },
  { word: 'WIC', type: 'storage', display: 'Walk-in Closet' },
  { word: 'PANTRY', type: 'storage' },
  { word: 'LINEN', type: 'storage' },
  { word: 'AIRING', type: 'storage' },
  { word: 'KAMMER', type: 'storage', weight: 0.7 },
  { word: 'ABSTELLRAUM', type: 'storage' },
  { word: 'RANGEMENT', type: 'storage' },
  { word: 'PLACARD', type: 'storage' },
  { word: 'TRASTERO', type: 'storage' },
  // Real rooms whose type the model does not represent: the name is kept, the type stays unknown.
  { word: 'STUDY', type: 'unknown' },
  { word: 'OFFICE', type: 'unknown' },
  { word: 'DEN', type: 'unknown' },
  { word: 'LIBRARY', type: 'unknown' },
  { word: 'GARAGE', type: 'unknown' },
  { word: 'CARPORT', type: 'unknown' },
  { word: 'PORCH', type: 'unknown' },
  { word: 'STAIRS', type: 'unknown' },
  { word: 'STAIRCASE', type: 'unknown' },
  { word: 'TREPPENHAUS', type: 'unknown' },
  { word: 'ARBEITSZIMMER', type: 'unknown' },
  { word: 'BUREAU', type: 'unknown' },
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
  /** A clean name built from the recognised words and room numbers ("Bedroom 2"). */
  display: string;
  /** 'unknown' when the label names a room the model has no type for (e.g. "Study"). */
  type: RoomType;
  /** OCR confidence reduced for every correction needed to match. */
  confidence: number;
  /** How strongly the words imply the type (1 = unambiguous). */
  typeWeight: number;
  corrections: number;
}

const COMBINED_TYPES: Partial<Record<string, RoomType>> = {
  'kitchen+living': 'kitchen-living',
  'kitchen+dining': 'kitchen-living',
  'kitchen+living+dining': 'kitchen-living',
  'dining+living': 'living',
  'bathroom+toilet': 'bathroom',
};

/** Words that often accompany a room name without changing what the room is. */
const NEUTRAL_WORDS = new Set([
  'ROOM',
  'RM',
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
  'DE',
  'DU',
  'LA',
  'LE',
  'SALLE',
  'MAIDS',
  'MAID',
]);

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const titleWord = (w: string) => w[0]!.toUpperCase() + w.slice(1).toLowerCase();

/**
 * Recognise a room name. "BED ROOM", "BEDR00M", "Kitchen/Lounge/Diner", "Chambre", "Küche"
 * match; anything that would need more than one correction per 5 letters is rejected rather
 * than guessed, and so is text that merely mentions a room.
 */
export function matchRoomName(raw: string, ocrConfidence = 1): RoomNameMatch | null {
  // Parenthesised text is a note ("(excluding Balcony)"), not a label.
  if (/[()]/.test(raw)) return null;
  const cleaned = stripAccents(raw)
    .toUpperCase()
    .replace(/[’']/g, '')
    .replace(/[^A-Z0-9/&.\-| ]/g, ' ');
  // Re-join words split by OCR ("BED ROOM") before splitting on separators.
  const joined = cleaned
    .replace(/\bBED\s+ROOM\b/g, 'BEDROOM')
    .replace(/\bBATH\s+ROOM\b/g, 'BATHROOM')
    .replace(/\bT\s*&\s*B\b/g, 'T&B')
    .replace(/\bW\s*\/\s*C\b/g, 'WC')
    .replace(/\bW\s*\/\s*D\b/g, 'WD');
  const tokens = joined
    .split(/(?:[\s,+]|\bAND\b)+|(?<=[A-Z.])\/(?=[A-Z])|(?<=[A-Z])\/(?=\s)/)
    .filter(Boolean);
  const words: string[] = [];
  const types: RoomType[] = [];
  const display: string[] = [];
  const weights: number[] = [];
  let corrections = 0;
  let unmatched = 0;
  for (const token of tokens) {
    const part = token.replace(/^[.\-|]+|[.\-|]+$/g, '') || token;
    if (/^\d{1,2}$/.test(part)) {
      if (display.length) display.push(part); // room number ("Bedroom 2")
      continue;
    }
    if (part.length < 2 && !/^\d$/.test(part)) continue;
    const candidate = part.replace(/[0-9|]/g, (c) => ALPHA_CONFUSIONS[c] ?? c);
    let best: { e: LexEntry; d: number } | null = null;
    for (const e of LEXICON) {
      const d = levenshtein(candidate, e.word);
      const allowed = e.word.length <= 3 ? 0 : e.word.length <= 5 ? 1 : 2;
      if (d <= allowed && (!best || d < best.d)) best = { e, d };
    }
    if (!best) {
      if (/^[A-Z]{3,}$/.test(part) && !NEUTRAL_WORDS.has(part)) unmatched++;
      continue;
    }
    words.push(best.e.word);
    types.push(best.e.type);
    weights.push(best.e.weight ?? 1);
    const shown = best.e.display ?? titleWord(best.e.word);
    if (!display.includes(shown) && !(shown === 'Bedroom' && display.includes('Master Bedroom'))) {
      if (shown === 'Master Bedroom' && display.includes('Bedroom'))
        display.splice(display.indexOf('Bedroom'), 1, shown);
      else display.push(shown);
    }
    corrections += best.d + (candidate !== part ? 1 : 0);
  }
  // A sentence that merely mentions a room ("Ceiling height reduced in kitchen") is not a label.
  if (!words.length || unmatched > words.length) return null;
  const known = [...new Set(types.filter((t) => t !== 'unknown'))].sort();
  const type: RoomType = !known.length
    ? 'unknown'
    : known.length === 1
      ? known[0]!
      : (COMBINED_TYPES[known.join('+')] ?? (known.includes('kitchen') ? 'kitchen-living' : 'unknown'));
  const named = [...new Set(types)].length > 1 && known.length > 1;
  return {
    raw,
    words,
    display: display.join(named ? ' / ' : ' ').replace(/ \/ (\d+)/g, ' $1'),
    type,
    corrections,
    typeWeight: Math.min(...weights),
    confidence: +(ocrConfidence * Math.max(0.3, 1 - 0.12 * corrections)).toFixed(3),
  };
}

/** Types that legitimately share one open-plan space. */
const OPEN_PLAN = new Set<RoomType>(['kitchen', 'living', 'dining', 'kitchen-living']);

/**
 * Several room names inside one enclosed space. Open-plan combinations (kitchen / living /
 * dining) are one room; anything else suggests two rooms whose dividing wall was not found —
 * `plausible` says which.
 */
export function combineRoomNames(matches: RoomNameMatch[]): { match: RoomNameMatch; plausible: boolean } {
  const distinct = matches.filter((m, i) => matches.findIndex((o) => o.display === m.display) === i);
  if (distinct.length === 1) return { match: distinct[0]!, plausible: matches.length === 1 };
  const types = [...new Set(distinct.map((m) => m.type).filter((t) => t !== 'unknown'))].sort();
  const flat = types.flatMap((t) => (t === 'kitchen-living' ? ['kitchen', 'living'] : [t]));
  const key = [...new Set(flat)].sort().join('+');
  const plausible = types.every((t) => OPEN_PLAN.has(t));
  const type: RoomType =
    types.length === 1 ? types[0]! : plausible ? (COMBINED_TYPES[key] ?? 'kitchen-living') : 'unknown';
  return {
    plausible,
    match: {
      raw: distinct.map((m) => m.raw).join(' / '),
      words: distinct.flatMap((m) => m.words),
      display: distinct.map((m) => m.display).join(' / '),
      type,
      confidence: Math.min(...distinct.map((m) => m.confidence)),
      typeWeight: Math.min(...distinct.map((m) => m.typeWeight)),
      corrections: distinct.reduce((s, m) => s + m.corrections, 0),
    },
  };
}

// ── Dimensions ──────────────────────────────────────────────────────────────────────

export interface ParsedDimension {
  /** Metres. */
  values: number[];
  unit: 'm' | 'mm' | 'ft';
  raw: string;
}

const NUM = String.raw`(\d{1,2}[.,]\d{1,3})`;
/** Feet and inches: 14'0", 12' 7", 10'-6", 9' (OCR often reads ’ or ” for the marks). */
const FT = String.raw`(\d{1,3})\s*['’′]\s*-?\s*(?:(\d{1,2}(?:\.\d)?)\s*(?:["”″]|''))?`;
const feet = (ft: string, inch?: string) => +(Number(ft) * 0.3048 + Number(inch ?? 0) * 0.0254).toFixed(4);

/**
 * Parse printed dimensions: "3.84m x 2.66m", "6.39 x 3.77 m", "4200 x 3100 mm", "3.20",
 * "5.40 m", and feet-and-inches "14'0" x 12'8"" (converted to metres, unit 'ft'). Metric is
 * preferred where a label gives both. Returns null when the text is not a dimension.
 */
export function parseDimension(text: string): ParsedDimension | null {
  const t = text.replace(/[×X]/g, 'x').replace(/\s+/g, ' ').trim();
  const imperialOnly = /['"’”′″]/.test(t) && !/\d\s*m\b/.test(t);
  if (imperialOnly) {
    const pair = t.match(new RegExp(`${FT}\\s*x\\s*${FT}`, 'i'));
    if (pair) return { values: [feet(pair[1]!, pair[2]), feet(pair[3]!, pair[4])], unit: 'ft', raw: text };
    const single = t.match(new RegExp(`^${FT}$`, 'i'));
    if (single) return { values: [feet(single[1]!, single[2])], unit: 'ft', raw: text };
    return null;
  }
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
