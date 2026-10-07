let counter = 0;

/** Short, collision-resistant ids for user-created entities (e.g. `furniture-lq3k9-4f2a-7`). */
export function newId(prefix: string): string {
  counter += 1;
  const rand = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0');
  return `${prefix}-${Date.now().toString(36)}-${rand}-${counter}`;
}
