import * as THREE from 'three';
import { getMaterialDef, type MaterialPattern } from '../catalog/materials';

/**
 * Turns MaterialDefs into shared three.js materials. One material per (id, colour) and one
 * texture per pattern are created lazily and reused across the whole scene, so changing a
 * room's finish swaps a reference instead of rebuilding geometry. `disposeMaterialCache`
 * releases GPU resources when the canvas unmounts.
 */

const materials = new Map<string, THREE.Material>();
const textures = new Map<string, THREE.Texture>();

/** Deterministic PRNG so procedural textures look identical on every load. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIZE = 512;

/** Patterns are drawn in light greys so the material colour tints them via `map`. */
function drawPattern(pattern: MaterialPattern): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const rnd = mulberry32(pattern.length * 7919);
  const grey = (v: number) => `rgb(${v},${v},${v})`;
  g.fillStyle = grey(235);
  g.fillRect(0, 0, SIZE, SIZE);

  switch (pattern) {
    case 'planks': {
      const rows = 6;
      const h = SIZE / rows;
      for (let r = 0; r < rows; r++) {
        let x = -rnd() * SIZE * 0.6;
        while (x < SIZE) {
          const w = SIZE * (0.45 + rnd() * 0.4);
          g.fillStyle = grey(205 + Math.floor(rnd() * 45));
          g.fillRect(x, r * h, w, h);
          for (let k = 0; k < 14; k++) {
            g.strokeStyle = `rgba(90,70,50,${0.04 + rnd() * 0.06})`;
            g.lineWidth = 1 + rnd() * 2;
            const y = r * h + rnd() * h;
            g.beginPath();
            g.moveTo(x, y);
            g.bezierCurveTo(
              x + w / 3,
              y + (rnd() - 0.5) * 6,
              x + (2 * w) / 3,
              y + (rnd() - 0.5) * 6,
              x + w,
              y,
            );
            g.stroke();
          }
          g.fillStyle = 'rgba(40,30,20,0.35)';
          g.fillRect(x, r * h, 2, h);
          x += w;
        }
        g.fillStyle = 'rgba(40,30,20,0.35)';
        g.fillRect(0, r * h, SIZE, 2);
      }
      break;
    }
    case 'herringbone': {
      const u = SIZE / 8;
      for (let i = -2; i < 12; i++) {
        for (let j = -2; j < 12; j++) {
          g.save();
          g.translate(i * u * 2, j * u * 2 + (i % 2) * u);
          g.rotate(((i + j) % 2 ? 1 : -1) * (Math.PI / 4));
          g.fillStyle = grey(200 + Math.floor(rnd() * 50));
          g.fillRect(0, 0, u * 2, u / 2);
          g.strokeStyle = 'rgba(40,30,20,0.3)';
          g.strokeRect(0, 0, u * 2, u / 2);
          g.restore();
        }
      }
      break;
    }
    case 'tiles': {
      const n = 4;
      const s = SIZE / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          g.fillStyle = grey(228 + Math.floor(rnd() * 20));
          g.fillRect(i * s, j * s, s, s);
        }
      g.strokeStyle = 'rgba(120,120,120,0.55)';
      g.lineWidth = 4;
      for (let i = 0; i <= n; i++) {
        g.beginPath();
        g.moveTo(i * s, 0);
        g.lineTo(i * s, SIZE);
        g.moveTo(0, i * s);
        g.lineTo(SIZE, i * s);
        g.stroke();
      }
      break;
    }
    case 'marble': {
      g.fillStyle = grey(245);
      g.fillRect(0, 0, SIZE, SIZE);
      for (let k = 0; k < 18; k++) {
        g.strokeStyle = `rgba(110,110,120,${0.08 + rnd() * 0.18})`;
        g.lineWidth = 0.5 + rnd() * 2.5;
        let x = rnd() * SIZE;
        let y = 0;
        g.beginPath();
        g.moveTo(x, y);
        while (y < SIZE) {
          x += (rnd() - 0.5) * 60;
          y += 20 + rnd() * 30;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      break;
    }
    case 'carpet':
    case 'concrete': {
      const img = g.getImageData(0, 0, SIZE, SIZE);
      const amp = pattern === 'carpet' ? 40 : 22;
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 225 + (rnd() - 0.5) * amp;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      }
      g.putImageData(img, 0, 0);
      if (pattern === 'concrete') {
        for (let k = 0; k < 40; k++) {
          g.fillStyle = `rgba(120,120,120,${rnd() * 0.06})`;
          g.beginPath();
          g.arc(rnd() * SIZE, rnd() * SIZE, 20 + rnd() * 80, 0, Math.PI * 2);
          g.fill();
        }
      }
      break;
    }
    case 'none':
      return null;
  }
  return canvas;
}

function patternTexture(pattern: MaterialPattern, sizeMeters: number): THREE.Texture | null {
  const key = `${pattern}|${sizeMeters}`;
  const cached = textures.get(key);
  if (cached) return cached;
  const canvas = drawPattern(pattern);
  if (!canvas) return null;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // Geometry UVs are in metres, so one repeat = `sizeMeters`.
  tex.repeat.set(1 / sizeMeters, 1 / sizeMeters);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textures.set(key, tex);
  return tex;
}

/** Shared material for a library material id, optionally tinted with an override colour. */
export function getSurfaceMaterial(materialId: string, colorOverride?: string): THREE.Material {
  const key = `${materialId}|${colorOverride ?? ''}`;
  const cached = materials.get(key);
  if (cached) return cached;
  const def = getMaterialDef(materialId);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colorOverride ?? def?.color ?? '#ff00ff'),
    roughness: def?.roughness ?? 0.8,
    metalness: def?.metalness ?? 0,
  });
  if (def && def.pattern !== 'none') {
    const tex = patternTexture(def.pattern, def.patternSize ?? 1);
    if (tex) mat.map = tex;
  }
  if (def?.opacity !== undefined) {
    mat.transparent = true;
    mat.opacity = def.opacity;
    mat.depthWrite = false;
  }
  materials.set(key, mat);
  return mat;
}

/** Plain colour material for UI-ish scene elements (highlights, debug, cut faces). */
export function getColorMaterial(
  color: string,
  opts: { opacity?: number; side?: THREE.Side } = {},
): THREE.Material {
  const key = `color|${color}|${opts.opacity ?? 1}|${opts.side ?? THREE.FrontSide}`;
  const cached = materials.get(key);
  if (cached) return cached;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: opts.side ?? THREE.FrontSide });
  if (opts.opacity !== undefined && opts.opacity < 1) {
    mat.transparent = true;
    mat.opacity = opts.opacity;
    mat.depthWrite = false;
  }
  materials.set(key, mat);
  return mat;
}

export function disposeMaterialCache(): void {
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
  materials.clear();
  textures.clear();
}

/** Box geometry whose UVs are in metres on every face, so textures keep real-world scale. */
export function metricBoxGeometry(length: number, height: number, thickness: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(length, height, thickness);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  // Face order: +x, −x, +y, −y, +z, −z; 4 vertices each. (u, v) extents per face:
  const extents: [number, number][] = [
    [thickness, height],
    [thickness, height],
    [length, thickness],
    [length, thickness],
    [length, height],
    [length, height],
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = extents[f]!;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
  }
  uv.needsUpdate = true;
  return geo;
}
