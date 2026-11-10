// Settings, Library: the music folder (the folder picker on a PC; a path field on the phone, which
// has no picker for real paths), Rescan, Make playlists from folders, and Undo last change with
// the change named in plain words. An undo ends in a report or a toast that says what it did.
import { Button, SettingGroup, SettingRow, TextField } from "../../design";
import { useApp } from "../../app/context";
import { shownFolder } from "../../testLibrary";

export function LibraryGroup() {
  const { isMobile, lib, edits, dl, proton, playlists } = useApp();
  // An undo waits while a download or a sync runs: either may be journaling changes of its own.
  const undoBlocked = edits.undoBusy || dl.dlBusy || proton.protonBusy !== "";
  const folderLine = lib.folder ? shownFolder(lib.folder, lib.fixtureRoot) : "None chosen yet";

  return (
    <SettingGroup title="Library">
      {isMobile ? (
        <SettingRow label="Music folder" help={lib.folder ? folderLine : "Type the folder that holds your music, then Use"} stacked>
          <div className="SettingRow-inline">
            <TextField
              aria-label="Music folder path"
              placeholder="/storage/emulated/0/Music"
              value={lib.pathInput}
              onChange={(e) => lib.setPathInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void lib.importFolderPath(lib.pathInput);
              }}
            />
            <Button small onClick={() => void lib.importFolderPath(lib.pathInput)} disabled={!lib.pathInput.trim()}>
              Use
            </Button>
          </div>
        </SettingRow>
      ) : (
        <SettingRow label="Music folder" help={folderLine}>
          <Button small onClick={() => void lib.importFolder()}>
            {lib.folder ? "Change" : "Choose"}
          </Button>
        </SettingRow>
      )}
      {lib.folder && (
        <>
          <SettingRow label="Rescan" help="Reads the folder again for new and changed files. Changes nothing.">
            <Button small onClick={() => void lib.rescanLibrary()}>
              Rescan
            </Button>
          </SettingRow>
          <SettingRow label="Make playlists from folders" help="One playlist per folder. Nothing moves on disk; a playlist that exists stays as it is.">
            <Button small onClick={() => void playlists.createPlaylistsFromFolders()}>
              Make
            </Button>
          </SettingRow>
          <SettingRow label="Undo last change" help={lib.lastChange ? lib.lastChange.label : "Nothing to undo"} className="UndoRow">
            <Button small icon="undo" onClick={() => void edits.undoLast()} disabled={!lib.lastChange || undoBlocked}>
              {edits.undoBusy ? "Undoing" : "Undo"}
            </Button>
          </SettingRow>
        </>
      )}
    </SettingGroup>
  );
}
