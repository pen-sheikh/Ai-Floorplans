import { useState } from 'react';
import { addFurniture } from '../../app/actions';
import { searchCatalog, type FurnitureCatalogItem } from '../../catalog/furnitureCatalog';
import { effectiveColor, getMaterialDef } from '../../catalog/materials';
import { selectFloor, useDocument } from '../../state/documentStore';
import { useScene } from '../../state/sceneStore';
import { useUi } from '../../state/uiStore';
import { FurnitureThumb } from '../FurnitureThumb';
import { IconSearch } from '../icons';

export function FurniturePanel() {
  const query = useUi((s) => s.furnitureQuery);
  const setQuery = useUi((s) => s.setFurnitureQuery);
  const rooms = useDocument((s) => selectFloor(s).rooms);
  const selection = useScene((s) => s.selection);
  const [chosenRoom, setChosenRoom] = useState<string>('');
  const selectedRoom = selection?.kind === 'room' ? selection.id : '';
  // The selected room wins; otherwise the user's explicit choice; otherwise auto by item type.
  const target = selectedRoom || chosenRoom;
  const items = searchCatalog(query);

  return (
    <>
      <div>
        <h2>Plan your room</h2>
        <p className="muted" style={{ margin: '2px 0 0' }}>
          Select a furniture to add that.
        </p>
      </div>
      <label className="field">
        <span>Add to</span>
        <select
          className="select"
          value={target}
          onChange={(e) => {
            setChosenRoom(e.target.value);
            if (e.target.value) useScene.getState().select({ kind: 'room', id: e.target.value });
          }}
        >
          <option value="">Best matching room</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label className="search">
        <IconSearch size={16} />
        <input
          placeholder="Search furniture"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search furniture"
        />
      </label>
      <div className="scroll">
        {items.length === 0 && <p className="muted">No furniture matches "{query}".</p>}
        {items.map((item) => (
          <FurnitureCard key={item.id} item={item} roomId={target || undefined} />
        ))}
      </div>
    </>
  );
}

function FurnitureCard({ item, roomId }: { item: FurnitureCatalogItem; roomId: string | undefined }) {
  const [materialId, setMaterialId] = useState(item.defaultMaterialId);
  const { width, depth, height } = item.dimensions;
  return (
    <article className="furniture-card">
      <button
        className="furniture-card__thumb"
        onClick={() => addFurniture(item.id, roomId, { materialId })}
        aria-label={`Add ${item.name}`}
      >
        <FurnitureThumb category={item.category} color={effectiveColor(materialId)} />
        <span className="furniture-card__add">+ Add</span>
      </button>
      <div className="furniture-card__meta">
        <strong>{item.name}</strong>
        <span className="muted small">
          {width.toFixed(2)} × {depth.toFixed(2)} × {height.toFixed(2)} m
        </span>
      </div>
      {item.materialOptions.length > 1 && (
        <div className="swatches" role="group" aria-label={`${item.name} finish`}>
          {item.materialOptions.slice(0, 5).map((id) => (
            <button
              key={id}
              className="swatch"
              style={{ background: effectiveColor(id) }}
              aria-pressed={materialId === id}
              title={getMaterialDef(id)?.name}
              aria-label={getMaterialDef(id)?.name}
              onClick={() => setMaterialId(id)}
            />
          ))}
        </div>
      )}
    </article>
  );
}
