// The phone's list of links waiting to be downloaded, each with its folder and playlists.
import { TrashIcon } from "../../app/legacy/icons";
import { DEFAULT_DOWNLOAD_TARGET } from "../../lib/store";
import type { Downloads } from "../../hooks/useDownloads";

export function LinksWaiting({ dl }: { dl: Downloads }) {
  const { shareQueue, sharedLink } = dl;
  return (
    <div className="queueBox">
      <div className="queueTitle">
        Links to download <span className="tabCount">{shareQueue.length}</span>
        <span className="modalHint" style={{ marginTop: 0 }}> · queued on this device; "Download queue" runs them here, or the PC picks them up with the Music folder</span>
      </div>
      {shareQueue.map((q) => (
        <div key={q.url} className={`queueRow ${q.url === sharedLink ? "fresh" : ""}`}>
          <span className="queueUrl">
            {q.url}
            <div className="rowSub">→ {q.target || DEFAULT_DOWNLOAD_TARGET}{q.playlists?.length ? ` · ${q.playlists.join(", ")}` : ""}</div>
          </span>
          <button className="linkBtn" onClick={() => dl.copyQueuedLink(q.url)}>copy</button>
          <button className="iconBtn small danger" title="Remove from the list" onClick={() => dl.removeQueuedLink(q.url)}><TrashIcon /></button>
        </div>
      ))}
    </div>
  );
}
