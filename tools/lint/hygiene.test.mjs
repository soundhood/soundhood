import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./common.mjs";
import {
  FORBIDDEN_WORD_HASHES,
  RULE_DENY_TERM,
  RULE_DEVICE,
  RULE_EMAIL,
  RULE_LAN_IP,
  RULE_LIBRARY,
  RULE_NAME,
  RULE_PROFILE,
  RULE_SECRET_FILE,
  isAllowedEmail,
  isPrivateIpv4,
  isSecretFileName,
  looksLikeSerial,
  parseDenyList,
  scanPath,
  scanText,
  tokenHash,
  wordTokens,
} from "./hygiene.mjs";

// Test inputs are assembled at runtime so this file passes the hygiene lint it tests.
const j = (...parts) => parts.join("");
const ip = (...octets) => octets.join(".");
const rulesOf = (text, hashes, terms) => scanText(text, hashes, terms).map((f) => f.rule);

describe("forbidden words", () => {
  const hashes = new Set([tokenHash("Zorblax")]);

  it("stores only 64-hex SHA-256 digests", () => {
    for (const h of FORBIDDEN_WORD_HASHES) expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash("ABC")).toBe(tokenHash("abc"));
  });

  it("splits words on non-letters and camelCase humps", () => {
    expect(wordTokens("fooBar_baz9Qux").map((t) => t.word)).toEqual(["fooBar", "foo", "Bar", "baz", "Qux"]);
  });

  it("matches the word in any case, inside identifiers and paths, and never prints it", () => {
    const text = "by zorblax\nZORBLAX_TOKEN\nconst zorblaxId = 1; dir/Zorblax2/x\nzorblaxian";
    const found = scanText(text, hashes);
    expect(found.map((f) => `${f.line}:${f.rule}`)).toEqual([
      `1:${RULE_NAME}`,
      `2:${RULE_NAME}`,
      `3:${RULE_NAME}`,
      `3:${RULE_NAME}`,
    ]);
    expect(found.map((f) => f.message).join(" ").toLowerCase()).not.toContain("zorblax");
  });

  it("does not flag the app id or its package paths", () => {
    expect(scanText("com.mgmat.soundhood src/main/java/com/mgmat/soundhood/MainActivity.kt")).toEqual([]);
  });
});

describe("library path", () => {
  const parts = ["Proton Drive", "Shared", "Albums"];

  it("catches every slash style, escaped backslashes and URL encoding", () => {
    for (const sep of ["/", "\\", "\\\\"]) {
      expect(rulesOf(j("X:", sep, parts.join(sep), sep, "Rock"))).toEqual([RULE_LIBRARY]);
    }
    expect(rulesOf(parts.join("/").replace(/ /g, "%20"))).toEqual([RULE_LIBRARY]);
  });

  it("leaves other folders alone", () => {
    expect(rulesOf(j("Proton Drive", "/Shared/Documents"))).toEqual([]);
  });
});

describe("LAN addresses", () => {
  it("knows the RFC 1918 ranges", () => {
    expect(isPrivateIpv4([10, 0, 0, 1])).toBe(true);
    expect(isPrivateIpv4([172, 16, 0, 1])).toBe(true);
    expect(isPrivateIpv4([172, 31, 255, 255])).toBe(true);
    expect(isPrivateIpv4([192, 168, 1, 101])).toBe(true);
    expect(isPrivateIpv4([172, 32, 0, 1])).toBe(false);
    expect(isPrivateIpv4([192, 169, 0, 1])).toBe(false);
    expect(isPrivateIpv4([127, 0, 0, 1])).toBe(false);
    expect(isPrivateIpv4([10, 0, 0, 300])).toBe(false);
  });

  it("finds addresses in URLs and config, not inside longer version numbers", () => {
    expect(rulesOf(j('"devUrl": "http://', ip(192, 168, 1, 7), ':1420"'))).toEqual([RULE_LAN_IP]);
    expect(rulesOf(j("host ", ip(10, 2, 3, 4), "\nproxy ", ip(172, 20, 0, 9)))).toEqual([RULE_LAN_IP, RULE_LAN_IP]);
    expect(rulesOf(j("sdk ", ip(10, 0, 19041, 0), " v", ip(10, 1, 2, 3), " ", ip(1, 10, 0, 0, 1)))).toEqual([]);
    expect(rulesOf(j("ok ", ip(127, 0, 0, 1), " ", ip(8, 8, 8, 8)))).toEqual([]);
  });
});

describe("e-mail addresses", () => {
  it("allows GitHub noreply, the commit trailer and example domains", () => {
    expect(isAllowedEmail(j("12345+someone@", "users.noreply.github.com"))).toBe(true);
    expect(isAllowedEmail(j("noreply@", "anthropic.com"))).toBe(true);
    expect(isAllowedEmail(j("me@", "example.com"))).toBe(true);
    expect(isAllowedEmail(j("me@", "mail.example.org"))).toBe(true);
    expect(isAllowedEmail(j("me@", "notexample.com"))).toBe(false);
  });

  it("flags real-looking addresses and skips file names like icon@2x.png", () => {
    expect(rulesOf(j("contact: someone@", "mailbox.test"))).toEqual([RULE_EMAIL]);
    expect(rulesOf(j("Co-Authored-By: Bot <noreply@", "anthropic.com>"))).toEqual([]);
    expect(rulesOf("icons/128x128@2x.png @tauri-apps/api@2.11.1 user@localhost")).toEqual([]);
  });
});

describe("user-profile paths", () => {
  it("catches drive, escaped, forward-slash and POSIX-mount forms", () => {
    for (const p of [
      j("C:", "\\Users\\alex\\AppData"),
      j("c:", "\\\\Users\\\\alex\\\\x"),
      j("C:", "/Users/alex/x"),
      j(" /c", "/Users/alex/x"),
      j(" /mnt/c", "/Users/alex/x"),
    ]) {
      expect(rulesOf(p), p).toEqual([RULE_PROFILE]);
    }
  });

  it("accepts placeholders and machine accounts", () => {
    for (const name of ["<you>", "%USERNAME%", "$env:USERNAME", "{user}", "Public", "runneradmin"]) {
      expect(rulesOf(j("C:", "\\Users\\", name, "\\x")), name).toEqual([]);
    }
    expect(rulesOf("https://example.com/c/Users/alex")).toEqual([]);
  });
});

describe("HYGIENE_DENY", () => {
  it("splits on commas and new lines and sorts hashes, words and text terms", () => {
    const hash = tokenHash("Quorvel");
    const deny = parseDenyList(j(" ", hash.toUpperCase(), ",Brindlemoss\r\n", "XQ-77 Pro", "\n\n,ab, ,"));
    expect([...deny.hashes].sort()).toEqual([hash, tokenHash("brindlemoss")].sort());
    expect(deny.terms).toEqual(["XQ-77 Pro"]);
    expect(deny.ignored).toBe(1);
    expect(parseDenyList(undefined)).toEqual({ hashes: new Set(), terms: [], ignored: 0 });
  });

  it("checks deny-list words per word, like the built-in name, and never prints them", () => {
    const { hashes } = parseDenyList("Brindlemoss");
    const found = scanText("by brindlemoss\nconst brindlemossPath = 1\nbrindlemossy", hashes);
    expect(found.map((f) => `${f.line}:${f.rule}`)).toEqual([`1:${RULE_NAME}`, `2:${RULE_NAME}`]);
    expect(found.map((f) => f.message).join(" ").toLowerCase()).not.toContain("brindlemoss");
  });

  it("matches text terms in any case and spacing, not inside a longer word or number", () => {
    const terms = parseDenyList(j("XQ-77 Pro,", "S3R-1")).terms;
    expect(rulesOf(j("phone: xq-77  PRO (dev)"), undefined, terms)).toEqual([RULE_DENY_TERM]);
    expect(rulesOf(j("id=", "S3R-1;"), undefined, terms)).toEqual([RULE_DENY_TERM]);
    expect(rulesOf(j("XQ-77 Prox ", "S3R-12 ", "aS3R-1"), undefined, terms)).toEqual([]);
    const found = scanText(j("XQ-77 Pro"), undefined, terms);
    expect(found[0].message).not.toMatch(/xq|pro/i);
  });

  it("treats regular-expression characters in a term literally", () => {
    const terms = ["a.b+c (x)"];
    expect(rulesOf("a.b+c (x)", undefined, terms)).toEqual([RULE_DENY_TERM]);
    expect(rulesOf("aXbbc (x)", undefined, terms)).toEqual([]);
  });
});

describe("device serials and IMEIs", () => {
  const serial = j("R58M", "12ABCDE");

  it("catches a serial next to adb -s, --serial, ANDROID_SERIAL, serialno and serial number", () => {
    for (const text of [
      j("adb -s ", serial, " install -r app.apk"),
      j("& $adb.exe --serial '", serial, "' shell"),
      j("ANDROID_SERIAL=", serial),
      j("[ro.serialno]: [", serial, "]"),
      j("ro.boot.serialno=", serial),
      j("Serial number: ", serial),
      j("serial ", serial),
    ]) {
      expect(rulesOf(text), text).toEqual([RULE_DEVICE]);
    }
  });

  it("catches a line of adb devices output", () => {
    expect(rulesOf(j("List of devices attached\n", serial, "\tdevice\n"))).toEqual([RULE_DEVICE]);
    expect(rulesOf(j("  ", serial, "   unauthorized"))).toEqual([RULE_DEVICE]);
    expect(rulesOf(j(serial, " device product:x model:y"))).toEqual([RULE_DEVICE]);
  });

  it("leaves placeholders, code, hashes and emulators alone", () => {
    for (const text of [
      "adb -s <serial> install",
      "& $adb -s $Serial pull $remote",
      "pass -Serial <adb serial> when two are attached",
      "let mut serial = None;",
      "if *serial.get_or_insert(page_serial) != page_serial {",
      "use serde::Serialize; fn serialize(&self)",
      j("serial: ", "66674953fe25".repeat(5), "abcd"),
      "adb -s emulator-5554 shell",
      "adb -s abcdefgh shell",
      "Android15 phone here",
    ]) {
      expect(rulesOf(text), text).toEqual([]);
    }
  });

  it("knows what a serial looks like", () => {
    expect(looksLikeSerial(serial)).toBe(true);
    expect(looksLikeSerial("12345678")).toBe(true);
    expect(looksLikeSerial("abcdefgh")).toBe(false);
    expect(looksLikeSerial("a1b2")).toBe(false);
    expect(looksLikeSerial("a1".repeat(11))).toBe(false);
  });

  it("catches an IMEI after the word and never prints a device id", () => {
    const imei = j("35", "1234567890123");
    const found = scanText(j("IMEI: ", imei, "\nadb -s ", serial));
    expect(found.map((f) => f.rule)).toEqual([RULE_DEVICE, RULE_DEVICE]);
    expect(found.map((f) => f.message).join(" ")).not.toMatch(new RegExp(`${imei}|${serial}`));
    expect(rulesOf(j("IMEI 12345"))).toEqual([]);
  });
});

describe("file names", () => {
  it("flags key, session and secret files in any folder", () => {
    for (const p of [
      "release.jks",
      "app/upload.keystore",
      "certs/dev.p12",
      j("app/src-tauri/gen/android/", "keystore.properties"),
      j("key", ".properties"),
      j("Cookies", ".TXT"),
      ".env",
      "tools/.env.local",
    ]) {
      expect(isSecretFileName(p), p).toBe(true);
      expect(scanPath(p).map((f) => f.rule), p).toEqual([RULE_SECRET_FILE]);
    }
  });

  it("leaves documentation and look-alikes alone", () => {
    for (const p of ["docs/keystore.md", "cookies.txt.md", "my.env.ts", "src/env.rs", "jks.txt"]) {
      expect(isSecretFileName(p), p).toBe(false);
    }
  });

  it("applies the text rules to the path, on line 0", () => {
    const hashes = new Set([tokenHash("Zorblax")]);
    const found = scanPath("docs/evidence/zorblax-phone.png", hashes);
    expect(found.map((f) => `${f.line}:${f.rule}`)).toEqual([`0:${RULE_NAME}`]);
    expect(found[0].message).not.toMatch(/zorblax/i);
  });
});

// The lint lists files with `git ls-files`; a tree exported with `git archive` has no repository.
const inGitTree = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: REPO_ROOT }).status === 0;

describe.skipIf(!inGitTree)("the command line", () => {
  // This file itself holds the test word, so the real lint over the real tree must find it here.
  const run = (deny) =>
    spawnSync(process.execPath, [path.join(REPO_ROOT, "tools", "hygiene-lint.mjs")], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, HYGIENE_DENY: deny },
      timeout: 60_000,
    });

  it.each([
    ["a plain word", "zorblax"],
    ["a SHA-256 hash", tokenHash("zorblax")],
    ["a text term", j("Zorblax", "2")],
  ])("reads HYGIENE_DENY (%s) and never prints the term", (_, deny) => {
    const r = run(j("ab,", deny));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("tools/lint/hygiene.test.mjs:");
    expect(r.stdout).toContain("HYGIENE_DENY entries");
    expect(r.stdout).toContain("shorter than 3 characters ignored");
    expect(r.stdout.toLowerCase()).not.toContain("zorblax");
  }, 60_000);
});
