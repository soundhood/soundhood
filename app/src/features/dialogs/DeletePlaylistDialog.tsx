// "Delete this playlist?": only the playlist file goes to the bin (the app's own bin on the phone,
// the Recycle Bin on the PC); the songs stay where they are. A toast with Undo says it is done.
import { useState } from "react";
import { Button, Sheet } from "../../design";
import { useApp } from "../../app/context";
import "../settings/settings.css";

export function DeletePlaylistDialog({ name }: { name: string }) {
  const { isMobile, dialogs, playlists } = useApp();
  const close = () => dialogs.setConfirmDeletePlaylist("");
  // One press deletes once: the button waits until the dialog closes.
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open
      onClose={close}
      title="Delete this playlist?"
      footer={
        <>
          <Button variant="text" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon="trash"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void playlists.deletePlaylist(name);
            }}
          >
            Delete playlist
          </Button>
        </>
      }
    >
      <ul className="DeleteList">
        <li>{name}</li>
      </ul>
      <p className="SheetNote">
        {isMobile
          ? "Only the playlist file goes to the app's bin; Undo brings it back. The songs stay exactly where they are."
          : "Only the playlist file goes to the Recycle Bin; Undo brings it back. The songs stay exactly where they are."}
      </p>
    </Sheet>
  );
}
