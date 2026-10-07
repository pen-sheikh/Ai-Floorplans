/**
 * Resolves plan image files to URLs: repository plans (e.g. "floor-plans/E2-floorplan.jpg") are
 * bundled; images uploaded in this session are registered at runtime (object URLs — they are
 * not persisted, so a reloaded project shows its geometry without the background picture).
 */
const urls = import.meta.glob('../../floor-plans/*.{jpg,jpeg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const uploaded = new Map<string, string>();

export function registerPlanImage(file: string, url: string): void {
  const old = uploaded.get(file);
  if (old && old !== url) URL.revokeObjectURL(old);
  uploaded.set(file, url);
}

export function planImageUrl(file: string): string | undefined {
  const runtime = uploaded.get(file);
  if (runtime) return runtime;
  const name = file.split('/').pop();
  const hit = Object.entries(urls).find(([path]) => path.endsWith(`/${name}`));
  return hit?.[1];
}
