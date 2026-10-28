// Unit tests for the UI's pure helpers in app/src (links, download output, the test library, the
// log the "Copy log" button builds, undo wording, folder names). They sit next to the screenshot
// harness because both test the UI; vitest compiles the TypeScript sources directly.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { batchLogLines, copyLogText, undoStatus } from "../../app/src/coreIpc.ts";
import { CHANNEL_REFUSAL, isChannelLink, lastErrorLine, queueStopStatus } from "../../app/src/downloads.ts";
import { checkFolderName, folderNameRefusal } from "../../app/src/folderName.ts";
import { SYNC_OFF_LINE, TEST_LIBRARY_LABEL, isTestLibrary, sameFolder, shownFolder } from "../../app/src/testLibrary.ts";

// Every string the UI shows must be plain: no en or em dash.
const DASHES = /[\u2013\u2014]/;

// The shared channel-link vectors: the phone plugin's Rust tests run the core rule over the same file.
const VECTORS = JSON.parse(readFileSync(new URL("./channel-links.json", import.meta.url), "utf8"));

describe("isChannelLink", () => {
  test("the vector file holds both kinds", () => {
    expect(VECTORS.channel.length).toBeGreaterThanOrEqual(40);
    expect(VECTORS.notChannel.length).toBeGreaterThanOrEqual(30);
  });

  test.each(VECTORS.channel)("refuses %s", (url) => {
    expect(isChannelLink(url)).toBe(true);
  });

  test.each(VECTORS.notChannel)("lets %s through", (url) => {
    expect(isChannelLink(url)).toBe(false);
  });

  test("the refusal is one plain line, the same sentence as the plugin and the host", () => {
    expect(CHANNEL_REFUSAL).toBe(VECTORS.refusal);
    expect(CHANNEL_REFUSAL).toBe("Whole channels are not downloaded. Use a single video or a playlist link.");
    expect(CHANNEL_REFUSAL).not.toMatch(DASHES);
  });
});

describe("queue stop reason", () => {
  test("the last ERROR line, without its prefix", () => {
    const out = [
      "[youtube] abc: Downloading webpage",
      "ERROR: [youtube] abc: first problem",
      "WARNING: something",
      "ERROR: [youtube] abc: Sign in to confirm you're not a bot",
      "",
      "[done] exit code: 1",
    ].join("\n");
    expect(lastErrorLine(out)).toBe("[youtube] abc: Sign in to confirm you're not a bot");
    expect(queueStopStatus(out, 1)).toBe("Queue stopped: [youtube] abc: Sign in to confirm you're not a bot");
  });

  test("the app's own [error] lines count too, and CRLF output is read", () => {
    expect(lastErrorLine("line\r\n[error] the relay could not start\r\n")).toBe("the relay could not start");
  });

  test("no error line: the exit code, in plain words", () => {
    expect(lastErrorLine("[download] 100%\n")).toBe("");
    expect(queueStopStatus("", 2)).toBe("Queue stopped: the download did not finish (code 2)");
  });

  test("a long reason is cut to 160 characters", () => {
    expect(lastErrorLine(`ERROR: ${"x".repeat(400)}`)).toHaveLength(160);
  });
});

describe("test library", () => {
  const root = "C:/Users/user/AppData/Roaming/com.mgmat.soundhood/fixture-library";

  test("same folder whatever the slashes, a trailing separator or (Windows) letter case", () => {
    expect(sameFolder(root, "c:\\users\\USER\\AppData\\Roaming\\com.mgmat.soundhood\\fixture-library\\")).toBe(true);
    expect(sameFolder("/data/user/0/app/fixture-library/", "/data/user/0/app/fixture-library")).toBe(true);
    // Android paths keep their case.
    expect(sameFolder("/storage/emulated/0/Music", "/storage/emulated/0/music")).toBe(false);
    expect(sameFolder(root, "C:/Music")).toBe(false);
    expect(sameFolder("", "")).toBe(false);
    expect(sameFolder("C:/Music", "")).toBe(false);
  });

  test("on only while the shown library is the fixture root", () => {
    expect(isTestLibrary(root, root)).toBe(true);
    expect(isTestLibrary("C:/Music", root)).toBe(false);
    // No fixture root known yet: never on.
    expect(isTestLibrary(root, "")).toBe(false);
  });

  test("the folder line names the test library instead of printing its path", () => {
    expect(shownFolder(root, root)).toBe(TEST_LIBRARY_LABEL);
    expect(`Folder: ${shownFolder(root, root)}`).toBe("Folder: test library");
    expect(shownFolder("C:/Music", root)).toBe("C:/Music");
    expect(SYNC_OFF_LINE).toBe("Sync is off while the test library is shown");
  });
});

describe("Copy log text", () => {
  const head = ["appVersion: 0.2.0", "platform: windows"];

  test("diagnostics, then the visible log, then the change lines kept out of it", () => {
    const text = copyLogText(head, "[download] 100%\n[done] exit code: 0\n", "[change] Added 1 track to Favourites\n");
    expect(text).toBe(
      "appVersion: 0.2.0\nplatform: windows\n\n[download] 100%\n[done] exit code: 0\n\n[change] Added 1 track to Favourites\n",
    );
  });

  test("only change lines: they still travel with the copy", () => {
    expect(copyLogText(head, "", "[change] Edited tags of A - B.m4a\n")).toBe(
      "appVersion: 0.2.0\nplatform: windows\n\n[change] Edited tags of A - B.m4a\n",
    );
  });

  test("a line the visible log already shows is not repeated", () => {
    const skipped = "[skipped] Ambient/A - B.m4a - file in use";
    const text = copyLogText(head, `${skipped}\n`, `[change] Restored playlist Focus\n${skipped}\n`);
    expect(text.split(skipped)).toHaveLength(2);
    expect(text).toContain("[change] Restored playlist Focus");
  });

  test("nothing logged: just the diagnostics", () => {
    expect(copyLogText(head, "", "")).toBe("appVersion: 0.2.0\nplatform: windows\n");
  });
});

describe("undo status", () => {
  const report = (applied, skipped = [], failed = [], aborted = false) => ({ batch: "b", applied, skipped, failed, aborted });
  const restored = { label: "Restored tags of A - B.m4a", path_before: "A - B.m4a", path_after: "A - B.m4a" };

  test("all of it undone: the change's own words", () => {
    expect(undoStatus(report([restored]), "Edited tags of A - B.m4a")).toBe("Undone: Edited tags of A - B.m4a");
  });

  test("part of it left as it was: counts, and where to read why", () => {
    const r = report([restored], [{ path: "C - D.m4a", reason: "file in use" }], [{ path: "E.m4a", error: "changed since" }]);
    const line = undoStatus(r, "Edited tags of 3 files");
    expect(line).toBe("Undo: 1 restored, 2 left as they are (see the log)");
    expect(line).not.toMatch(DASHES);
    // The reasons the log then shows.
    expect(batchLogLines({ ...r, applied: [] })).toEqual(["[skipped] C - D.m4a - file in use", "[failed] E.m4a - changed since"]);
  });

  test("an aborted batch is never reported as undone", () => {
    expect(undoStatus(report([], [], [], true), "x")).toBe("Undo: 0 restored, 0 left as they are (see the log)");
  });
});

describe("folder name refusal wording", () => {
  test("invisible characters, not jargon", () => {
    const check = checkFolderName("a:b");
    expect(check.ok).toBe(false);
    const line = folderNameRefusal("a:b", check.reason);
    expect(line).toBe('Folder name not allowed: "a:b" (no < > : " | ? * or invisible characters)');
    expect(checkFolderName("tab\there").ok).toBe(false);
    expect(line).not.toMatch(/control/);
  });
});
