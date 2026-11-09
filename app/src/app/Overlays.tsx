// The shell's overlays slot, in stacking order: the settings sheet, the old dialogs (edit tags,
// delete, "Where should this go?"), the sheets the screens open (add to playlist, new playlist, move
// to folder), and the toasts. The old dialogs keep their old look inside a `.legacy` box until the
// dialogs are rebuilt.
import { Sheet, ToastViewport } from "../design";
import { DeletePlaylistDialog } from "../features/dialogs/DeletePlaylistDialog";
import { DeleteTracksDialog } from "../features/dialogs/DeleteTracksDialog";
import { QueueDraftDialog } from "../features/ingest/QueueDraftDialog";
import { AddToPlaylistSheet, MoveToFolderSheet, NewPlaylistSheet } from "../features/playlists/PlaylistSheets";
import { EditTagsDialog } from "../features/tags/EditTagsDialog";
import { useApp, type Picker } from "./context";
import { LegacySettings } from "./legacy/LegacySettings";

export function Overlays({ picker, closePicker }: { picker: Picker | null; closePicker: () => void }) {
  const { isMobile, lib, dl, dialogs, edits, playlists, phone } = useApp();
  return (
    <>
      {/* The settings slot: the Settings rebuild replaces the content of this sheet. */}
      <Sheet open={phone.mSettings} onClose={() => phone.setMSettings(false)} title="Settings" tall className="SettingsSheet">
        <LegacySettings />
      </Sheet>

      <div className={`legacy${isMobile ? " mobile" : ""}`}>
        {dl.queueDraft && <QueueDraftDialog dl={dl} queueDraft={dl.queueDraft} playlistFiles={lib.playlistFiles} />}
        {dialogs.editTags && <EditTagsDialog editTags={dialogs.editTags} dialogs={dialogs} edits={edits} />}
        {dialogs.confirmDeletePlaylist && (
          <DeletePlaylistDialog isMobile={isMobile} name={dialogs.confirmDeletePlaylist} dialogs={dialogs} playlists={playlists} />
        )}
        {dialogs.confirmDelete && <DeleteTracksDialog isMobile={isMobile} tracks={dialogs.confirmDelete} dialogs={dialogs} edits={edits} />}
      </div>

      {picker?.kind === "add" && <AddToPlaylistSheet tracks={picker.tracks} onClose={closePicker} />}
      {picker?.kind === "new" && <NewPlaylistSheet tracks={picker.tracks} onClose={closePicker} />}
      {picker?.kind === "move" && <MoveToFolderSheet tracks={picker.tracks} onClose={closePicker} />}

      <ToastViewport />
    </>
  );
}
