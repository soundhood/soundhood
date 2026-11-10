// The sheets any screen opens for a set of songs: Add to playlist (with New playlist), New playlist
// (a name; then the songs, if any, are added to it) and Move to folder. They call the existing
// playlist and file calls; the shell mounts them in its overlays slot (app/Overlays.tsx).
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, Icon, ListRow, Mosaic, Sheet, TextField, Thumb } from "../../design";
import { useApp } from "../../app/context";
import { useMosaics } from "../../hooks/useCovers";
import type { Track } from "../../lib/types";
import { folderLabel, songCount, songsMeta } from "../library/trackInfo";
import { usePlaylistEdits } from "./usePlaylistEdits";

interface PickItem {
  id: string;
  name: string;
  meta?: string;
  thumb: ReactNode;
  onPick: () => void;
}

/** Rows to choose one from: a tap, a click, Enter or Space picks. */
function PickList({ label, items }: { label: string; items: readonly PickItem[] }) {
  const onKey = (e: KeyboardEvent, item: PickItem) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      item.onPick();
    }
  };
  return (
    <div className="PickList" role="listbox" aria-label={label}>
      {items.map((item) => (
        <ListRow
          key={item.id}
          tabIndex={0}
          thumb={item.thumb}
          name={item.name}
          meta={item.meta}
          onClick={item.onPick}
          onKeyDown={(e) => onKey(e, item)}
        />
      ))}
    </div>
  );
}

const plusThumb = (
  <span className="Thumb is-icon" aria-hidden="true">
    <Icon name="plus" size={20} />
  </span>
);

export function AddToPlaylistSheet({ tracks, onClose }: { tracks: Track[]; onClose: () => void }) {
  const { lib, actions } = useApp();
  const edits = usePlaylistEdits();
  // Playlists that already hold every one of the songs are not offered (as before).
  const shown = lib.playlistFiles.filter((p) => !tracks.every((t) => lib.inPlaylist(p, t)));
  const tracksOf = (name: string) => lib.tracksOfPlaylist.get(name) ?? [];
  const covers = useMosaics(shown.map((p) => tracksOf(p.name).map((t) => t.path)));
  const items: PickItem[] = [
    { id: "\u0000new", name: "New playlist", thumb: plusThumb, onPick: () => actions.newPlaylist(tracks) },
    ...shown.map((p, i) => ({
      id: p.name,
      name: p.name,
      meta: songsMeta(tracksOf(p.name)),
      thumb: <Mosaic covers={covers[i]} small />,
      onPick: () => {
        onClose();
        void edits.add(p.name, tracks);
      },
    })),
  ];
  return (
    <Sheet open onClose={onClose} title={tracks.length === 1 ? "Add to playlist" : `Add ${songCount(tracks.length)} to a playlist`}>
      <PickList label="Playlists" items={items} />
    </Sheet>
  );
}

export function NewPlaylistSheet({ tracks, onClose }: { tracks: Track[]; onClose: () => void }) {
  const { playlists, nav, notices } = useApp();
  const edits = usePlaylistEdits();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // Taken at the first press, before anything is awaited: a second press (or Enter) does nothing.
  const busyRef = useRef(false);
  const field = useRef<HTMLInputElement>(null);

  const create = async () => {
    if (!name.trim() || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const created = await playlists.createPlaylist(name, false);
    busyRef.current = false;
    setBusy(false);
    if (!created) return;
    onClose();
    // Create and add is one gesture: its toast's Undo takes back the add and the new playlist.
    if (tracks.length) await edits.add(created.name, tracks, created.change ? [created.change] : []);
    else {
      if (!created.change && created.sure) notices.notify({ text: `${created.name} already exists` });
      nav.openDetail({ kind: "playlist", name: created.name });
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="New playlist"
      initialFocus={field}
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim() || busy} onClick={() => void create()}>
            {tracks.length ? "Create and add" : "Create"}
          </Button>
        </>
      }
    >
      <div className="SheetField">
        <TextField
          ref={field}
          aria-label="Playlist name"
          placeholder="Playlist name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
        />
      </div>
    </Sheet>
  );
}

export function MoveToFolderSheet({ tracks, onClose }: { tracks: Track[]; onClose: () => void }) {
  const { dl, edits } = useApp();
  // Folders that already hold every one of the files are not offered (as before).
  const targets = dl.targetOptions.filter((name) => !tracks.every((t) => (t.playlist || "(root)") === name));
  const items: PickItem[] = targets.map((name) => ({
    id: name,
    name: folderLabel(name),
    thumb: <Thumb folder />,
    onPick: () => {
      onClose();
      void edits.moveTracksTo(tracks, name);
    },
  }));
  return (
    <Sheet open onClose={onClose} title={tracks.length === 1 ? "Move to folder" : `Move ${songCount(tracks.length)} to a folder`}>
      <PickList label="Folders" items={items} />
    </Sheet>
  );
}
