// "Delete this track?" / "Delete N tracks?": the files go to the bin, Undo brings them back.
import { displayName } from "../../lib/tracks";
import type { Track } from "../../lib/types";
import type { Dialogs } from "../../hooks/useDialogs";
import type { TrackEdits } from "../../hooks/useTrackEdits";

type DeleteTracksDialogProps = {
  isMobile: boolean;
  tracks: Track[];
  dialogs: Dialogs;
  edits: TrackEdits;
};

export function DeleteTracksDialog({ isMobile, tracks: confirmDelete, dialogs, edits }: DeleteTracksDialogProps) {
  const { setConfirmDelete } = dialogs;
  return (
    <div className="modalBackdrop" onMouseDown={() => setConfirmDelete(null)}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalTitle">{confirmDelete.length > 1 ? `Delete ${confirmDelete.length} tracks?` : "Delete this track?"}</div>
        <div className="modalBody">
          <div className="modalTrack" style={{ maxHeight: 160, overflow: "auto" }}>
            {confirmDelete.slice(0, 12).map((t) => (
              <div key={t.path}>{displayName(t.name)}</div>
            ))}
            {confirmDelete.length > 12 ? <div className="dimText">…and {confirmDelete.length - 12} more</div> : null}
          </div>
          <div className="modalHint">
            {isMobile
              ? "The files go to the app's bin; Undo last change in settings brings them back. Playlists are updated."
              : "The files go to the Recycle Bin; Undo in the top bar brings them back. Playlists are updated."}
          </div>
        </div>
        <div className="modalActions">
          <button className="btn" onClick={() => setConfirmDelete(null)} autoFocus>Cancel</button>
          <button className="btn dangerBtn" onClick={() => edits.deleteTracks(confirmDelete)}>
            {confirmDelete.length > 1 ? `Delete ${confirmDelete.length}` : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
