// Downloads on every screen: "Where should this go?" for a link that arrives (shared to the phone,
// pasted with Ctrl+V anywhere outside a text field, typed in Settings, or the PC sidebar's Download
// item with an empty link), and the running download's own toast (progress line, Cancel on the
// phone). Mounted once in the shell's overlays.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Dropdown, ErrorRow, MultiSelect, SettingRow, Sheet, TextField, sheetMayOpen, useToast } from "../../design";
import { useApp } from "../../app/context";
import { firstUrl } from "../../lib/links";
import { NEW_FOLDER_SENTINEL } from "../../lib/store";
import type { QueueDraft } from "../../lib/types";
import "../settings/settings.css";

/** A text field, a text area or anything editable: Ctrl+V there pastes into it, not a download. */
function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !["button", "checkbox", "radio", "range", "submit"].includes(el.type);
}

/**
 * Ctrl+V outside a text field: a pasted link opens "Where should this go?" (ingest's own key), on
 * top of any sheet, never under the first-launch setup; an open list or menu closes as it opens.
 */
function useLinkPaste(onLink: (text: string) => void) {
  const handler = useRef(onLink);
  useLayoutEffect(() => {
    handler.current = onLink;
  });
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target) || isEditable(document.activeElement) || !sheetMayOpen()) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!firstUrl(text)) return;
      e.preventDefault();
      handler.current(text);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);
}

/** "Downloading 2 of 5: 45% (12 s)". */
function downloadText(run: { at: number; of: number } | null, progress: number, seconds: number): string {
  const which = run && run.of > 1 ? ` ${run.at} of ${run.of}` : "";
  const pct = progress >= 0 ? `: ${Math.round(progress)}%` : "";
  return `Downloading${which}${pct} (${seconds} s)`;
}

/** The running download's toast: it stays while the download runs, with the purple progress line. */
function DownloadToast() {
  const { dl } = useApp();
  const toast = useToast();
  const id = useRef<number | null>(null);
  const text = downloadText(dl.run, dl.dlProgress, dl.dlSeconds);
  const progress = dl.dlProgress >= 0 ? dl.dlProgress / 100 : 0;
  const canCancel = dl.canCancel;
  // The newest cancel; the toast's action calls through it, so the toast changes only with its text.
  const cancel = useRef(dl.cancelPhoneDownload);
  useLayoutEffect(() => {
    cancel.current = dl.cancelPhoneDownload;
  });

  // In the commit that ends the download, so it has left before a toast says how it ended.
  useLayoutEffect(() => {
    if (!dl.dlBusy) {
      if (id.current !== null) toast.dismiss(id.current);
      id.current = null;
      return;
    }
    const action = canCancel ? { label: "Cancel", onClick: () => void cancel.current() } : undefined;
    if (id.current === null) id.current = toast.show({ text, progress, persistent: true, action });
    else toast.update(id.current, { text, progress, action });
  }, [dl.dlBusy, text, progress, canCancel, toast]);

  // Gone with the shell.
  useEffect(
    () => () => {
      if (id.current !== null) toast.dismiss(id.current);
    },
    [toast],
  );
  return null;
}

function WhereSheet({ draft }: { draft: QueueDraft }) {
  const { dl, lib } = useApp();
  const [newFolder, setNewFolder] = useState(false);
  const [newName, setNewName] = useState("");
  const link = useRef<HTMLInputElement>(null);
  const folders = [...dl.targetOptions.map((name) => ({ value: name, label: name })), { value: NEW_FOLDER_SENTINEL, label: "New folder" }];
  const lists = lib.playlistFiles.map((p) => ({ value: p.name, label: p.name }));
  const ready = !!draft.url.trim() && (!newFolder || !!newName.trim());
  const confirm = (now: boolean) => {
    if (ready) dl.confirmQueueDraft(now, newFolder ? newName : draft.target);
  };

  return (
    <Sheet
      open
      onClose={dl.closeDraft}
      title="Where should this go?"
      className="WhereSheet"
      // An empty link (the Download item) starts in its field; a shared or pasted one on the sheet.
      initialFocus={draft.url ? undefined : link}
      footer={
        <>
          <Button variant="text" onClick={dl.closeDraft}>
            Cancel
          </Button>
          <Button onClick={() => confirm(false)} disabled={!ready}>
            Queue
          </Button>
          <Button variant="primary" icon="download" onClick={() => confirm(true)} disabled={!ready || dl.dlBusy}>
            Download
          </Button>
        </>
      }
    >
      <div className="SheetForm">
        {dl.draftError && <ErrorRow title="Not taken" detail={dl.draftError} />}
        <SettingRow label="Link" stacked>
          <TextField
            ref={link}
            aria-label="Link"
            placeholder="Paste a YouTube link"
            inputMode="url"
            value={draft.url}
            onChange={(e) => dl.setQueueDraft({ ...draft, url: e.currentTarget.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirm(true);
            }}
          />
        </SettingRow>
        <SettingRow label="Folder" help="Where the file is saved">
          <Dropdown
            label="Folder"
            options={folders}
            value={newFolder ? NEW_FOLDER_SENTINEL : draft.target}
            onChange={(v) => {
              setNewFolder(v === NEW_FOLDER_SENTINEL);
              if (v !== NEW_FOLDER_SENTINEL) dl.setQueueDraft({ ...draft, target: v });
            }}
          />
        </SettingRow>
        {newFolder && (
          <SettingRow label="New folder" stacked>
            <TextField
              autoFocus
              aria-label="New folder name"
              placeholder="New folder name"
              value={newName}
              onChange={(e) => setNewName(e.currentTarget.value)}
              onKeyDown={(e) => {
                // Enter confirms the name (a refused one says why); it never starts the download.
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (newName.trim()) dl.checkDraftFolder(newName);
              }}
            />
          </SettingRow>
        )}
        <SettingRow label="Playlists" help="Every file it brings joins these">
          <MultiSelect label="Playlists" options={lists} values={draft.playlists} onChange={(v) => dl.setQueueDraft({ ...draft, playlists: v })} />
        </SettingRow>
        <p className="SheetNote">
          A playlist link brings several files; all of them get the same folder and playlists. Queue keeps the link for later (or for
          your other device); Download starts now, here.
        </p>
      </div>
    </Sheet>
  );
}

export function Downloads() {
  const { dl } = useApp();
  useLinkPaste((text) => void dl.queueLink(text));
  return (
    <>
      <DownloadToast />
      {dl.queueDraft && <WhereSheet draft={dl.queueDraft} />}
    </>
  );
}
