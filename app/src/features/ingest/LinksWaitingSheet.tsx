// "Links waiting", a sub-sheet of Settings: every queued link with the folder and playlists it
// goes into, Copy and Remove on each, and Download queue. The links come from this device (a share,
// a paste, Queue) or from the other one (the queue file travels with the Music folder).
import { Button, EmptyState, IconButton, Sheet, cx } from "../../design";
import { useApp } from "../../app/context";
import { DEFAULT_DOWNLOAD_TARGET } from "../../lib/store";

export function LinksWaitingSheet({ onClose }: { onClose: () => void }) {
  const { dl } = useApp();
  const n = dl.shareQueue.length;
  return (
    <Sheet
      open
      onClose={onClose}
      title="Links waiting"
      tall
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            icon="download"
            disabled={dl.dlBusy || n === 0}
            onClick={() => {
              onClose();
              dl.runQueue();
            }}
          >
            Download queue ({n})
          </Button>
        </>
      }
    >
      {n === 0 ? (
        <EmptyState icon="link" title="No links waiting" text="A link you queue here or on your other device shows up here." />
      ) : (
        <>
          <p className="SheetNote">Queued on this device or the other one. Download queue runs them here, one after another; the PC also picks them up with the Music folder.</p>
          <div role="list" aria-label="Links waiting">
            {dl.shareQueue.map((q) => (
              <div key={q.url} role="listitem" className={cx("LinkRow", q.url === dl.sharedLink && "is-fresh")}>
                <div className="LinkRow-text">
                  <span className="LinkRow-url">{q.url}</span>
                  <span className="LinkRow-dest">
                    Into {q.target || DEFAULT_DOWNLOAD_TARGET}
                    {q.playlists?.length ? `, joins ${q.playlists.join(", ")}` : ""}
                  </span>
                </div>
                <IconButton icon="copy" size={20} label="Copy link" onClick={() => void dl.copyQueuedLink(q.url)} />
                <IconButton icon="trash" size={20} label="Remove from the list" onClick={() => dl.removeQueuedLink(q.url)} />
              </div>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
