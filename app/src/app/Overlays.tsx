// The shell's overlays slot, in stacking order: the settings sheet (and its sub-sheets), the
// sheets the screens open (add to playlist, new playlist, move to folder), the dialogs (edit tags,
// delete), downloads ("Where should this go?" and the running download's toast), the report that
// ends a tier-1 write, the first-launch setup, and the toasts.
import { ToastViewport } from "../design";
import { DeletePlaylistDialog } from "../features/dialogs/DeletePlaylistDialog";
import { DeleteTracksDialog } from "../features/dialogs/DeleteTracksDialog";
import { WriteReport } from "../features/dialogs/WriteReport";
import { Downloads } from "../features/ingest/Downloads";
import { Onboarding } from "../features/onboarding/Onboarding";
import { AddToPlaylistSheet, MoveToFolderSheet, NewPlaylistSheet } from "../features/playlists/PlaylistSheets";
import { SettingsSheet } from "../features/settings/SettingsSheet";
import { EditTagsDialog } from "../features/tags/EditTagsDialog";
import { useApp, type Picker } from "./context";

export function Overlays({ picker, closePicker }: { picker: Picker | null; closePicker: () => void }) {
  const { dialogs } = useApp();
  return (
    <>
      {/* Pass queuePane={{ shown, onChange }} once the queue's right pane exists (SettingsSheet). */}
      <SettingsSheet />

      {picker?.kind === "add" && <AddToPlaylistSheet tracks={picker.tracks} onClose={closePicker} />}
      {picker?.kind === "new" && <NewPlaylistSheet tracks={picker.tracks} onClose={closePicker} />}
      {picker?.kind === "move" && <MoveToFolderSheet tracks={picker.tracks} onClose={closePicker} />}

      {dialogs.editTags && <EditTagsDialog draft={dialogs.editTags} />}
      {dialogs.confirmDeletePlaylist && <DeletePlaylistDialog name={dialogs.confirmDeletePlaylist} />}
      {dialogs.confirmDelete && <DeleteTracksDialog tracks={dialogs.confirmDelete} />}

      <Downloads />
      <WriteReport />
      <Onboarding />

      <ToastViewport />
    </>
  );
}
