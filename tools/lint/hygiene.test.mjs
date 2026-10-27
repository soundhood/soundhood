import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_WORD_HASHES,
  RULE_EMAIL,
  RULE_LAN_IP,
  RULE_LIBRARY,
  RULE_NAME,
  RULE_PROFILE,
  isAllowedEmail,
  isPrivateIpv4,
  scanText,
  tokenHash,
  wordTokens,
} from "./hygiene.mjs";

// Test inputs are assembled at runtime so this file passes the hygiene lint it tests.
const j = (...parts) => parts.join("");
const ip = (...octets) => octets.join(".");
const rulesOf = (text, hashes) => scanText(text, hashes).map((f) => f.rule);

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
