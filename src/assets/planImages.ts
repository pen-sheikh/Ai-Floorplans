/**
 * Resolves repository plan files (e.g. "floor-plans/E2-floorplan.jpg") to bundled URLs.
 * The plan stays in `floor-plans/` — it is not copied into the app.
 */
const urls = import.meta.glob('../../floor-plans/*.{jpg,jpeg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export function planImageUrl(file: string): string | undefined {
  const name = file.split('/').pop();
  const hit = Object.entries(urls).find(([path]) => path.endsWith(`/${name}`));
  return hit?.[1];
}
