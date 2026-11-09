// Track selection. Single click selects (highlight only); double click plays. Selection is what
// "Move selected" acts on. Multi-select: a set of paths. Click = single, Ctrl+click = toggle,
// Shift+click = range, Ctrl+A = all listed; on the phone, "Select" mode ticks rows instead.
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { Track } from "../lib/types";

export type Selection = ReturnType<typeof useSelection>;

export function useSelection({ filteredTracks }: { filteredTracks: Track[] }) {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<string>("");

  function toggleRow(t: Track) {
    setSelectedPaths((prev) => {
      const n = new Set(prev);
      if (n.has(t.path)) n.delete(t.path); else n.add(t.path);
      return n;
    });
  }

  // Selected tracks in list order (only those currently listed count).
  const selectedTracks = useMemo(
    () => (selectedPaths.size ? filteredTracks.filter((t) => selectedPaths.has(t.path)) : []),
    [filteredTracks, selectedPaths]
  );
  const selectedTrack = selectedTracks.length === 1 ? selectedTracks[0] : null;

  function onRowClick(e: ReactMouseEvent, t: Track) {
    const paths = filteredTracks.map((x) => x.path);
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && anchorRef.current) {
        const a = paths.indexOf(anchorRef.current);
        const b = paths.indexOf(t.path);
        if (a >= 0 && b >= 0) {
          if (!e.ctrlKey && !e.metaKey) next.clear();
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(paths[i]);
          return next;
        }
      }
      if (e.ctrlKey || e.metaKey) {
        if (next.has(t.path)) next.delete(t.path);
        else next.add(t.path);
      } else if (next.size === 1 && next.has(t.path)) {
        next.clear();
      } else {
        next.clear();
        next.add(t.path);
      }
      anchorRef.current = t.path;
      return next;
    });
  }

  // Ctrl+A selects everything listed (unless typing in a field); Escape clears the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelectedPaths(new Set(filteredTracks.map((t) => t.path)));
      } else if (e.key === "Escape") {
        setSelectedPaths(new Set());
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filteredTracks]);

  return { selectedPaths, setSelectedPaths, selectedTracks, selectedTrack, toggleRow, onRowClick };
}
