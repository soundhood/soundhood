// The in-app dropdowns from before the design system, moved unchanged out of App.tsx.
import { useEffect, useRef, useState } from "react";

// In-app dropdown. The native <select> popup is drawn by Windows/WebView2 and
// ignores the app's dark theme (light grey on light grey, unreadable), so we draw our own.
type DropdownProps = {
  value: string;
  options: string[];
  onSelect: (v: string) => void;
  placeholder?: string;
  extra?: { label: string; value: string };
  up?: boolean;
  className?: string;
  title?: string;
};

export function Dropdown({ value, options, onSelect, placeholder, extra, up, className, title }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(v: string) {
    setOpen(false);
    onSelect(v);
  }

  return (
    <div className={`dd ${className ?? ""}`} ref={ref}>
      <button type="button" className={`ddBtn ${open ? "open" : ""}`} title={title} onClick={() => setOpen((o) => !o)}>
        <span className="ddLabel">{value || placeholder || ""}</span>
        <span className="ddChevron">{up ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div className={`ddMenu ${up ? "up" : ""}`}>
          {options.map((o) => (
            <div key={o} className={`ddItem ${o === value ? "active" : ""}`} onClick={() => pick(o)}>
              {o}
            </div>
          ))}
          {extra ? (
            <div className="ddItem ddExtra" onClick={() => pick(extra.value)}>
              {extra.label}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Multi-choice dropdown: stays open while ticking; the button shows a summary.
type MultiDropdownProps = {
  values: string[];
  options: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  title?: string;
  className?: string;
};

export function MultiDropdown({ values, options, onChange, placeholder, title, className }: MultiDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(o: string) {
    onChange(values.includes(o) ? values.filter((v) => v !== o) : [...values, o]);
  }

  const label =
    values.length === 0 ? placeholder : values.length === 1 ? values[0] : `${values.length} playlists`;

  return (
    <div className={`dd ${className ?? ""}`} ref={ref}>
      <button type="button" className={`ddBtn ${open ? "open" : ""} ${values.length ? "hasValues" : ""}`} title={title} onClick={() => setOpen((o) => !o)}>
        <span className="ddLabel">{label}</span>
        <span className="ddChevron">▾</span>
      </button>
      {open ? (
        <div className="ddMenu">
          {options.length === 0 ? <div className="ddItem dimText">No playlists yet</div> : null}
          {options.map((o) => {
            const on = values.includes(o);
            return (
              <div key={o} className={`ddItem ddCheck ${on ? "active" : ""}`} onClick={() => toggle(o)}>
                <span className="ddBox">{on ? "✓" : ""}</span>
                {o}
              </div>
            );
          })}
          {values.length ? (
            <div className="ddItem ddExtra" onClick={() => onChange([])}>Clear</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
