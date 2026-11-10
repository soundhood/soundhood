// The words of a playlist add or remove (playlistWords.ts): counted from the write's own report, so a
// gesture that was partly in effect already says how many it really changed.
// @ts-expect-error vitest is installed in tools/, not in app/: tools/ runs this file.
import { describe, expect, it } from "vitest";
import { changeOf, type BatchReport } from "../../coreIpc";
import type { Track } from "../../lib/types";
import { addedText, removedText, songsChanged } from "./playlistWords";

const track = (title: string): Track => ({ name: `${title} - Anouk Lirr.ogg`, path: `C:/Music/Evenings/${title} - Anouk Lirr.ogg`, playlist: "Evenings", title, artist: "Anouk Lirr", duration_secs: 200 });
const two = [track("Static Garden"), track("Static Tide")];
const change = (label: string) => changeOf({ batch: "b", applied: [{ label, path_before: null, path_after: "_Playlists/Late Night.m3u8" }], skipped: [], failed: [], aborted: false } satisfies BatchReport);

describe("playlist words", () => {
  it("reads the count from the core's label", () => {
    expect(songsChanged(change("Added 1 track to Late Night"))).toBe(1);
    expect(songsChanged(change("Removed 12 tracks from Focus"))).toBe(12);
    expect(songsChanged(change("Created playlist Late Night"))).toBeNull();
    expect(songsChanged(null)).toBeNull();
  });

  it("a partial add says how many were really added, and how many were there already", () => {
    expect(addedText("Late Night", two, change("Added 1 track to Late Night"), true)).toBe("Added 1 song to Late Night; 1 was already there");
    const five = ["A", "B", "C", "D", "E"].map(track);
    expect(addedText("Focus", five, change("Added 2 tracks to Focus"), true)).toBe("Added 2 songs to Focus; 3 were already there");
  });

  it("a whole add names the song, or counts the songs", () => {
    expect(addedText("Late Night", two, change("Added 2 tracks to Late Night"), true)).toBe("Added 2 songs to Late Night");
    expect(addedText("Late Night", [two[0]], change("Added 1 track to Late Night"), true)).toBe("Added Static Garden to Late Night");
  });

  it("an add that changed nothing says so; one not known claims only the gesture", () => {
    expect(addedText("Late Night", two, null, true)).toBe("Already in Late Night");
    expect(addedText("Late Night", two, null, false)).toBe("Added 2 songs to Late Night");
  });

  it("a partial remove says how many were really taken out", () => {
    expect(removedText("Focus", two, change("Removed 1 track from Focus"), true)).toBe("Removed 1 song from Focus; 1 was not in it");
    expect(removedText("Focus", [two[1]], change("Removed 1 track from Focus"), true)).toBe("Removed Static Tide from Focus");
    expect(removedText("Focus", two, null, true)).toBe("Not in Focus");
  });
});
