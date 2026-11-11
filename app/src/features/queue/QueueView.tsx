// The play queue on screen (the design system's Queue over the player's queue): the playing song,
// "Next in queue" (Play next and Add to queue) and "Next from <source>". A tap or Enter plays a row,
// rows drag to reorder (Alt+Up and Alt+Down with a keyboard), swipe left or Delete and X take one
// out (with Undo), and the footer saves the queue as a playlist or clears it (asking first).
// QueuePane is the right pane's content; QueueOverlays holds the sheet (narrower shells) and the
// "Clear the queue?" sheet Ctrl+L opens.
import { useEffect, useMemo, useState } from "react";
import { Button, IconButton, Queue, Sheet, type QueueItem, type QueueSection } from "../../design";
import { useApp } from "../../app/context";
import { knownCover, loadCover } from "../../lib/covers";
import { displayName } from "../../lib/tracks";
import type { Track } from "../../lib/types";
import { trackArtist, trackLength, trackTitle } from "../library/trackInfo";
import { sourceLabel } from "../player/PlayerSurfaces";
import { queuedPaths, upcomingCount, type QueueEntry, type QueueSectionId } from "./queueModel";
import { useQueueEdits } from "./useQueueEdits";
import { useQueueUi } from "./QueueUi";
import "./queue.css";

/** How many rows of each section get their cover read ahead (the rest show the plain thumb). */
const COVERS_AHEAD = 60;

/** Reads the covers of `paths` that are not known yet; the number changes when some arrive. */
function useCoverReads(paths: readonly string[]): number {
  const [version, setVersion] = useState(0);
  const key = paths.join("\n");
  useEffect(() => {
    const todo = key ? key.split("\n").filter((p) => knownCover(p) === undefined) : [];
    if (todo.length === 0) return;
    let live = true;
    void Promise.all(todo.map((p) => loadCover(p, () => live))).then(() => {
      if (live) setVersion((v) => v + 1);
    });
    return () => {
      live = false;
    };
  }, [key]);
  return version;
}

function QueueList({ heading }: { heading?: boolean }) {
  const { player, nav, actions } = useApp();
  const ui = useQueueUi();
  const edits = useQueueEdits();
  const q = player.queue;
  const byPath = player.trackByPath;

  const ahead = [q.now, ...q.next.slice(0, COVERS_AHEAD), ...q.rest.slice(0, COVERS_AHEAD)].filter((e): e is QueueEntry => !!e);
  const coversRead = useCoverReads(ahead.map((e) => e.path));

  const from = sourceLabel(nav.source).name;
  const sections = useMemo<QueueSection[]>(() => {
    const item = (e: QueueEntry): QueueItem => {
      const t = byPath.get(e.path);
      return {
        key: String(e.id),
        title: t ? trackTitle(t) : displayName(e.path.split(/[\\/]/).pop() ?? e.path),
        artist: t ? trackArtist(t) : "",
        duration: t ? trackLength(t) : "",
        cover: knownCover(e.path)?.url ?? null,
        missing: !t,
      };
    };
    return [
      { id: "next", label: "Next in queue", items: q.next.map(item) },
      { id: "rest", label: `Next from ${from}`, items: q.rest.map(item) },
    ];
    // coversRead: the rows pick up covers as they arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.next, q.rest, byPath, from, coversRead]);

  const nowTrack = q.now ? byPath.get(q.now.path) : undefined;
  const now = q.now
    ? {
        key: String(q.now.id),
        title: nowTrack ? trackTitle(nowTrack) : player.currentName,
        artist: nowTrack ? trackArtist(nowTrack) : "",
        duration: nowTrack ? trackLength(nowTrack) : "",
        cover: player.coverUrl || null,
        paused: !player.isPlaying,
      }
    : null;

  const saved: Track[] = queuedPaths(q).flatMap((p) => byPath.get(p) ?? []);
  const section = (id: string) => id as QueueSectionId;

  return (
    <Queue
      heading={heading}
      now={now}
      sections={sections}
      onPlay={(s, i) => player.jumpTo(section(s), i)}
      onMove={(s, from, to) => player.moveInQueue(section(s), from, to)}
      onRemove={(s, i) => edits.remove(section(s), i)}
      onSaveAsPlaylist={saved.length > 0 ? () => actions.newPlaylist(saved) : undefined}
      onClear={upcomingCount(q) > 0 ? edits.clear : undefined}
      headActions={heading ? <IconButton icon="close" size={20} label="Hide the queue" onClick={ui.toggle} /> : undefined}
    />
  );
}

/** The right pane's content (desktop shells). */
export function QueuePane() {
  return <QueueList heading />;
}

/** The queue sheet (shells without the right pane) and the "Clear the queue?" question (Ctrl+L). */
export function QueueOverlays() {
  const { player } = useApp();
  const ui = useQueueUi();
  const edits = useQueueEdits();
  const n = upcomingCount(player.queue);
  return (
    <>
      <Sheet open={ui.sheetOpen && !ui.paneFits} onClose={ui.closeSheet} title="Queue" tall className="QueueSheet">
        <QueueList />
      </Sheet>
      <Sheet
        open={ui.clearAsked}
        onClose={ui.cancelClear}
        title="Clear the queue?"
        className="ClearQueueSheet"
        footer={
          <>
            <Button variant="text" onClick={ui.cancelClear}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                ui.cancelClear();
                edits.clear();
              }}
            >
              Clear
            </Button>
          </>
        }
      >
        <p className="ClearQueueSheet-text">
          {n === 1 ? "1 song" : `${n} songs`} after the one playing leave the queue. The playing song plays on.
        </p>
      </Sheet>
    </>
  );
}
