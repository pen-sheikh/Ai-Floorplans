import type { IntentContext } from './intents';

type RoomSummary = Pick<IntentContext['rooms'][number], 'name' | 'type' | 'areaM2'>;

/** Example prompts built from the loaded apartment (never from a specific plan's room names). */
export function suggestedPrompts(rooms: readonly RoomSummary[]): string[] {
  const ofType = (...types: string[]) => rooms.filter((r) => types.includes(r.type));
  const living = ofType('living', 'kitchen-living')[0];
  const bedrooms = [...ofType('bedroom')].sort((a, b) => b.areaM2 - a.areaM2);
  const bath = ofType('bathroom', 'toilet')[0];
  const out: string[] = [];
  if (living) {
    out.push(`Put a 3-seat sofa against the longest wall in the ${living.name}`);
    out.push(`Fit a TV unit and coffee table in the ${living.name}`);
  }
  if (bedrooms[0]) out.push(`Can I fit a king-size bed in ${bedrooms[0].name}?`);
  const second = bedrooms[1] ?? bedrooms[0];
  if (second) out.push(`Renovate ${second.name} with warm wood flooring and light beige walls`);
  if (bath) out.push(`Make the ${bath.name} floor marble`);
  if (bedrooms[0]) out.push(`Make ${bedrooms[0].name} Scandinavian`);
  return out;
}
