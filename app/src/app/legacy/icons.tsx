// The UI's SVG icons from before the design system, moved unchanged out of App.tsx.

// Shuffle icon: two straight parallel arrows when off, crossing arrows when on.
export function ShuffleIcon({ on }: { on: boolean }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return on ? (
    <svg width="20" height="20" viewBox="0 0 24 24" {...s} aria-hidden="true">
      <path d="M3 7h3.5c1.6 0 3 .8 3.9 2.1L14.6 15c.9 1.3 2.3 2.1 3.9 2.1H21" />
      <path d="M3 17h3.5c1.6 0 3-.8 3.9-2.1l4.2-5.9C15.5 7.8 16.9 7 18.5 7H21" />
      <path d="M18.5 4.5L21 7l-2.5 2.5" />
      <path d="M18.5 14.6L21 17.1l-2.5 2.5" />
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 24 24" {...s} aria-hidden="true">
      <path d="M3 8h18" />
      <path d="M3 16h18" />
      <path d="M18.5 5.5L21 8l-2.5 2.5" />
      <path d="M18.5 13.5L21 16l-2.5 2.5" />
    </svg>
  );
}

export function PlayIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13c0 .8.9 1.3 1.6.9l10-6.5c.6-.4.6-1.3 0-1.7l-10-6.5C8.9 4.2 8 4.7 8 5.5z" />
    </svg>
  );
}
export function PauseIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1.2" />
      <rect x="14" y="5" width="4" height="14" rx="1.2" />
    </svg>
  );
}
export function PrevIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="2.6" height="14" rx="1" />
      <path d="M19 6.2v11.6c0 .8-.9 1.3-1.6.9L9.3 13c-.6-.4-.6-1.4 0-1.8l8.1-5.8c.7-.5 1.6 0 1.6.8z" />
    </svg>
  );
}
export function NextIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 6.2v11.6c0 .8.9 1.3 1.6.9l8.1-5.7c.6-.4.6-1.4 0-1.8L6.6 5.4C5.9 4.9 5 5.4 5 6.2z" />
      <rect x="16.4" y="5" width="2.6" height="14" rx="1" />
    </svg>
  );
}
export function ChevronIcon({ dir, size = 18 }: { dir: "left" | "down"; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === "left" ? <path d="M15 5l-7 7 7 7" /> : <path d="M5 9l7 7 7-7" />}
    </svg>
  );
}
export function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function PencilIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M13.5 6.5l3 3" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}
