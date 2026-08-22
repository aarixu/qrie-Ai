import type { CSSProperties, ReactNode } from 'react';
import { theme, chunky, outlined } from './theme';

interface ButtonProps {
  children: ReactNode;
  onClick?(): void;
  disabled?: boolean;
  variant?: 'green' | 'blue' | 'red' | 'outline';
  style?: CSSProperties;
  'aria-label'?: string;
}

const FILLS = {
  green: [theme.green, theme.greenDark],
  blue: [theme.blue, theme.blueDark],
  red: [theme.red, '#d63b3b'],
} as const;

/**
 * The app's one button. Chunky press-down primary in three colors, plus the
 * white outlined secondary. Disabled always renders the gray slab — one look
 * for "not now" everywhere.
 */
export function Button({ children, onClick, disabled, variant = 'green', style, ...aria }: ButtonProps) {
  const base: CSSProperties = disabled
    ? { ...chunky('#e5e5e5', '#d0d0d0'), color: theme.textFaint, cursor: 'default' }
    : variant === 'outline'
      ? outlined()
      : chunky(FILLS[variant][0], FILLS[variant][1]);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      {...aria}
      style={{
        minHeight: 48,
        padding: '10px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 9,
        ...base,
        ...style,
      }}
    >
      {children}
    </button>
  );
}
