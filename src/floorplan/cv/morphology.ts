import { newMask, type Box, type Mask } from './raster';

const INF = 1e20;

/** 1-D squared distance transform of a sampled function (Felzenszwalb & Huttenlocher). */
function dt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    d[q] = (q - v[k]!) ** 2 + f[v[k]!]!;
  }
}

/**
 * Exact Euclidean distance from every foreground pixel to the nearest background pixel
 * (background pixels get 0). Linear time. For a solid wall of thickness T, values on the
 * centreline are ≈ T / 2.
 */
export function distanceTransform(m: Mask): Float32Array {
  const { width: w, height: h } = m;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const tmp = new Float64Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = m.data[y * w + x] ? INF : 0;
    dt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) tmp[y * w + x] = d[y]!;
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = tmp[y * w + x]!;
    dt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]!);
  }
  return out;
}

export interface Component {
  label: number;
  area: number;
  box: Box;
}

/** 8-connected component labelling (two-pass with union–find). Labels start at 1. */
export function connectedComponents(m: Mask): { labels: Int32Array; components: Component[] } {
  const { width: w, height: h } = m;
  const labels = new Int32Array(w * h);
  const parent: number[] = [0];
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!;
      a = parent[a]!;
    }
    return a;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!m.data[i]) continue;
      let l = 0;
      for (const [dx, dy] of [
        [-1, 0],
        [-1, -1],
        [0, -1],
        [1, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w) continue;
        const nl = labels[ny * w + nx]!;
        if (!nl) continue;
        if (!l) l = nl;
        else if (nl !== l) union(l, nl);
      }
      if (!l) {
        l = parent.length;
        parent.push(l);
      }
      labels[i] = l;
    }
  }
  const remap = new Int32Array(parent.length);
  const comps: Component[] = [];
  for (let i = 0; i < labels.length; i++) {
    if (!labels[i]) continue;
    const root = find(labels[i]!);
    let id = remap[root]!;
    if (!id) {
      id = comps.length + 1;
      remap[root] = id;
      comps.push({ label: id, area: 0, box: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity } });
    }
    labels[i] = id;
    const c = comps[id - 1]!;
    const x = i % w;
    const y = (i - x) / w;
    c.area++;
    c.box.x0 = Math.min(c.box.x0, x);
    c.box.y0 = Math.min(c.box.y0, y);
    c.box.x1 = Math.max(c.box.x1, x + 1);
    c.box.y1 = Math.max(c.box.y1, y + 1);
  }
  return { labels, components: comps };
}

/** Mask containing only the given component labels. */
export function selectComponents(
  labels: Int32Array,
  keep: ReadonlySet<number>,
  width: number,
  height: number,
): Mask {
  const m = newMask(width, height);
  for (let i = 0; i < labels.length; i++) if (keep.has(labels[i]!)) m.data[i] = 1;
  return m;
}

/**
 * Zhang–Suen thinning: reduces a mask to 1-pixel-wide 8-connected skeleton lines that run
 * along the medial axis (the wall centrelines for solid wall fills).
 */
export function skeletonize(m: Mask): Mask {
  const { width: w, height: h } = m;
  const img = new Uint8Array(m.data);
  const toClear: number[] = [];
  let changed = true;
  // Only pixels that are on the border of the current shape can be removed, so track them.
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      toClear.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!img[i]) continue;
          const p2 = img[i - w]!;
          const p3 = img[i - w + 1]!;
          const p4 = img[i + 1]!;
          const p5 = img[i + w + 1]!;
          const p6 = img[i + w]!;
          const p7 = img[i + w - 1]!;
          const p8 = img[i - 1]!;
          const p9 = img[i - w - 1]!;
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          const a =
            (+(!p2 && p3) as number) +
            (+(!p3 && p4) as number) +
            (+(!p4 && p5) as number) +
            (+(!p5 && p6) as number) +
            (+(!p6 && p7) as number) +
            (+(!p7 && p8) as number) +
            (+(!p8 && p9) as number) +
            (+(!p9 && p2) as number);
          if (a !== 1) continue;
          if (
            pass === 0 ? p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0 : p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0
          ) {
            toClear.push(i);
          }
        }
      }
      if (toClear.length) changed = true;
      for (const i of toClear) img[i] = 0;
    }
  }
  return { width: w, height: h, data: img };
}

/**
 * Fill background regions fully enclosed by the mask and smaller than `maxArea` — e.g. white
 * door-jamb squares drawn inside a wall fill, which would otherwise create skeleton loops.
 */
export function fillSmallHoles(m: Mask, maxArea: number): Mask {
  const inv = newMask(m.width, m.height);
  for (let i = 0; i < inv.data.length; i++) inv.data[i] = m.data[i] ? 0 : 1;
  const { labels, components } = connectedComponents(inv);
  const fill = new Set(
    components
      .filter(
        (c) => c.area <= maxArea && c.box.x0 > 0 && c.box.y0 > 0 && c.box.x1 < m.width && c.box.y1 < m.height,
      )
      .map((c) => c.label),
  );
  const out = { width: m.width, height: m.height, data: new Uint8Array(m.data) };
  for (let i = 0; i < labels.length; i++) if (fill.has(labels[i]!)) out.data[i] = 1;
  return out;
}
