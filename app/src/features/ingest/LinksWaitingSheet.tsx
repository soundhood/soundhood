// "Links waiting", a sub-sheet of Settings: every queued link with the folder and playlists it
// goes into, Copy and Remove on each, and Download queue. The links come from this device (a share,
// a paste, Queue) or from the other one (the queue file travels with the Music folder).
// Removing a link hands the focus to the link that takes its place (its Remove), else to the one
// before it, else, with none left, to the sheet itself: never to the page.
import { useLayoutEffect, useRef } from "react";
import { Button, EmptyState, IconButton, Sheet, cx } from "../../design";
import { useApp } from "../../app/context";
import { DEFAULT_DOWNLOAD_TARGET } from "../../lib/store";

const REMOVE = "Remove from the list";

export function LinksWaitingSheet({ onClose }: { onClose: () => void }) {
  const { dl } = useApp();
  const n = dl.shareQueue.length;
  const body = useRef<HTMLDivElement>(null);
  // The place of the link just removed, until the list without it is drawn.
  const removedAt = useRef<number | null>(null);

  useLayoutEffect(() => {
    const at = removedAt.current;
    if (at === null) return;
    removedAt.current = null;
    const buttons = [...(body.current?.querySelectorAll<HTMLElement>(`[role="listitem"] [aria-label="${REMOVE}"]`) ?? [])];
    const next = buttons[Math.min(at, buttons.length - 1)];
    if (next) next.focus({ preventScroll: false });
    else body.current?.closest<HTMLElement>('[role="dialog"]')?.focus({ preventScroll: true });
  }, [dl.shareQueue]);

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
      <div ref={body}>
        {n === 0 ? (
          <EmptyState icon="link" title="No links waiting" text="A link you queue here or on your other device shows up here." />
        ) : (
          <>
            <p className="SheetNote">Queued on this device or the other one. Download queue runs them here, one after another; the PC also picks them up with the Music folder.</p>
            <div role="list" aria-label="Links waiting">
              {dl.shareQueue.map((q, i) => (
                <div key={q.url} role="listitem" className={cx("LinkRow", q.url === dl.sharedLink && "is-fresh")}>
                  <div className="LinkRow-text">
                    <span className="LinkRow-url">{q.url}</span>
                    <span className="LinkRow-dest">
                      Into {q.target || DEFAULT_DOWNLOAD_TARGET}
                      {q.playlists?.length ? `, joins ${q.playlists.join(", ")}` : ""}
                    </span>
                  </div>
                  <IconButton icon="copy" size={20} label="Copy link" onClick={() => void dl.copyQueuedLink(q.url)} />
                  <IconButton
                    icon="trash"
                    size={20}
                    label={REMOVE}
                    onClick={() => {
                      removedAt.current = i;
                      dl.removeQueuedLink(q.url);
                    }}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
