// "View log", a sub-sheet of Settings: the visible log (downloads, Proton, the network check, the
// self-test, the scan count and the other lines that used to be the status line), scrolled to its
// newest line, with Clear and Copy log. The change lines are not shown here; Copy log adds them.
import { useLayoutEffect, useRef } from "react";
import { Button, Sheet } from "../../design";
import { useApp } from "../../app/context";

export function LogSheet({ onClose }: { onClose: () => void }) {
  const { log } = useApp();
  const text = useRef<HTMLPreElement>(null);

  // Open at the newest line, the one that matters most.
  useLayoutEffect(() => {
    const body = text.current?.closest(".Sheet-body");
    if (body) body.scrollTop = body.scrollHeight;
  }, [log.dlLogs]);

  return (
    <Sheet
      open
      onClose={onClose}
      title="Log"
      tall
      className="LogSheet"
      footer={
        <>
          <Button variant="text" onClick={log.clearLog} disabled={!log.dlLogs}>
            Clear log
          </Button>
          <Button icon="copy" onClick={() => void log.copyLog()}>
            Copy log
          </Button>
        </>
      }
    >
      {log.dlLogs ? (
        <pre ref={text} className="LogText">
          {log.dlLogs.replace(/\n+$/, "")}
        </pre>
      ) : (
        <p className="SheetNote">The log is empty. Downloads, sync, the network check and the self-test write here.</p>
      )}
    </Sheet>
  );
}
