// The report that ends every tier-1 write (tag edits, moves, deletes) and the undo of one: counts,
// the rows with before and after, and Undo this batch (left out when there is nothing to undo, or
// the batch was itself an undo). It never closes by itself (useTrackEdits holds it; DESIGN.md
// BatchReport).
import { BatchReport } from "../../design";
import { useApp } from "../../app/context";

export function WriteReport() {
  const { edits } = useApp();
  const r = edits.report;
  if (!r) return null;
  return (
    <BatchReport
      open
      title={r.title}
      rows={r.rows}
      reasons={r.reasons}
      onUndo={r.changes.length ? () => void edits.undoReport() : undefined}
      onDone={edits.closeReport}
      undoing={edits.undoBusy}
    />
  );
}
