// The in-app boxes over the library: delete tracks, delete a playlist, edit tags. Escape closes
// whichever is open.
import { useEffect, useState } from "react";
import type { TagDraft, Track } from "../lib/types";

export type Dialogs = ReturnType<typeof useDialogs>;

export function useDialogs() {
  // Tracks awaiting delete confirmation (the in-app "are you sure" box).
  const [confirmDelete, setConfirmDelete] = useState<Track[] | null>(null);
  // Tag editor (single track).
  const [editTags, setEditTags] = useState<TagDraft | null>(null);
  // Playlist awaiting delete confirmation ("" = none).
  const [confirmDeletePlaylist, setConfirmDeletePlaylist] = useState<string>("");

  // Escape closes whichever box is open.
  useEffect(() => {
    if (!confirmDelete && !editTags && !confirmDeletePlaylist) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setConfirmDelete(null);
        setEditTags(null);
        setConfirmDeletePlaylist("");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmDelete, editTags, confirmDeletePlaylist]);

  return { confirmDelete, setConfirmDelete, editTags, setEditTags, confirmDeletePlaylist, setConfirmDeletePlaylist };
}
