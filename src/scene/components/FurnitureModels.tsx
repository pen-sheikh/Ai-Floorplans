import { useGLTF } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import type { FurnitureAsset } from '../../catalog/furnitureCatalog';
import type { Dimensions3, FurnitureCategory } from '../../domain/types';
import { getSurfaceMaterial } from '../materialCache';

/**
 * Parametric furniture models. Each is built from the item's REAL dimensions (local frame:
 * width on X, depth on Z with the front at +Z, origin at the floor centre), so resizing an
 * item resizes the model without distortion of legs/cushions.
 */

interface ModelProps {
  category: FurnitureCategory;
  dims: Dimensions3;
  main: THREE.Material;
}

const dark = () => getSurfaceMaterial('cabinet-dark');
const wood = () => getSurfaceMaterial('wood-oak');
const white = () => getSurfaceMaterial('fabric-white');

type BoxSpec = [x: number, y: number, z: number, sx: number, sy: number, sz: number, m: THREE.Material];

/**
 * One unit cube shared by every box of every procedural model; each part is a scaled
 * instance of it. Hundreds of furniture parts therefore cost one GPU geometry, and moving or
 * resizing an item never allocates geometry. (Lives for the app's lifetime; never disposed.)
 */
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

function Boxes({ boxes }: { boxes: BoxSpec[] }) {
  return (
    <>
      {boxes.map(([x, y, z, sx, sy, sz, m], i) => (
        <mesh
          key={i}
          geometry={UNIT_BOX}
          position={[x, y, z]}
          scale={[Math.max(sx, 0.005), Math.max(sy, 0.005), Math.max(sz, 0.005)]}
          material={m}
          castShadow
          receiveShadow
        />
      ))}
    </>
  );
}

function legs(w: number, d: number, h: number, inset: number, size: number, m: THREE.Material): BoxSpec[] {
  const x = w / 2 - inset;
  const z = d / 2 - inset;
  return [
    [-x, h / 2, -z, size, h, size, m],
    [x, h / 2, -z, size, h, size, m],
    [-x, h / 2, z, size, h, size, m],
    [x, h / 2, z, size, h, size, m],
  ];
}

function seating(w: number, d: number, h: number, main: THREE.Material, seats: number): BoxSpec[] {
  const leg = 0.1;
  const arm = Math.min(0.16, w * 0.12);
  const seatH = 0.42;
  const back = Math.min(0.2, d * 0.24);
  const inner = w - 2 * arm;
  const cushions: BoxSpec[] = Array.from({ length: seats }, (_, i) => {
    const cw = inner / seats;
    return [-inner / 2 + cw * (i + 0.5), seatH + 0.06, back / 2, cw - 0.02, 0.12, d - back - 0.04, main];
  });
  return [
    ...legs(w, d, leg, 0.06, 0.05, dark()),
    [0, leg + (seatH - leg) / 2, 0, w, seatH - leg, d, main],
    [0, (h + seatH) / 2, -d / 2 + back / 2, w, h - seatH, back, main],
    [-w / 2 + arm / 2, seatH + 0.12, 0, arm, 0.24, d, main],
    [w / 2 - arm / 2, seatH + 0.12, 0, arm, 0.24, d, main],
    ...cushions,
  ];
}

export function ProceduralModel({ category, dims, main }: ModelProps) {
  const { width: w, depth: d, height: h } = dims;
  const boxes = useMemo<BoxSpec[] | null>(() => {
    switch (category) {
      case 'sofa':
        return seating(w, d, h, main, Math.max(1, Math.round((w - 0.3) / 0.65)));
      case 'armchair':
        return seating(w, d, h, main, 1);
      case 'bed': {
        const frameH = 0.3;
        return [
          [0, frameH / 2, 0.04, w, frameH, d - 0.08, wood()],
          [0, frameH + 0.11, 0.05, w - 0.06, 0.22, d - 0.14, white()],
          [0, h / 2, -d / 2 + 0.04, w, h, 0.08, main],
          [0, frameH + 0.24, d * 0.18, w - 0.04, 0.05, d * 0.6, main],
          [-w / 4, frameH + 0.28, -d / 2 + 0.25, w / 2 - 0.12, 0.1, 0.32, white()],
          [w / 4, frameH + 0.28, -d / 2 + 0.25, w / 2 - 0.12, 0.1, 0.32, white()],
        ];
      }
      case 'dining-table':
      case 'desk':
      case 'coffee-table': {
        const top = category === 'coffee-table' ? 0.05 : 0.04;
        return [[0, h - top / 2, 0, w, top, d, main], ...legs(w, d, h - top, 0.05, 0.05, main)];
      }
      case 'dining-chair':
        return [
          ...legs(w, d, 0.45, 0.03, 0.035, main),
          [0, 0.47, 0, w, 0.04, d, main],
          [0, 0.45 + (h - 0.45) / 2, -d / 2 + 0.02, w, h - 0.45, 0.035, main],
        ];
      case 'office-chair':
        return [
          [0, 0.05, 0, w * 0.8, 0.04, d * 0.8, dark()],
          [0, 0.25, 0, 0.05, 0.4, 0.05, getSurfaceMaterial('steel')],
          [0, 0.48, 0, w * 0.8, 0.08, d * 0.75, main],
          [0, 0.5 + (h - 0.5) / 2, -d / 2 + 0.06, w * 0.75, h - 0.55, 0.06, main],
        ];
      case 'tv-unit': {
        const tvW = Math.min(w * 0.85, 1.45);
        const tvH = (tvW * 9) / 16;
        return [
          [0, h / 2, 0, w, h - 0.04, d, main],
          [0, 0.02, 0, w - 0.06, 0.04, d - 0.06, dark()],
          [0, h + 0.03, -d / 4, 0.3, 0.02, 0.18, dark()],
          [0, h + 0.06 + tvH / 2, -d / 4, tvW, tvH, 0.04, getSurfaceMaterial('hob-black')],
        ];
      }
      case 'wardrobe':
      case 'cabinet':
      case 'bedside-table': {
        const doors =
          category === 'wardrobe' ? Math.max(2, Math.round(w / 0.5)) : category === 'cabinet' ? 3 : 1;
        const seams: BoxSpec[] = Array.from({ length: doors - 1 }, (_, i) => [
          -w / 2 + ((i + 1) * w) / doors,
          h / 2 + 0.03,
          d / 2 + 0.002,
          0.008,
          h - 0.1,
          0.004,
          dark(),
        ]);
        return [
          [0, h / 2 + 0.03, 0, w, h - 0.06, d, main],
          [0, 0.03, -0.02, w - 0.04, 0.06, d - 0.04, dark()],
          ...seams,
        ];
      }
      case 'bookshelf': {
        const shelves = Math.max(2, Math.round(h / 0.36));
        const t = 0.025;
        return [
          [-w / 2 + t / 2, h / 2, 0, t, h, d, main],
          [w / 2 - t / 2, h / 2, 0, t, h, d, main],
          [0, h / 2, -d / 2 + 0.005, w, h, 0.01, main],
          ...Array.from({ length: shelves + 1 }, (_, i): BoxSpec => [
            0,
            (i * (h - t)) / shelves + t / 2,
            0,
            w - 2 * t,
            t,
            d,
            main,
          ]),
        ];
      }
      case 'rug':
        return [[0, h / 2, 0, w, h, d, main]];
      default:
        return null;
    }
  }, [category, w, d, h, main]);

  if (boxes) return <Boxes boxes={boxes} />;

  if (category === 'lamp') {
    return (
      <>
        <mesh position={[0, 0.015, 0]} material={main} castShadow>
          <cylinderGeometry args={[w * 0.45, w * 0.45, 0.03, 24]} />
        </mesh>
        <mesh position={[0, h / 2, 0]} material={main}>
          <cylinderGeometry args={[0.012, 0.012, h, 8]} />
        </mesh>
        <mesh position={[0, h - 0.15, 0]} material={getSurfaceMaterial('fabric-white')} castShadow>
          <cylinderGeometry args={[w * 0.32, w * 0.5, 0.3, 24, 1, true]} />
        </mesh>
      </>
    );
  }
  // plant
  const potH = Math.min(0.35, h * 0.3);
  return (
    <>
      <mesh position={[0, potH / 2, 0]} material={getSurfaceMaterial('ceramic-white')} castShadow>
        <cylinderGeometry args={[w * 0.35, w * 0.28, potH, 20]} />
      </mesh>
      <mesh
        position={[0, potH + (h - potH) * 0.45, 0]}
        material={main}
        castShadow
        scale={[1, (h - potH) / w, 1]}
      >
        <icosahedronGeometry args={[w / 2, 1]} />
      </mesh>
    </>
  );
}

/** glTF asset scaled to the item's real dimensions and sat on the floor. */
export function GltfModel({
  asset,
  dims,
}: {
  asset: Extract<FurnitureAsset, { kind: 'gltf' }>;
  dims: Dimensions3;
}) {
  const gltf = useGLTF(asset.url);
  const object = useMemo(() => {
    const root = gltf.scene.clone(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    root.scale.set(dims.width / (size.x || 1), dims.height / (size.y || 1), dims.depth / (size.z || 1));
    const scaled = new THREE.Box3().setFromObject(root);
    const c = scaled.getCenter(new THREE.Vector3());
    root.position.set(-c.x, -scaled.min.y, -c.z);
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    return root;
  }, [gltf, dims.width, dims.height, dims.depth]);
  return <primitive object={object} />;
}
