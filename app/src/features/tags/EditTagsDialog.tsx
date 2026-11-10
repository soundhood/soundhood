// "Edit tags": the title and artist of one song, typed or read from its file name ("From filename"
// fills the fields without saving). Save writes them through the journaled tag writer and ends in
// a report; a write the core refuses keeps the dialog open with the reason in an error row.
import { useRef } from "react";
import { Button, ErrorRow, SettingRow, Sheet, TextField } from "../../design";
import { useApp } from "../../app/context";
import { titleArtistFromName } from "../../lib/tracks";
import type { TagDraft } from "../../lib/types";
import "../settings/settings.css";

export function EditTagsDialog({ draft }: { draft: TagDraft }) {
  const { dialogs, edits, log } = useApp();
  const title = useRef<HTMLInputElement>(null);
  const close = () => dialogs.setEditTags(null);
  const save = () => void edits.saveTags();
  const onEnter = (e: { key: string }) => {
    if (e.key === "Enter") save();
  };

  return (
    <Sheet
      open
      onClose={close}
      title="Edit tags"
      initialFocus={title}
      footer={
        <>
          <Button variant="text" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={edits.writing}>
            Save
          </Button>
        </>
      }
    >
      <div className="SheetForm">
        {edits.tagError && <ErrorRow title="Not saved" detail={edits.tagError} onCopyLog={() => void log.copyLog()} onRetry={save} />}
        <p className="SheetNote">{draft.track.name}</p>
        <SettingRow label="Title" stacked>
          <TextField
            ref={title}
            aria-label="Title"
            value={draft.title}
            onChange={(e) => dialogs.setEditTags({ ...draft, title: e.currentTarget.value })}
            onKeyDown={onEnter}
          />
        </SettingRow>
        <SettingRow label="Artist" stacked>
          <TextField
            aria-label="Artist"
            value={draft.artist}
            onChange={(e) => dialogs.setEditTags({ ...draft, artist: e.currentTarget.value })}
            onKeyDown={onEnter}
          />
        </SettingRow>
        <div className="SheetActions">
          <Button small onClick={() => dialogs.setEditTags({ ...draft, ...titleArtistFromName(draft.track.name) })}>
            From filename
          </Button>
        </div>
        <p className="SheetNote">From filename reads "Title - Artist" from the file name and fills both fields; nothing is saved until Save.</p>
      </div>
    </Sheet>
  );
}
