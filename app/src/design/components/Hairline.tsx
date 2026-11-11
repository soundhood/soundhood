// Hairline: a 2 px aqua line scaled by the playing position, on the mini player's top edge. The
// position is read with requestAnimationFrame from getProgress() (0..1) and written as --progress;
// there is no CSS transition. The loop stops while the line is not on screen (another layout, a
// hidden tab) and starts again when it is.
import { useEffectEvent, useLayoutEffect, useRef } from "react";
import { clamp, cx } from "../lib/cx";

export interface HairlineProps {
  /** The playing position as a fraction, read once per frame. */
  getProgress: () => number;
  className?: string;
}

export function Hairline({ getProgress, className }: HairlineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const read = useEffectEvent(() => {
    const p = getProgress();
    return Number.isFinite(p) ? clamp(p, 0, 1) : 0;
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let onScreen = true;
    const paint = () => el.style.setProperty("--progress", String(read()));
    const loop = () => {
      paint();
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (!raf && onScreen && !document.hidden) raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const io = new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
      if (onScreen) start();
      else stop();
    });
    const onVisibility = () => (document.hidden ? stop() : start());
    paint();
    io.observe(el);
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      stop();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <div ref={ref} className={cx("Hairline", className)} aria-hidden="true" />;
}
