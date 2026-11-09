// "Delete this playlist?": only the playlist file goes to the bin; the songs stay.
import type { Dialogs } from "../../hooks/useDialogs";
import type { Playlists } from "../../hooks/usePlaylists";

type DeletePlaylistDialogProps = {
  isMobile: boolean;
  name: string;
  dialogs: Dialogs;
  playlists: Playlists;
};

export function DeletePlaylistDialog({ isMobile, name, dialogs, playlists }: DeletePlaylistDialogProps) {
  const { setConfirmDeletePlaylist } = dialogs;
  return (
    <div className="modalBackdrop" onMouseDown={() => setConfirmDeletePlaylist("")}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalTitle">Delete this playlist?</div>
        <div className="modalBody">
          <div className="modalTrack">{name}</div>
          <div className="modalHint">
            {isMobile
              ? "Only the playlist file goes to the app's bin; Undo last change in settings brings it back. The songs stay exactly where they are."
              : "Only the playlist file goes to the Recycle Bin; Undo in the top bar brings it back. The songs stay exactly where they are."}
          </div>
        </div>
        <div className="modalActions">
          <button className="btn" onClick={() => setConfirmDeletePlaylist("")} autoFocus>Cancel</button>
          <button className="btn dangerBtn" onClick={() => playlists.deletePlaylist(name)}>Delete playlist</button>
        </div>
      </div>
    </div>
  );
}
