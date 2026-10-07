import type { Apartment, Door, Floor, FurnitureItem, Room, RoomRenovation, Window } from '../domain/types';

/**
 * Every edit is a plain, serialisable command applied by a pure function. This gives
 * undo/redo (history of snapshots), lets the AI layer emit the same commands, and keeps a
 * path open to collaboration/event-sourcing later.
 */
export type Command =
  | { type: 'furniture/add'; item: FurnitureItem }
  | { type: 'furniture/update'; id: string; patch: FurniturePatch }
  | { type: 'furniture/remove'; id: string }
  | { type: 'room/renovate'; roomId: string; patch: Partial<RoomRenovation> }
  | { type: 'room/rename'; roomId: string; name: string }
  | {
      type: 'door/update';
      id: string;
      patch: Partial<Pick<Door, 'kind' | 'materialId' | 'width' | 'height'>>;
    }
  | {
      type: 'window/update';
      id: string;
      patch: Partial<Pick<Window, 'kind' | 'materialId' | 'sillHeight' | 'height'>>;
    }
  | { type: 'batch'; label: string; commands: Command[] };

export type FurniturePatch = Partial<
  Pick<
    FurnitureItem,
    'position' | 'rotation' | 'dimensions' | 'materialId' | 'color' | 'roomId' | 'name' | 'elevation'
  >
>;

export class CommandError extends Error {}

function mapFloors(apt: Apartment, fn: (f: Floor) => Floor): Apartment {
  return { ...apt, floors: apt.floors.map(fn) };
}

function updateIn<T extends { id: string }>(list: T[], id: string, fn: (x: T) => T, what: string): T[] {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw new CommandError(`${what} ${id} not found`);
  const next = list.slice();
  next[i] = fn(list[i]!);
  return next;
}

const floorWith = (apt: Apartment, pred: (f: Floor) => boolean, what: string): Floor => {
  const f = apt.floors.find(pred);
  if (!f) throw new CommandError(`${what} not found`);
  return f;
};

/** Apply a command, returning a new apartment. Untouched branches keep referential identity. */
export function applyCommand(apt: Apartment, cmd: Command): Apartment {
  switch (cmd.type) {
    case 'furniture/add': {
      const target = floorWith(
        apt,
        (f) => f.rooms.some((r) => r.id === cmd.item.roomId),
        `Room ${cmd.item.roomId}`,
      );
      if (apt.floors.some((f) => f.furniture.some((x) => x.id === cmd.item.id))) {
        throw new CommandError(`Furniture ${cmd.item.id} already exists`);
      }
      return mapFloors(apt, (f) => (f === target ? { ...f, furniture: [...f.furniture, cmd.item] } : f));
    }
    case 'furniture/update': {
      const target = floorWith(apt, (f) => f.furniture.some((x) => x.id === cmd.id), `Furniture ${cmd.id}`);
      return mapFloors(apt, (f) =>
        f === target
          ? { ...f, furniture: updateIn(f.furniture, cmd.id, (x) => ({ ...x, ...cmd.patch }), 'Furniture') }
          : f,
      );
    }
    case 'furniture/remove': {
      const target = floorWith(apt, (f) => f.furniture.some((x) => x.id === cmd.id), `Furniture ${cmd.id}`);
      return mapFloors(apt, (f) =>
        f === target ? { ...f, furniture: f.furniture.filter((x) => x.id !== cmd.id) } : f,
      );
    }
    case 'room/renovate':
    case 'room/rename': {
      const target = floorWith(apt, (f) => f.rooms.some((r) => r.id === cmd.roomId), `Room ${cmd.roomId}`);
      const fn = (r: Room): Room =>
        cmd.type === 'room/rename'
          ? { ...r, name: cmd.name, labelSource: 'user' }
          : { ...r, renovation: { ...r.renovation, ...cmd.patch } };
      return mapFloors(apt, (f) =>
        f === target ? { ...f, rooms: updateIn(f.rooms, cmd.roomId, fn, 'Room') } : f,
      );
    }
    case 'door/update': {
      const target = floorWith(apt, (f) => f.doors.some((d) => d.id === cmd.id), `Door ${cmd.id}`);
      return mapFloors(apt, (f) =>
        f === target
          ? {
              ...f,
              doors: updateIn(
                f.doors,
                cmd.id,
                (d) => ({
                  ...d,
                  ...cmd.patch,
                  // A user-entered measurement is no longer a plan measurement or an assumption.
                  sources: {
                    ...d.sources,
                    ...(cmd.patch.width !== undefined ? { geometry: 'user' as const } : {}),
                    ...(cmd.patch.height !== undefined ? { height: 'user' as const } : {}),
                  },
                }),
                'Door',
              ),
            }
          : f,
      );
    }
    case 'window/update': {
      const target = floorWith(apt, (f) => f.windows.some((w) => w.id === cmd.id), `Window ${cmd.id}`);
      return mapFloors(apt, (f) =>
        f === target
          ? {
              ...f,
              windows: updateIn(
                f.windows,
                cmd.id,
                (w) => ({
                  ...w,
                  ...cmd.patch,
                  sources: {
                    ...w.sources,
                    ...(cmd.patch.sillHeight !== undefined ? { sillHeight: 'user' as const } : {}),
                    ...(cmd.patch.height !== undefined ? { height: 'user' as const } : {}),
                  },
                }),
                'Window',
              ),
            }
          : f,
      );
    }
    case 'batch':
      return cmd.commands.reduce(applyCommand, apt);
  }
}

/** Human-readable label for history/undo menus. */
export function describeCommand(cmd: Command): string {
  switch (cmd.type) {
    case 'furniture/add':
      return `Add ${cmd.item.name}`;
    case 'furniture/remove':
      return 'Delete furniture';
    case 'furniture/update': {
      const keys = Object.keys(cmd.patch);
      if (keys.includes('position')) return 'Move furniture';
      if (keys.includes('rotation')) return 'Rotate furniture';
      if (keys.includes('dimensions')) return 'Resize furniture';
      if (keys.includes('materialId') || keys.includes('color')) return 'Change furniture material';
      return 'Edit furniture';
    }
    case 'room/renovate': {
      const keys = Object.keys(cmd.patch);
      if (keys.some((k) => k.startsWith('floor'))) return 'Change flooring';
      if (keys.some((k) => k.startsWith('wall'))) return 'Change walls';
      if (keys.some((k) => k.startsWith('ceiling'))) return 'Change ceiling';
      if (keys.includes('lighting')) return 'Change lighting';
      return 'Renovate room';
    }
    case 'room/rename':
      return 'Rename room';
    case 'door/update':
      return 'Change door';
    case 'window/update':
      return 'Change window';
    case 'batch':
      return cmd.label;
  }
}
