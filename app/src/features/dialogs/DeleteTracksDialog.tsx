// "Delete this song?" / "Delete N songs?": the files go to the bin (inside the library on the phone,
// the Recycle Bin on the PC), the playlists are updated, and the report that follows offers Undo
// this batch, which brings them all back (Undo last change in Settings takes back one per press, so
// the dialog names it only for one song).
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
      title={many ? `Delete ${tracks.length} songs?` : "Delete this song?"}
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
        {`The ${many ? "files go" : "file goes"} to ${isMobile ? "the bin" : "the Recycle Bin"}; ${
          many ? "Undo this batch brings them back" : "Undo last change in Settings brings it back"
        }. Playlists are updated.`}
      </p>
    </Sheet>
  );
}
