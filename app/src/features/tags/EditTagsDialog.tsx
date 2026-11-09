// "Edit tags": title and artist of one track, or both read from its filename.
import { titleArtistFromName } from "../../lib/tracks";
import type { TagDraft } from "../../lib/types";
import type { Dialogs } from "../../hooks/useDialogs";
import type { TrackEdits } from "../../hooks/useTrackEdits";

type EditTagsDialogProps = {
  editTags: TagDraft;
  dialogs: Dialogs;
  edits: TrackEdits;
};

export function EditTagsDialog({ editTags, dialogs, edits }: EditTagsDialogProps) {
  const { setEditTags } = dialogs;
  return (
    <div className="modalBackdrop" onMouseDown={() => setEditTags(null)}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalTitle">Edit tags</div>
        <div className="modalHint" style={{ marginBottom: 12 }}>{editTags.track.name}</div>
        <label className="fieldLabel">Title</label>
        <input
          className="downloadInput fieldInput"
          value={editTags.title}
          autoFocus
          onChange={(e) => setEditTags({ ...editTags, title: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") edits.saveTags(); }}
        />
        <label className="fieldLabel">Artist</label>
        <input
          className="downloadInput fieldInput"
          value={editTags.artist}
          onChange={(e) => setEditTags({ ...editTags, artist: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") edits.saveTags(); }}
        />
        <div className="modalActions">
          <button
            className="btn"
            title="Fill both fields from the filename ('Song - Artist')"
            onClick={() => setEditTags({ ...editTags, ...titleArtistFromName(editTags.track.name) })}
          >
            From filename
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => setEditTags(null)}>Cancel</button>
          <button className="btn primaryBtn" onClick={edits.saveTags}>Save</button>
        </div>
      </div>
    </div>
  );
}
