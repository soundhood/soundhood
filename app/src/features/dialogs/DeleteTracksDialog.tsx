// "Delete this track?" / "Delete N tracks?": the files go to the bin (the app's own bin on the
// phone, the Recycle Bin on the PC), the playlists are updated, and the report that follows offers
// Undo this batch; Undo last change in Settings brings them back too.
import { Button, Sheet } from "../../design";
import { useApp } from "../../app/context";
import { displayName } from "../../lib/tracks";
import type { Track } from "../../lib/types";
import "../settings/settings.css";

const SHOWN = 12;

export function DeleteTracksDialog({ tracks }: { tracks: Track[] }) {
  const { isMobile, dialogs, edits } = useApp();
  const many = tracks.length > 1;
  const close = () => dialogs.setConfirmDelete(null);
  return (
    <Sheet
      open
      onClose={close}
      title={many ? `Delete ${tracks.length} tracks?` : "Delete this track?"}
      footer={
        <>
          <Button variant="text" onClick={close}>
            Cancel
          </Button>
          <Button variant="danger" icon="trash" onClick={() => void edits.deleteTracks(tracks)} disabled={edits.writing}>
            {many ? `Delete ${tracks.length}` : "Delete"}
          </Button>
        </>
      }
    >
      <ul className="DeleteList">
        {tracks.slice(0, SHOWN).map((t) => (
          <li key={t.path}>{displayName(t.name)}</li>
        ))}
        {tracks.length > SHOWN && <li className="is-more">and {tracks.length - SHOWN} more</li>}
      </ul>
      <p className="SheetNote">
        {isMobile
          ? "The files go to the app's bin; Undo last change in Settings brings them back. Playlists are updated."
          : "The files go to the Recycle Bin; Undo last change in Settings brings them back. Playlists are updated."}
      </p>
    </Sheet>
  );
}
