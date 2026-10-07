import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base(paths: React.ReactNode, { size = 18, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths}
    </svg>
  );
}

export const IconArrowLeft = (p: IconProps) => base(<path d="M19 12H5m6-6-6 6 6 6" />, p);
export const IconSearch = (p: IconProps) =>
  base(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>,
    p,
  );
export const IconBell = (p: IconProps) =>
  base(
    <>
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>,
    p,
  );
export const IconHeart = (p: IconProps) =>
  base(
    <path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z" />,
    p,
  );
export const IconPlus = (p: IconProps) => base(<path d="M12 5v14M5 12h14" />, p);
export const IconMinus = (p: IconProps) => base(<path d="M5 12h14" />, p);
export const IconUndo = (p: IconProps) =>
  base(
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </>,
    p,
  );
export const IconRedo = (p: IconProps) =>
  base(
    <>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </>,
    p,
  );
export const IconDownload = (p: IconProps) =>
  base(
    <>
      <path d="M12 3v12m-5-5 5 5 5-5" />
      <path d="M5 21h14" />
    </>,
    p,
  );
export const IconUpload = (p: IconProps) =>
  base(
    <>
      <path d="M12 21V9m-5 5 5-5 5 5" />
      <path d="M5 3h14" />
    </>,
    p,
  );
export const IconPlan = (p: IconProps) =>
  base(
    <>
      <path d="M3 3h18v18H3z" />
      <path d="M3 12h8v9M11 3v5M15 12h6" />
    </>,
    p,
  );
export const IconCube = (p: IconProps) =>
  base(
    <>
      <path d="m12 2 9 5v10l-9 5-9-5V7z" />
      <path d="m3 7 9 5 9-5M12 12v10" />
    </>,
    p,
  );
export const IconSplit = (p: IconProps) =>
  base(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </>,
    p,
  );
export const IconCamera = (p: IconProps) =>
  base(
    <>
      <path d="M3 7h4l2-3h6l2 3h4v13H3z" />
      <circle cx="12" cy="13" r="4" />
    </>,
    p,
  );
export const IconTop = (p: IconProps) =>
  base(
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M12 8v8M8 12h8" />
    </>,
    p,
  );
export const IconDoor = (p: IconProps) =>
  base(
    <>
      <path d="M5 21V3h11v18" />
      <path d="M3 21h18M13 12h.01" />
    </>,
    p,
  );
export const IconBuilding = (p: IconProps) =>
  base(
    <>
      <path d="M4 21V5l8-3 8 3v16" />
      <path d="M9 21v-5h6v5M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01" />
    </>,
    p,
  );
export const IconReset = (p: IconProps) =>
  base(
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </>,
    p,
  );
export const IconCeiling = (p: IconProps) =>
  base(
    <>
      <path d="M3 6h18" />
      <path d="M7 6v3M12 6v5M17 6v3" />
      <path d="M5 20h14" />
    </>,
    p,
  );
export const IconLayers = (p: IconProps) =>
  base(
    <>
      <path d="m12 2 10 5-10 5L2 7z" />
      <path d="m2 17 10 5 10-5M2 12l10 5 10-5" />
    </>,
    p,
  );
export const IconRuler = (p: IconProps) =>
  base(
    <>
      <path d="M3 17 17 3l4 4L7 21z" />
      <path d="m7 13 2 2M10 10l2 2M13 7l2 2" />
    </>,
    p,
  );
export const IconSun = (p: IconProps) =>
  base(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>,
    p,
  );
export const IconMoon = (p: IconProps) => base(<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z" />, p);
export const IconLamp = (p: IconProps) =>
  base(
    <>
      <path d="M8 2h8l3 8H5z" />
      <path d="M12 10v9M8 22h8" />
    </>,
    p,
  );
export const IconBug = (p: IconProps) =>
  base(
    <>
      <rect x="8" y="6" width="8" height="14" rx="4" />
      <path d="M12 20v-9M3 13h5M16 13h5M4 7l4 2M20 7l-4 2M4 19l4-2M20 19l-4-2M9 6a3 3 0 0 1 6 0" />
    </>,
    p,
  );
export const IconX = (p: IconProps) => base(<path d="M18 6 6 18M6 6l12 12" />, p);
export const IconSend = (p: IconProps) =>
  base(
    <>
      <path d="m22 2-7 20-4-9-9-4z" />
      <path d="M22 2 11 13" />
    </>,
    p,
  );
export const IconRotateCw = (p: IconProps) =>
  base(
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </>,
    p,
  );
export const IconRotateCcw = (p: IconProps) =>
  base(
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </>,
    p,
  );
export const IconCopy = (p: IconProps) =>
  base(
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </>,
    p,
  );
export const IconTrash = (p: IconProps) =>
  base(
    <>
      <path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15" />
    </>,
    p,
  );
export const IconSparkles = (p: IconProps) =>
  base(
    <>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M19 3v4M17 5h4" />
    </>,
    p,
  );
export const IconChat = (p: IconProps) =>
  base(<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12Z" />, p);
export const IconCheck = (p: IconProps) => base(<path d="m5 12 5 5L20 7" />, p);
export const IconPointer = (p: IconProps) =>
  base(
    <>
      <path d="M9 11V4.5a1.5 1.5 0 0 1 3 0V10" />
      <path d="M12 10V8.5a1.5 1.5 0 0 1 3 0V11M15 11a1.5 1.5 0 0 1 3 0v3a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3 16.5a1.5 1.5 0 0 1 2.3-2L9 17v-6" />
    </>,
    p,
  );

export function ArrowGlyph({ dir }: { dir: 'up' | 'down' | 'left' | 'right' }) {
  const rot = { up: 0, right: 90, down: 180, left: 270 }[dir];
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ transform: `rotate(${rot}deg)` }}
    >
      <path d="M12 3 5 11h4.5v10h5V11H19z" fill="#f5b70f" />
    </svg>
  );
}

export function BrandMark() {
  return (
    <svg width="22" height="26" viewBox="0 0 22 26" aria-hidden="true">
      <path
        d="M3 25V3h9a7 7 0 0 1 0 14H8"
        stroke="#fcca54"
        strokeWidth="4.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.4" fill="#fcca54" />
    </svg>
  );
}
