// The dialogs over the library: delete tracks, delete a playlist, edit tags. Each is a Sheet
// (features/dialogs, features/tags), which closes itself on Esc and returns focus to what opened it.
import { useState } from "react";
import type { TagDraft, Track } from "../lib/types";

export type Dialogs = ReturnType<typeof useDialogs>;

export function useDialogs() {
  // Tracks awaiting delete confirmation (the in-app "are you sure" box).
  const [confirmDelete, setConfirmDelete] = useState<Track[] | null>(null);
  // Tag editor (single track).
  const [editTags, setEditTags] = useState<TagDraft | null>(null);
  // Playlist awaiting delete confirmation ("" = none).
  const [confirmDeletePlaylist, setConfirmDeletePlaylist] = useState<string>("");

  return { confirmDelete, setConfirmDelete, editTags, setEditTags, confirmDeletePlaylist, setConfirmDeletePlaylist };
}
