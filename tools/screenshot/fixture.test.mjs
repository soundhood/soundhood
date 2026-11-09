import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { hueSat, scanRgba } from "../lint/blue.mjs";
import {
  COVER_SIZE,
  coverPng,
  coverPngs,
  loadFixture,
  pageData,
  playlistResult,
  relPathOf,
  scanResult,
} from "./fixture.mjs";
import { WAV_RATE, silentWav } from "./wav.mjs";

const fixture = loadFixture();

describe("fixture library", () => {
  it("is the core's generated library: 50 tracks in 5 playlists under a neutral root", () => {
    expect(fixture.about).toContain("soundhood-tools harness-json");
    expect(fixture.tracks).toHaveLength(50);
    expect(fixture.playlists).toHaveLength(5);
    expect(fixture.root).toBe("C:/Music");
    expect(fixture.androidRoot).toBe("/storage/emulated/0/Music");
  });

  it("keeps library paths unique and every file an audio format the core writes", () => {
    const rels = fixture.tracks.map(relPathOf);
    expect(new Set(rels.map((r) => r.toLowerCase())).size).toBe(rels.length);
    for (const t of fixture.tracks) expect(t.file, relPathOf(t)).toMatch(/\.(m4a|mp3|flac|opus|ogg)$/);
  });

  it("has covers in aqua, purple and grey, and tracks without art", () => {
    const families = new Set(fixture.tracks.map((t) => (t.cover ? t.cover.split("-")[0] : "none")));
    expect([...families].sort()).toEqual(["aqua", "grey", "none", "purple"]);
  });

  it("only lists playlist entries that exist in the library", () => {
    const rels = new Set(fixture.tracks.map(relPathOf));
    for (const p of fixture.playlists) for (const e of p.entries) expect(rels.has(e), `${p.name}: ${e}`).toBe(true);
  });

  it("returns scan results like the host: absolute paths, top-folder buckets, byte-wise order", () => {
    const tracks = scanResult(fixture, "C:/Music");
    expect(tracks[0].playlist).toBe("(root)");
    expect(tracks.every((t) => t.path.startsWith("C:/Music/") && t.path.endsWith(t.name))).toBe(true);
    // A track in a nested folder is listed under its first-level folder, as the core's scan does.
    const nested = fixture.tracks.find((t) => t.folder.includes("/"));
    const scanned = tracks.find((t) => t.path === `C:/Music/${relPathOf(nested)}`);
    expect(scanned.playlist).toBe(nested.folder.split("/")[0]);
    const keys = tracks.map((t) => `${t.playlist}\0${t.name}`);
    expect([...keys].sort()).toEqual(keys);
    expect(Object.keys(tracks[0]).sort()).toEqual(["artist", "duration_secs", "name", "path", "playlist", "title"]);
  });

  it("returns playlists sorted by lower-cased name", () => {
    expect(playlistResult(fixture).map((p) => p.name)).toEqual(["Empty", "Favourites", "Focus", "Late Night", "Mixed Formats"]);
  });
});

describe("covers", () => {
  const families = { aqua: 165, purple: 271 };

  it("draws every cover in one colour family with no blue pixel", () => {
    for (const [key, bytes] of Object.entries(coverPngs(fixture))) {
      const png = PNG.sync.read(bytes);
      expect([png.width, png.height]).toEqual([COVER_SIZE, COVER_SIZE]);
      expect(scanRgba(png).matched, key).toBe(0);
      const family = key.split("-")[0];
      for (let i = 0; i < png.data.length; i += 4 * 97) {
        const { hue, sat } = hueSat(png.data[i], png.data[i + 1], png.data[i + 2]);
        if (family === "grey") expect(sat).toBe(0);
        else expect(Math.abs(hue - families[family]), key).toBeLessThan(3);
      }
    }
  });

  it("rejects unknown cover names", () => {
    expect(() => coverPng("blue-rings")).toThrow(/unknown cover/);
  });
});

describe("page data", () => {
  it("re-roots the library for Android and keeps lookups consistent", () => {
    const data = pageData(fixture, "android");
    expect(data.root).toBe(fixture.androidRoot);
    expect(data.store.library_dir).toBe(fixture.androidRoot);
    const paths = new Set(data.tracks.map((t) => t.path));
    for (const p of Object.keys(data.coverOf)) expect(paths.has(p)).toBe(true);
    for (const key of Object.values(data.coverOf)) expect(data.covers[key]).toBeTypeOf("string");
    expect(Object.keys(data.durationOf)).toHaveLength(50);
  });
});

describe("silentWav", () => {
  it("writes a valid 8-bit mono PCM header and silent samples", () => {
    const wav = silentWav(2);
    const view = new DataView(wav.buffer);
    const ascii = (o, n) => String.fromCharCode(...wav.subarray(o, o + n));
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(WAV_RATE);
    expect(view.getUint32(40, true)).toBe(2 * WAV_RATE);
    expect(wav.length).toBe(44 + 2 * WAV_RATE);
    expect(wav[44]).toBe(128);
  });
});
