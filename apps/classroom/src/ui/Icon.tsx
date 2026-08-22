/**
 * Material Symbols, the icon set the Stitch designs are drawn with. One
 * component so every icon in the app is sized and filled the same way, and so a
 * pasted Stitch screen only needs its span swapped for this.
 */
export function Icon({
  name,
  filled = false,
  className = '',
}: {
  /** Material Symbols name, e.g. "play_arrow", "science". */
  name: string;
  filled?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`material-symbols-outlined ${filled ? 'filled' : ''} ${className}`}
    >
      {name}
    </span>
  );
}
