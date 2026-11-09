// Equaliser: three 3 px aqua bars, 14 px tall, the brand's mark for the song that plays. They
// bounce while it plays and stand still while paused or under reduced motion (lists.css).
import { cx } from "../lib/cx";

export interface EqualiserProps {
  paused?: boolean;
  className?: string;
}

export function Equaliser({ paused, className }: EqualiserProps) {
  return (
    <span className={cx("Equaliser", paused && "is-paused", className)} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
