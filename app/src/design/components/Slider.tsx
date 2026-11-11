// Slider: a range input drawn from scratch (controls.css). Controlled: `value` comes from the owner,
// but while the user drags, the slider shows the drag and ignores new values from outside, so a
// position that keeps ticking from playback never makes the knob jitter under the finger.
// onChange fires while dragging and on every key step; onCommit fires on release and after a key
// step. Arrow keys move by `keyStep` (5 s for position, 5 % for volume), Home and End jump to the
// ends; with Ctrl, Alt or Meta held the arrows are left to the app's own shortcuts.
import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { clamp, cssVars, cx } from "../lib/cx";

export interface SliderProps {
  value: number;
  min?: number;
  max: number;
  /** Pointer granularity; any value by default. */
  step?: number;
  /** Arrow-key step, in the slider's own unit. */
  keyStep: number;
  /** What the slider sets ("Position", "Volume"). */
  label: string;
  /** Spoken value, e.g. "1:12 of 2:52". */
  valueText?: (value: number) => string;
  onChange?: (value: number) => void;
  onCommit?: (value: number) => void;
  disabled?: boolean;
  className?: string;
}

export function Slider({
  value,
  min = 0,
  max,
  step,
  keyStep,
  label,
  valueText,
  onChange,
  onCommit,
  disabled,
  className,
}: SliderProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = clamp(drag ?? value, min, max);
  const percent = max > min ? ((shown - min) / (max - min)) * 100 : 0;

  // The native change event is the release: commit the value the input holds now.
  const release = useEffectEvent(() => {
    const el = ref.current;
    if (!el) return;
    const v = Number(el.value);
    setDrag(null);
    onCommit?.(v);
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onNativeChange = () => release();
    el.addEventListener("change", onNativeChange);
    return () => el.removeEventListener("change", onNativeChange);
  }, []);

  // A drag that ends where it started fires no change event: stop ignoring outside values anyway.
  const endDrag = () => {
    const up = () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setTimeout(() => setDrag(null), 0);
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const arrow = e.key.startsWith("Arrow");
    if (arrow && (e.ctrlKey || e.altKey || e.metaKey)) {
      e.preventDefault();
      return;
    }
    let next: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = shown - keyStep;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = shown + keyStep;
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    if (next === null) return;
    e.preventDefault();
    next = clamp(next, min, max);
    onChange?.(next);
    onCommit?.(next);
  };

  return (
    <input
      ref={ref}
      type="range"
      className={cx("Slider", drag !== null && "is-dragging", className)}
      min={min}
      max={max}
      step={step ?? "any"}
      value={shown}
      disabled={disabled}
      aria-label={label}
      aria-valuetext={valueText?.(shown)}
      style={cssVars({ "--percent": `${percent}%` })}
      onPointerDown={endDrag}
      onKeyDown={onKeyDown}
      onChange={(e) => {
        const v = Number(e.currentTarget.value);
        setDrag(v);
        onChange?.(v);
      }}
    />
  );
}

export interface SliderRowProps {
  /** The time before the slider (elapsed). */
  start: ReactNode;
  /** The time after it (length). */
  end: ReactNode;
  /** The full player's layout: the slider on top, the two times under it. */
  stacked?: boolean;
  children: ReactNode;
  className?: string;
}

/** A slider with its two times in caption tabular figures. */
export function SliderRow({ start, end, stacked, children, className }: SliderRowProps) {
  return (
    <div className={cx("SliderRow", stacked && "is-stacked", className)}>
      {stacked && children}
      <span className="SliderRow-start">{start}</span>
      {!stacked && children}
      <span className="SliderRow-end">{end}</span>
    </div>
  );
}
