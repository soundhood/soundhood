// "Where should this go?": the folder and playlists for a link that just arrived, then Queue or
// Download.
import { Dropdown, MultiDropdown } from "../../app/legacy/Dropdown";
import type { PlaylistFile, QueueDraft } from "../../lib/types";
import type { Downloads } from "../../hooks/useDownloads";

type QueueDraftDialogProps = {
  dl: Downloads;
  queueDraft: QueueDraft;
  playlistFiles: PlaylistFile[];
};

export function QueueDraftDialog({ dl, queueDraft, playlistFiles }: QueueDraftDialogProps) {
  const { setQueueDraft, targetOptions, dlBusy } = dl;
  return (
    <div className="modalBackdrop" onMouseDown={() => setQueueDraft(null)}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalTitle">Where should this go?</div>
        <div className="modalHint" style={{ wordBreak: "break-all", marginBottom: 10 }}>{queueDraft.url}</div>
        <label className="fieldLabel">Folder it lands in</label>
        <Dropdown
          value={queueDraft.target}
          options={targetOptions}
          title="Storage folder for the file(s)"
          onSelect={(v) => setQueueDraft({ ...queueDraft, target: v })}
        />
        <label className="fieldLabel">Playlists it joins</label>
        <MultiDropdown
          values={queueDraft.playlists}
          options={playlistFiles.map((p) => p.name)}
          onChange={(next) => setQueueDraft({ ...queueDraft, playlists: next })}
          placeholder="none"
          title="Every file this link produces is added to these playlists"
        />
        <div className="modalHint" style={{ marginTop: 10 }}>
          A playlist link produces several files; all of them get the same folder and playlists.
          {" "}"Queue" keeps it for later (or for the PC); "Download" starts right away on this device.
        </div>
        <div className="modalActions">
          <button className="btn" onClick={() => setQueueDraft(null)}>Cancel</button>
          <button className="btn" onClick={() => dl.confirmQueueDraft(false)}>Queue</button>
          <button className="btn primaryBtn" onClick={() => dl.confirmQueueDraft(true)} disabled={dlBusy} autoFocus>Download</button>
        </div>
      </div>
    </div>
  );
}
