import { APP_VALIDATION, hasSourcePlan, loadKnownPlan } from '../config/plans';
import { executeIntent } from '../ai/executeIntent';
import { buildIntentContext, type IntentProvider } from '../ai/intents';
import { RuleBasedIntentProvider } from '../ai/ruleBasedProvider';
import { getCatalogItem } from '../catalog/furnitureCatalog';
import { newId } from '../domain/ids';
import { deserializeProject, ProjectLoadError } from '../domain/serialization';
import type { RoomRenovation, Vec2 } from '../domain/types';
import type { Command } from '../editor/commands';
import {
  planAddFurniture,
  planDuplicate,
  planPreset,
  planTransform,
  type TransformRequest,
} from '../editor/operations';
import {
  downloadProject,
  LocalStorageProjectRepository,
  type ProjectRepository,
} from '../persistence/projectRepository';
import { selectFloor, useDocument } from '../state/documentStore';
import { useScene } from '../state/sceneStore';
import { useUi } from '../state/uiStore';

/**
 * UI-facing actions: glue between stores and the pure editing/engine functions.
 * Components call these; they never mutate the model directly.
 */

const furnitureId = () => newId('furniture');
const toast = (tone: Parameters<ReturnType<typeof useUi.getState>['toast']>[0], msg: string) =>
  useUi.getState().toast(tone, msg);

function dispatch(cmd: Command, coalesceKey?: string): boolean {
  const res = useDocument.getState().dispatch(cmd, coalesceKey ? { coalesceKey } : undefined);
  if (!res.ok) toast('error', res.error ?? 'Edit rejected.');
  return res.ok;
}

/** Room an "add" goes to: the selected room, the selected item's room, or the best match by type. */
export function targetRoomFor(catalogId: string): string | undefined {
  const floor = selectFloor(useDocument.getState());
  const sel = useScene.getState().selection;
  if (sel?.kind === 'room') return sel.id;
  if (sel?.kind === 'furniture') return floor.furniture.find((f) => f.id === sel.id)?.roomId;
  const types = getCatalogItem(catalogId)?.placement.roomTypes ?? [];
  return (
    floor.rooms.find((r) => types.includes(r.type))?.id ?? floor.rooms.find((r) => r.type !== 'storage')?.id
  );
}

export function addFurniture(
  catalogId: string,
  roomId: string | undefined,
  opts: { materialId?: string; color?: string } = {},
): void {
  const floor = selectFloor(useDocument.getState());
  const room = roomId ?? targetRoomFor(catalogId);
  if (!room) return toast('warning', 'Select a room first.');
  const { command, result } = planAddFurniture(
    floor,
    room,
    {
      catalogId,
      ...(opts.materialId ? { materialId: opts.materialId } : {}),
      ...(opts.color ? { color: opts.color } : {}),
    },
    useScene.getState().constraints,
    furnitureId,
  );
  if (!command || !result.item) return toast('warning', result.reason ?? 'Could not place that item.');
  if (dispatch(command)) {
    useScene.getState().select({ kind: 'furniture', id: result.item.id });
    const soft = result.issues.length ? ` Note: ${result.issues[0]!.message}` : '';
    toast('success', `Added ${result.item.name.toLowerCase()}.${soft}`);
  }
}

export function transformFurniture(id: string, req: TransformRequest, coalesceKey?: string): boolean {
  const floor = selectFloor(useDocument.getState());
  const { command, result } = planTransform(floor, id, req, useScene.getState().constraints);
  if (!command) {
    const blocking = result?.issues.find((i) => useScene.getState().constraints.blocking.includes(i.code));
    toast('warning', blocking?.message ?? 'That change is not allowed here.');
    return false;
  }
  return dispatch(command, coalesceKey);
}

export function rotateFurniture(id: string, deltaRad: number): void {
  const item = selectFloor(useDocument.getState()).furniture.find((f) => f.id === id);
  if (item) transformFurniture(id, { rotation: item.rotation + deltaRad });
}

export function nudgeFurniture(id: string, delta: Vec2): void {
  const item = selectFloor(useDocument.getState()).furniture.find((f) => f.id === id);
  if (item)
    transformFurniture(
      id,
      {
        position: { x: +(item.position.x + delta.x).toFixed(3), z: +(item.position.z + delta.z).toFixed(3) },
      },
      `nudge-${id}`,
    );
}

export function duplicateFurniture(id: string): void {
  const { command, result } = planDuplicate(
    selectFloor(useDocument.getState()),
    id,
    useScene.getState().constraints,
    furnitureId,
  );
  if (!command) return toast('warning', result?.reason ?? 'No space for a copy.');
  if (dispatch(command) && command.type === 'furniture/add')
    useScene.getState().select({ kind: 'furniture', id: command.item.id });
}

export function removeFurniture(id: string): void {
  if (dispatch({ type: 'furniture/remove', id })) useScene.getState().select(null);
}

export function updateFurniture(
  id: string,
  patch: { materialId?: string; color?: string; name?: string },
): void {
  dispatch({ type: 'furniture/update', id, patch });
}

/** Renovate a room. Door/window finishes also update every door/window of that room. */
export function renovateRoom(roomId: string, patch: Partial<RoomRenovation>): void {
  const floor = selectFloor(useDocument.getState());
  const room = floor.rooms.find((r) => r.id === roomId);
  if (!room) return;
  const commands: Command[] = [{ type: 'room/renovate', roomId, patch }];
  if (patch.doorMaterialId) {
    for (const id of room.doorIds)
      commands.push({ type: 'door/update', id, patch: { materialId: patch.doorMaterialId } });
  }
  if (patch.windowMaterialId) {
    for (const id of room.windowIds)
      commands.push({ type: 'window/update', id, patch: { materialId: patch.windowMaterialId } });
  }
  dispatch(commands.length === 1 ? commands[0]! : { type: 'batch', label: 'Renovate room', commands });
}

export function applyPreset(presetId: string, roomIds: string[]): void {
  const cmd = planPreset(useDocument.getState().apartment, presetId, roomIds);
  if (cmd && dispatch(cmd)) toast('success', `Applied ${cmd.type === 'batch' ? cmd.label : 'style'}.`);
}

export function renameRoom(roomId: string, name: string): void {
  if (name.trim()) dispatch({ type: 'room/rename', roomId, name: name.trim() });
}

export function dispatchCommand(cmd: Command): boolean {
  return dispatch(cmd);
}

// ── Persistence ──────────────────────────────────────────────────────────────────
let repo: ProjectRepository | null = null;
const repository = () => (repo ??= new LocalStorageProjectRepository(window.localStorage, APP_VALIDATION));

export async function saveProject(): Promise<void> {
  try {
    await repository().save(useDocument.getState().apartment);
    useDocument.getState().markSaved();
    useUi.getState().setSaveDialog('saved');
  } catch (e) {
    toast('error', `Save failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * On start-up, reopen the user's saved work for the current plan (validated and migrated),
 * so "save → reload" keeps the state. Corrupt or incompatible saves are reported and ignored.
 */
let restoreStarted = false;
export async function restoreSavedSession(): Promise<void> {
  if (restoreStarted) return; // StrictMode runs mount effects twice in development
  restoreStarted = true;
  let saved;
  try {
    saved = (await repository().list()).find((m) => m.id === useDocument.getState().apartment.id);
  } catch {
    return;
  }
  if (!saved) return;
  try {
    useDocument.getState().load(await repository().load(saved.id));
    toast(
      'info',
      `Restored your plan saved ${new Date(saved.savedAt).toLocaleString()}. "Cancel" returns to it; reload the plan from the Model tab to start over.`,
    );
  } catch (e) {
    toast(
      'warning',
      `Your saved plan could not be restored (${e instanceof Error ? e.message : String(e)}). Starting from the floor plan.`,
    );
  }
}

/** Discard everything and rebuild the model from its source plan. */
export function resetToSourcePlan(): void {
  const id = useDocument.getState().apartment.id;
  if (!hasSourcePlan(id)) {
    toast(
      'warning',
      'The source plan of this model is not available in this session (uploaded images are not stored). Import the image again to rebuild.',
    );
    return;
  }
  useDocument.getState().load(loadKnownPlan(id));
  useScene.getState().select(null);
  toast('info', 'Rebuilt the model from the floor plan. Save to keep this as your plan.');
}

export async function loadSavedProject(): Promise<void> {
  try {
    const list = await repository().list();
    if (!list[0]) return toast('info', 'No saved project yet.');
    useDocument.getState().load(await repository().load(list[0].id));
    useScene.getState().select(null);
    toast('success', `Loaded project saved ${new Date(list[0].savedAt).toLocaleString()}.`);
  } catch (e) {
    toast('error', e instanceof Error ? e.message : String(e));
  }
}

export async function importProjectFile(file: File): Promise<void> {
  try {
    const { apartment } = deserializeProject(await file.text(), undefined, APP_VALIDATION);
    useDocument.getState().load(apartment);
    useScene.getState().select(null);
    toast('success', `Imported ${apartment.metadata.name}.`);
  } catch (e) {
    const detail =
      e instanceof ProjectLoadError && e.issues.length
        ? ` ${e.issues
            .filter((i) => i.severity === 'error')
            .slice(0, 2)
            .map((i) => i.message)
            .join(' ')}`
        : '';
    toast('error', `${e instanceof Error ? e.message : String(e)}${detail}`);
  }
}

export function exportProject(): void {
  downloadProject(useDocument.getState().apartment);
}

// ── Assistant ────────────────────────────────────────────────────────────────────
let provider: IntentProvider = new RuleBasedIntentProvider();

/** Swap in another intent source (e.g. an LLM-backed provider) without touching the UI. */
export function setIntentProvider(p: IntentProvider): void {
  provider = p;
}

export async function askAssistant(text: string): Promise<void> {
  const ui = useUi.getState();
  ui.addMessage({ role: 'user', text });
  const apartment = useDocument.getState().apartment;
  const sel = useScene.getState().selection;
  const floor = selectFloor(useDocument.getState());
  const selectedRoomId =
    sel?.kind === 'room'
      ? sel.id
      : sel?.kind === 'furniture'
        ? floor.furniture.find((f) => f.id === sel.id)?.roomId
        : undefined;
  const intents = await provider.parse(text, buildIntentContext(apartment, selectedRoomId));
  if (!intents.length) return ui.addMessage({ role: 'assistant', text: 'Could you rephrase that?' });

  for (const intent of intents) {
    const result = executeIntent(intent, {
      apartment: useDocument.getState().apartment,
      constraints: useScene.getState().constraints,
      newId: furnitureId,
    });
    if (result.command) dispatch(result.command);
    if ('roomId' in intent && intent.roomId) useScene.getState().select({ kind: 'room', id: intent.roomId });
    if ('roomIds' in intent && intent.roomIds.length === 1)
      useScene.getState().select({ kind: 'room', id: intent.roomIds[0]! });
    ui.addMessage({
      role: 'assistant',
      text: result.reply,
      intents: [intent],
      ...(result.suggestion ? { suggestion: result.suggestion } : {}),
    });
  }
}
