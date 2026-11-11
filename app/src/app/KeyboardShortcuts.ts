// Runs the keyboard map (keyboard.ts): one window listener, mounted once inside the shell
// (AppShell.tsx, after the other slots, so the components that own a key see it first and mark it
// handled). A key another part of the app already took (defaultPrevented) is left alone, except that
// Ctrl+arrows always reach the player, as SHORTCUTS.md promises, even from a slider. A shortcut that
// does not repeat acts once however long its key is held, and the repeats of a key whose press ran
// one do nothing at all, not even what the WebView would do with them (a held Space would scroll the
// screen under the heading the focus is on, a held Ctrl+arrow would move the slider that has it):
// the window's held-key rule swallows them (heldShortcut, heldKeys.ts), as it does for the search
// field's own Ctrl+K and "/".
import { useEffect, useEffectEvent } from "react";
import { isControlTarget, isTypingTarget } from "../design/lib/dom";
import { heldShortcut } from "../design/lib/heldKeys";
import { clamp } from "../lib/format";
import { libraryView } from "../hooks/useNavigation";
import type { Track } from "../lib/types";
import { usePlaylistEdits } from "../features/playlists/usePlaylistEdits";
import { useQueueEdits } from "../features/queue/useQueueEdits";
import { useQueueUi } from "../features/queue/QueueUi";
import { upcomingCount } from "../features/queue/queueModel";
import { topLayer, topPopover, useToast } from "../design";
import { IN_QUEUE_SHEET, PLAYBACK, VOLUME_STEP, shortcutFor, type Command, type KeyPress } from "./keyboard";
import { useApp } from "./context";

const TABS = ["playlists", "artists", "folders", "playing"] as const;

/** The first search field on screen. */
function visibleSearch(): HTMLInputElement | null {
  return [...document.querySelectorAll<HTMLInputElement>(".SearchField input")].find((el) => el.getClientRects().length > 0) ?? null;
}

const isRange = (t: EventTarget | null) => t instanceof HTMLInputElement && t.type === "range";

/** The volume one step up or down, kept to whole percent. */
const stepVolume = (v: number, by: number) => clamp(Math.round((v + by) * 100) / 100, 0, 1);

export function KeyboardShortcuts(): null {
  const { player, nav, lib, sel, phone, dialogs, edits, actions } = useApp();
  const queueUi = useQueueUi();
  const queue = useQueueEdits();
  const playlistEdits = usePlaylistEdits();
  const toast = useToast();

  /** The selection, else the song row that has the focus. */
  function songs(target: EventTarget | null): Track[] {
    if (sel.selectedTracks.length > 0) return sel.selectedTracks;
    const path = target instanceof Element ? target.closest<HTMLElement>("[data-path]")?.dataset.path : undefined;
    const t = path ? player.trackByPath.get(path) : undefined;
    return t ? [t] : [];
  }

  /** Runs `command`; false when it did not apply (the key then goes on as if unbound). */
  function run(command: Command, e: KeyPress & { target: EventTarget | null }): boolean {
    const target = e.target;
    switch (command) {
      case "playPause":
        if (isControlTarget(target)) return false; // Space presses the button that has the focus
        if (player.currentPath || upcomingCount(player.queue) > 0) player.togglePlay();
        else {
          nav.setSource(libraryView(lib));
          player.playFrom(lib.filteredTracks, player.shuffle);
        }
        return true;
      case "next":
        player.playNext();
        return true;
      case "previous":
        player.playPrev();
        return true;
      case "volumeUp":
        player.setVolume((v) => stepVolume(v, VOLUME_STEP));
        if (player.muted) player.setMuted(false);
        return true;
      case "volumeDown":
        player.setVolume((v) => stepVolume(v, -VOLUME_STEP));
        return true;
      case "mute":
        player.setMuted((m) => !m);
        return true;
      case "toggleQueue":
        queueUi.toggle();
        return true;
      case "search": {
        const field = visibleSearch();
        if (!field) return false;
        field.focus();
        field.select();
        return true;
      }
      case "escape":
        // Select mode, the selection and the Playing screen close on their own Esc.
        if (nav.playing || phone.mSelectMode || sel.selectedPaths.size > 0 || !nav.query) return false;
        nav.setQuery("");
        return true;
      case "tab": {
        // The phone's bottom tabs take the digits themselves while they show.
        const tabs = document.querySelector(".BottomTabs");
        if (tabs && tabs.getClientRects().length > 0) return false;
        nav.goTo(TABS[Number(e.key) - 1]);
        return true;
      }
      case "addToQueue":
      case "playNext": {
        const list = songs(target);
        if (list.length === 0) return false;
        if (command === "addToQueue") queue.add(list);
        else queue.playNext(list);
        return true;
      }
      case "removeFromQueue": {
        const list = songs(target);
        if (list.length === 0) return false;
        queue.removeTracks(list);
        return true;
      }
      case "remove": {
        const list = songs(target);
        if (list.length === 0) return false;
        const pl = nav.screen === "detail" && nav.detail?.kind === "playlist" ? lib.currentPlaylistFile : null;
        const inPl = pl ? list.filter((t) => lib.inPlaylist(pl, t)) : [];
        if (pl && inPl.length > 0) void playlistEdits.remove(pl.name, inPl);
        else queue.removeTracks(list);
        return true;
      }
      case "editTags": {
        const list = songs(target);
        const chosen = list.length > 0 ? list : player.currentTrack ? [player.currentTrack] : [];
        if (chosen.length === 1) edits.openTagEditor(chosen[0]);
        else if (chosen.length > 1) toast.show({ text: "Edit tags works on one song at a time" });
        return chosen.length > 0;
      }
      case "saveAsPlaylist": {
        const list = songs(target);
        if (list.length > 0) actions.newPlaylist(list);
        return true; // never the WebView's own Save
      }
      case "clearQueue":
        if (upcomingCount(player.queue) > 0) queueUi.askClear();
        return true;
    }
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.isComposing) return;
    const shortcut = shortcutFor(e);
    if (!shortcut) return;
    const ctrlArrow = shortcut.command === "next" || shortcut.command === "previous" || shortcut.command === "volumeUp" || shortcut.command === "volumeDown";
    if (e.defaultPrevented && !(ctrlArrow && isRange(e.target))) return;
    // The repeats of a key whose press ran a shortcut never get here (heldKeys.ts); another key's,
    // held where a control or a field took its press, do nothing here either.
    if (e.repeat && !shortcut.repeats) return;
    if (isTypingTarget(e.target) && !shortcut.whileTyping) return;
    // A list or menu takes its own keys (type-ahead), and nothing behind an open one answers.
    if (topPopover()) return;
    const layer = topLayer();
    // While a sheet or dialog is open, only the music answers (and, in the queue sheet, the queue).
    // The sheet that counts is the one on top: "Clear the queue?" over the queue sheet takes no
    // queue keys. The first-launch setup is a modal dialog of its own, not a sheet, drawn above them.
    const sheet = layer;
    const dialog = sheet || dialogs.editTags || dialogs.confirmDelete || dialogs.confirmDeletePlaylist;
    if (dialog) {
      const allowed = sheet?.classList.contains("QueueSheet") ? IN_QUEUE_SHEET : PLAYBACK;
      if (!allowed.has(shortcut.command)) return;
    }
    if (run(shortcut.command, e)) {
      e.preventDefault();
      if (!shortcut.repeats) heldShortcut(e);
    }
  });

  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return null;
}
