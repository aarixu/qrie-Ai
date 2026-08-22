import type { CSSProperties } from 'react';

/**
 * The app's icon set — hand-rolled SVG paths, one 24x24 viewBox, stroke-based,
 * so every icon matches the chalk line-work of the canvas. No emoji-as-icon
 * anywhere in the product.
 */

interface IconProps {
  size?: number;
  style?: CSSProperties;
}

const svgProps = (size: number, style?: CSSProperties) =>
  ({
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style,
    'aria-hidden': true,
  }) as const;

export function PlayIcon({ size = 20, style }: IconProps) {
  return (
    <svg {...svgProps(size, style)}>
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PauseIcon({ size = 20, style }: IconProps) {
  return (
    <svg {...svgProps(size, style)}>
      <line x1={9} y1={5} x2={9} y2={19} strokeWidth={2.8} />
      <line x1={15} y1={5} x2={15} y2={19} strokeWidth={2.8} />
    </svg>
  );
}

/** Raised hand — the product's one important gesture. */
export function HandIcon({ size = 20, style }: IconProps) {
  return (
    <svg {...svgProps(size, style)} strokeWidth={1.8}>
      <path d="M7.5 11.5V5a1.4 1.4 0 0 1 2.8 0v5.6" />
      <path d="M10.3 10.2V3.6a1.4 1.4 0 0 1 2.8 0v6.6" />
      <path d="M13.1 10.2V4.6a1.4 1.4 0 0 1 2.8 0v7" />
      <path d="M15.9 11.6V7.4a1.4 1.4 0 0 1 2.8 0v6.8a7 7 0 0 1-7 7h-.6a7 7 0 0 1-7-7v-2.4a1.4 1.4 0 0 1 2.8 0" />
    </svg>
  );
}

export function BackIcon({ size = 20, style }: IconProps) {
  return (
    <svg {...svgProps(size, style)}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function SendIcon({ size = 20, style }: IconProps) {
  return (
    <svg {...svgProps(size, style)}>
      <path d="M4 12l16-7-4.5 7L20 19z" />
      <path d="M4 12h11.5" />
    </svg>
  );
}

export function CheckIcon({ size = 20, style }: IconProps) {
  return (
    <svg {...svgProps(size, style)}>
      <path d="M4.5 12.5l5 5L19.5 7" />
    </svg>
  );
}

export function ReplayIcon({ size = 20, style }: IconProps) {
  return (
    <svg {...svgProps(size, style)}>
      <path d="M3.5 8.5A9 9 0 1 1 3 13" />
      <path d="M3.5 3.5v5h5" />
    </svg>
  );
}

export function ChevronIcon({ size = 20, style }: IconProps) {
  return (
    <svg {...svgProps(size, style)} strokeWidth={2.5}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function UserIcon({ size = 20, style }: IconProps) {
  return (
    <svg {...svgProps(size, style)}>
      <circle cx={12} cy={8} r={4} />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

export function FlameIcon({ size = 20, style }: IconProps) {
  return (
    <svg {...svgProps(size, style)}>
      <path d="M12 2.5c1 3-0.5 4.5-1.8 6C8.6 10.3 7 12 7 15a5 5 0 0 0 10 0c0-2.2-1-3.9-2.2-5.4-.6 1.2-1.3 1.9-2.3 2.4.3-2.8-.2-6.5-.5-9.5z" />
    </svg>
  );
}

export function LockIcon({ size = 20, style }: IconProps) {
  return (
    <svg {...svgProps(size, style)}>
      <rect x={5} y={11} width={14} height={9} rx={2} />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </svg>
  );
}

export function HomeIcon({ size = 20, style }: IconProps) {
  return (
    <svg {...svgProps(size, style)}>
      <path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z" />
    </svg>
  );
}
