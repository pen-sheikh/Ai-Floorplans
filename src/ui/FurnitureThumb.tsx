import type { FurnitureCategory } from '../domain/types';

/** Shade a #rrggbb colour by a factor (<1 darker, >1 lighter). */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/** Front-view illustration used on catalog cards (no image assets required). */
export function FurnitureThumb({ category, color }: { category: FurnitureCategory; color: string }) {
  const main = color;
  const dark = shade(color, 0.78);
  const leg = '#5b4030';
  let art: React.ReactNode;
  switch (category) {
    case 'sofa':
      art = (
        <>
          <rect x="22" y="30" width="116" height="30" rx="8" fill={dark} />
          <rect x="16" y="44" width="128" height="22" rx="7" fill={main} />
          <rect x="12" y="38" width="18" height="30" rx="7" fill={dark} />
          <rect x="130" y="38" width="18" height="30" rx="7" fill={dark} />
          <rect x="32" y="46" width="47" height="10" rx="4" fill={shade(color, 1.06)} />
          <rect x="81" y="46" width="47" height="10" rx="4" fill={shade(color, 1.06)} />
          <rect x="20" y="68" width="4" height="8" fill={leg} />
          <rect x="136" y="68" width="4" height="8" fill={leg} />
        </>
      );
      break;
    case 'armchair':
      art = (
        <>
          <rect x="50" y="18" width="60" height="40" rx="9" fill={dark} />
          <rect x="44" y="46" width="72" height="20" rx="7" fill={main} />
          <rect x="38" y="36" width="16" height="32" rx="7" fill={dark} />
          <rect x="106" y="36" width="16" height="32" rx="7" fill={dark} />
          <rect x="46" y="68" width="4" height="10" fill={leg} />
          <rect x="110" y="68" width="4" height="10" fill={leg} />
        </>
      );
      break;
    case 'bed':
      art = (
        <>
          <rect x="22" y="14" width="116" height="44" rx="6" fill={dark} />
          <rect x="18" y="50" width="124" height="18" rx="4" fill="#a7835c" />
          <rect x="22" y="40" width="116" height="14" rx="5" fill="#f4f2ee" />
          <rect x="34" y="32" width="38" height="12" rx="5" fill="#ffffff" />
          <rect x="88" y="32" width="38" height="12" rx="5" fill="#ffffff" />
          <rect x="22" y="46" width="116" height="10" rx="4" fill={main} />
        </>
      );
      break;
    case 'dining-table':
    case 'desk':
    case 'coffee-table': {
      const top = category === 'coffee-table' ? 46 : 30;
      art = (
        <>
          <rect x="18" y={top} width="124" height="7" rx="2" fill={main} />
          <rect x="26" y={top + 7} width="6" height={74 - top} fill={dark} />
          <rect x="128" y={top + 7} width="6" height={74 - top} fill={dark} />
        </>
      );
      break;
    }
    case 'dining-chair':
    case 'office-chair':
      art = (
        <>
          <rect x="62" y="14" width="36" height="34" rx="5" fill={dark} />
          <rect x="56" y="46" width="48" height="9" rx="3" fill={main} />
          <rect x="62" y="55" width="4" height="22" fill={leg} />
          <rect x="94" y="55" width="4" height="22" fill={leg} />
        </>
      );
      break;
    case 'tv-unit':
      art = (
        <>
          <rect x="44" y="8" width="72" height="40" rx="2" fill="#151617" />
          <rect x="74" y="48" width="12" height="5" fill="#151617" />
          <rect x="18" y="53" width="124" height="22" rx="2" fill={main} />
          <path d="M59 53v22M101 53v22" stroke={dark} />
        </>
      );
      break;
    case 'wardrobe':
    case 'bookshelf':
    case 'cabinet':
    case 'bedside-table': {
      const tall = category === 'wardrobe' || category === 'bookshelf';
      const y = tall ? 6 : category === 'cabinet' ? 34 : 40;
      const w = category === 'bedside-table' ? 44 : tall ? 64 : 110;
      const x = 80 - w / 2;
      art = (
        <>
          <rect x={x} y={y} width={w} height={78 - y} rx="2" fill={main} stroke={dark} />
          {category === 'bookshelf' ? (
            [22, 38, 54].map((sy) => <rect key={sy} x={x + 3} y={sy} width={w - 6} height="3" fill={dark} />)
          ) : (
            <path d={`M80 ${y + 4}V74`} stroke={dark} />
          )}
        </>
      );
      break;
    }
    case 'rug':
      art = <ellipse cx="80" cy="56" rx="64" ry="16" fill={main} stroke={dark} strokeDasharray="3 3" />;
      break;
    case 'lamp':
      art = (
        <>
          <path d="M66 10h28l8 20H58z" fill="#f3efe6" stroke="#cfc6b6" />
          <rect x="78" y="30" width="4" height="42" fill={dark} />
          <ellipse cx="80" cy="74" rx="16" ry="4" fill={dark} />
        </>
      );
      break;
    case 'plant':
      art = (
        <>
          <ellipse cx="80" cy="30" rx="30" ry="24" fill="#4f7a45" />
          <ellipse cx="66" cy="38" rx="16" ry="14" fill="#5f8d53" />
          <path d="M66 52h28l-4 24H70z" fill="#f2f0eb" stroke="#d8d4cc" />
        </>
      );
      break;
  }
  return (
    <svg viewBox="0 0 160 84" width="70%" height="78%" aria-hidden="true">
      <ellipse cx="80" cy="78" rx="66" ry="4" fill="rgba(0,0,0,0.08)" />
      {art}
    </svg>
  );
}
