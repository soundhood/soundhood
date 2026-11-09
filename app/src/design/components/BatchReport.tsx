// BatchReport: the dialog that ends every tier-1 batch (tag writes, moves, renames, deletes). A
// title saying what was done ("Moved 3 songs to the bin"), the counts (done, skipped with the
// reason, failed), the rows with before and after (in a VirtualList when there are many), and two
// buttons: Undo this batch and Done. It never closes by itself: no timer, and a backdrop tap does
// nothing; Esc counts as Done.
import type { HTMLAttributes } from "react";
import { cx } from "../lib/cx";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { Sheet } from "./Sheet";
import { VirtualList } from "./VirtualList";

export type BatchStatus = "done" | "skipped" | "failed";

export interface BatchRow {
  key: string;
  before: string;
  after: string;
  status: BatchStatus;
  /** Why it was skipped or failed. */
  reason?: string;
}

export interface BatchReportProps {
  open: boolean;
  title: string;
  rows: readonly BatchRow[];
  /** Reason lines under the counts ("1 skipped: already in the bin"). */
  reasons?: readonly string[];
  onUndo: () => void;
  onDone: () => void;
  /** The undo is running: its button waits. */
  undoing?: boolean;
}

/** Rows above this count go into a VirtualList. */
const LONG = 8;

const STATUS_ICON: Record<BatchStatus, IconName> = { done: "done", skipped: "info", failed: "error" };
const STATUS_LABEL: Record<BatchStatus, string> = { done: "Done", skipped: "Skipped", failed: "Failed" };

export function BatchReport({ open, title, rows, reasons, onUndo, onDone, undoing }: BatchReportProps) {
  const count = (s: BatchStatus) => rows.filter((r) => r.status === s).length;
  const counts: [BatchStatus, number][] = [
    ["done", count("done")],
    ["skipped", count("skipped")],
    ["failed", count("failed")],
  ];
  return (
    <Sheet
      open={open}
      onClose={onDone}
      title={title}
      tall={rows.length > LONG}
      dismissible={false}
      closeLabel="Done"
      footer={
        <>
          <Button icon="undo" onClick={onUndo} disabled={undoing}>
            Undo this batch
          </Button>
          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        </>
      }
    >
      <div className={cx("BatchReport", rows.length > LONG && "is-long")}>
        <dl className="BatchReport-counts">
          {counts.map(([s, n]) => (
            <div key={s} className={cx("BatchCount", `is-${s}`, n === 0 && "is-zero")}>
              <dt>{STATUS_LABEL[s]}</dt>
              <dd>{n}</dd>
            </div>
          ))}
        </dl>
        {reasons && reasons.length > 0 && (
          <ul className="BatchReport-reasons">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {rows.length > LONG ? (
          <VirtualList
            className="BatchReport-list"
            items={rows}
            label="Changes"
            getKey={(r) => r.key}
            renderRow={(r, _i, row) => <BatchRowView row={r} {...row} />}
          />
        ) : (
          <div className="BatchReport-list" role="list" aria-label="Changes">
            {rows.map((r) => (
              <BatchRowView key={r.key} row={r} role="listitem" />
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

interface BatchRowViewProps extends HTMLAttributes<HTMLDivElement> {
  row: BatchRow;
}

function BatchRowView({ row, className, ...rest }: BatchRowViewProps) {
  const done = row.status === "done";
  return (
    <div role="option" className={cx("BatchRow", `is-${row.status}`, className)} {...rest}>
      <Icon name={STATUS_ICON[row.status]} size={20} title={STATUS_LABEL[row.status]} />
      <div className="BatchRow-text">
        <span className="BatchRow-main">{done ? row.after : row.before}</span>
        <span className="BatchRow-sub">{done ? `Was ${row.before}` : (row.reason ?? `Not changed: ${row.after}`)}</span>
      </div>
    </div>
  );
}
