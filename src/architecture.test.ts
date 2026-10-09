import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The layer boundary (docs/DECISIONS.md D2) is enforced by ESLint (`eslint.config.js`). These
 * tests lint small virtual files through the real configuration, so the rule itself is proven:
 * a forbidden import in a pure layer fails, and legitimate imports stay allowed.
 */
let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: process.cwd() });
});

const BOUNDARY_RULES = new Set(['@typescript-eslint/no-restricted-imports', 'no-restricted-syntax']);
const violations = async (filePath: string, code: string) => {
  const [result] = await eslint.lintText(code, { filePath });
  return result!.messages.filter((m) => m.ruleId !== null && BOUNDARY_RULES.has(m.ruleId));
};

describe('layer boundary: pure layers cannot depend on presentation', () => {
  it.each([
    ['src/domain/probe.ts', "import { Mesh } from 'three';\nexport const m = Mesh;\n"],
    ['src/domain/probe.ts', "import type { Object3D } from 'three';\nexport type O = Object3D;\n"],
    ['src/engine/probe.ts', "export { useState } from 'react';\n"],
    ['src/editor/probe.ts', "import { Canvas } from '@react-three/fiber';\nexport const c = Canvas;\n"],
    [
      'src/catalog/probe.ts',
      "import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';\nexport const o = OrbitControls;\n",
    ],
    ['src/ai/probe.ts', "import { create } from 'zustand';\nexport const c = create;\n"],
    ['src/ai/probe.ts', "import { useScene } from '../state/sceneStore';\nexport const s = useScene;\n"],
    ['src/floorplan/cv/probe.ts', "export * from '../../ui/Inspector';\n"],
    ['src/persistence/probe.ts', "import React = require('react');\nexport const r = React;\n"],
    ['src/floorplan/probe.ts', "export const load = () => import('three');\n"],
  ])('rejects %s: %s', async (file, code) => {
    expect((await violations(file, code)).length).toBeGreaterThan(0);
  });

  it('keeps the domain model the bottom layer (production code), but lets its tests use fixtures', async () => {
    expect(
      await violations(
        'src/domain/probe.ts',
        "import { applyCommand } from '../editor/commands';\nexport const a = applyCommand;\n",
      ),
    ).not.toEqual([]);
    expect(
      await violations(
        'src/domain/probe.test.ts',
        "import { applyCommand } from '../editor/commands';\nexport const a = applyCommand;\n",
      ),
    ).toEqual([]);
  });
});

describe('layer boundary: legitimate imports stay allowed', () => {
  it.each([
    ['src/domain/probe.ts', "import { polygonArea } from './geometry';\nexport const a = polygonArea;\n"],
    ['src/engine/probe.ts', "import type { Floor } from '../domain/types';\nexport type F = Floor;\n"],
    [
      'src/ai/probe.ts',
      "import { applyCommand } from '../editor/commands';\nexport const a = applyCommand;\n",
    ],
    ['src/floorplan/cv/probe.ts', "export const load = () => import('tesseract.js');\n"],
    [
      'src/scene/probe.tsx',
      "import { Mesh } from 'three';\nimport { useMemo } from 'react';\nexport const x = [Mesh, useMemo];\n",
    ],
    [
      'src/ui/probe.tsx',
      "import { useState } from 'react';\nimport { useScene } from '../state/sceneStore';\nexport const x = [useState, useScene];\n",
    ],
    ['src/state/probe.ts', "import { create } from 'zustand';\nexport const c = create;\n"],
  ])('allows %s: %s', async (file, code) => {
    expect(await violations(file, code)).toEqual([]);
  });
});
