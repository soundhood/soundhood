import { describe, expect, it } from "vitest";
import {
  ALLOWED_HOSTS,
  endpointOf,
  extractTargets,
  foldPolls,
  hostOf,
  isLoopback,
  judgeNetLog,
  parseNetLog,
  processTree,
  remoteConnections,
} from "./netlog.mjs";

// A small net log in Chromium's layout (constants on the first line, one event per line), with
// documentation addresses only (RFC 5737 / RFC 3849).
const constants = {
  logEventTypes: {
    URL_REQUEST_START_JOB: 1,
    CORS_REQUEST: 2,
    HOST_RESOLVER_MANAGER_REQUEST: 3,
    TCP_CONNECT: 4,
    TCP_CONNECT_ATTEMPT: 5,
    UDP_CONNECT: 6,
    UDP_BYTES_SENT: 7,
    SOCKET_POOL_CONNECT_JOB_CREATED: 8,
    DNS_CONFIG_CHANGED: 9,
    SOCKET_CONNECT: 10,
    SOCKET_ALIVE: 11,
  },
  logSourceType: { URL_REQUEST: 1, SOCKET: 2, UDP_SOCKET: 3, TCP_CONNECT_JOB: 4, UDP_CLIENT_SOCKET: 5, NONE: 0 },
  logEventPhase: { PHASE_BEGIN: 1, PHASE_END: 2, PHASE_NONE: 0 },
};
const ev = (type, sourceType, id, params) => ({ params, phase: 0, source: { id, type: sourceType }, time: "1", type });

const quiet = [
  ev(9, 0, 1, { nameservers: ["203.0.113.53:53"], search: ["example.org"] }),
  ev(1, 1, 2, { url: "http://tauri.localhost/assets/index.js", initiator: "http://tauri.localhost" }),
  ev(2, 1, 3, { url: "http://ipc.localhost/plugin%3Astore%7Cload" }),
  ev(2, 1, 4, { url: "http://asset.localhost/C%3A%2FMusic%2Fa.m4a" }),
  ev(2, 1, 5, { url: "data:image/png;base64,AAAA" }),
  ev(3, 0, 6, { host: "http://tauri.localhost", network_anonymization_key: "https://example.org same_site" }),
  ev(8, 4, 7, { group_id: "http://tauri.localhost <http://tauri.localhost same_site>" }),
  ev(4, 2, 8, { address_list: ["[::1]:80", "127.0.0.1:80"] }),
  ev(5, 2, 8, { address: "127.0.0.1:80" }),
  // The IPv6 reachability probe: a UDP connect that never sends a packet, logged as a client socket
  // (9) and the UDP socket under it (10).
  ev(11, 3, 10, { source_dependency: { id: 9, type: 5 } }),
  ev(6, 3, 10, { address: "[2001:db8::10]:443" }),
  ev(10, 5, 9, { address: "[2001:db8::10]:443", net_error: -109 }),
];
const noisy = [
  ...quiet,
  ev(3, 0, 20, { host: "https://config.example.com:443" }),
  ev(1, 1, 21, { url: "https://update.example.net/check?x=1" }),
  ev(8, 4, 22, { group_id: "ssl/update.example.net:443" }),
  ev(4, 2, 23, { address_list: ["203.0.113.7:443"] }),
  ev(5, 2, 23, { address: "203.0.113.7:443" }),
  // UDP that sends: the connect is on the client socket (24), the bytes on the UDP socket (25).
  ev(10, 5, 24, { address: "203.0.113.9:443" }),
  ev(11, 3, 25, { source_dependency: { id: 24, type: 5 } }),
  ev(7, 3, 25, { byte_count: 1200 }),
];
const logText = (events, { cut = false } = {}) => {
  const lines = [`{"constants":${JSON.stringify(constants)},`, '"events": ['];
  events.forEach((e, i) => lines.push(JSON.stringify(e) + (i < events.length - 1 ? "," : "")));
  if (cut) return lines.join("\n").slice(0, -25);
  lines.push("],", '"polledData": {}', "}");
  return lines.join("\n");
};

describe("hosts and addresses", () => {
  it("reads the host out of every form the log uses", () => {
    expect(hostOf("http://tauri.localhost/assets/x.js")).toBe("tauri.localhost");
    expect(hostOf("https://Config.Example.com:443")).toBe("config.example.com");
    expect(hostOf("http://tauri.localhost <http://tauri.localhost same_site>")).toBe("tauri.localhost");
    expect(hostOf("ssl/update.example.net:443")).toBe("update.example.net");
    expect(hostOf("pm/ssl/update.example.net:443")).toBe("update.example.net");
    expect(hostOf("update.example.net:443")).toBe("update.example.net");
    expect(hostOf("localhost:1420")).toBe("localhost");
    expect(hostOf("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(hostOf("http://[::1]:80/")).toBe("::1");
    expect(hostOf("tauri.localhost")).toBe("tauri.localhost");
  });

  it("names no host for local schemes, opaque origins and non-strings", () => {
    for (const v of ["data:text/plain,x", "blob:http://tauri.localhost/1234", "about:blank", "null", "", 42, null, undefined]) {
      expect(hostOf(v), String(v)).toBeNull();
    }
  });

  it("splits socket addresses and knows loopback", () => {
    expect(endpointOf("[::1]:80")).toEqual({ ip: "::1", port: 80 });
    expect(endpointOf("203.0.113.7:443")).toEqual({ ip: "203.0.113.7", port: 443 });
    expect(endpointOf("203.0.113.7")).toEqual({ ip: "203.0.113.7", port: null });
    for (const ip of ["127.0.0.1", "127.8.9.10", "::1", "[::1]", "::ffff:127.0.0.1"]) expect(isLoopback(ip), ip).toBe(true);
    for (const ip of ["203.0.113.7", "2001:db8::1", "0.0.0.0", "128.0.0.1", "::ffff:203.0.113.7"]) expect(isLoopback(ip), ip).toBe(false);
  });
});

describe("parseNetLog", () => {
  it("reads a complete log", () => {
    const log = parseNetLog(logText(quiet));
    expect(log.complete).toBe(true);
    expect(log.events).toHaveLength(quiet.length);
    expect(log.constants.logEventTypes.UDP_CONNECT).toBe(6);
  });

  it("reads a log cut off mid-write line by line and says it is incomplete", () => {
    const log = parseNetLog(logText(noisy, { cut: true }));
    expect(log.complete).toBe(false);
    expect(log.events.length).toBe(noisy.length - 1);
    expect(log.constants.logEventTypes.TCP_CONNECT).toBe(4);
  });

  it("collects request targets but not configuration", () => {
    const { hosts, sockets } = extractTargets(parseNetLog(logText(quiet)));
    expect(new Set(hosts.map((h) => h.host))).toEqual(new Set(ALLOWED_HOSTS));
    // The DNS servers in DNS_CONFIG_CHANGED and the network anonymization key are not targets.
    expect(sockets.some((s) => s.ip === "203.0.113.53")).toBe(false);
    expect(sockets.filter((s) => s.protocol === "udp").map((s) => s.ip)).toEqual(["2001:db8::10", "2001:db8::10"]);
  });
});

describe("judgeNetLog", () => {
  it("passes a log that names only the app's own hosts, loopback and a UDP probe", () => {
    const v = judgeNetLog(parseNetLog(logText(quiet)));
    expect(v.ok).toBe(true);
    expect(v.allowedHosts).toEqual(["asset.localhost", "ipc.localhost", "tauri.localhost"]);
    expect(v.probes).toEqual([{ protocol: "udp", ip: "2001:db8::10", port: 443, event: "UDP_CONNECT" }]);
    expect([v.badHosts, v.tcp, v.udp]).toEqual([[], [], []]);
  });

  it("fails on other hosts, remote TCP and UDP that sent bytes", () => {
    const v = judgeNetLog(parseNetLog(logText(noisy)));
    expect(v.ok).toBe(false);
    expect(v.badHosts.map((h) => [h.host, h.count])).toEqual([
      ["config.example.com", 1],
      ["update.example.net", 2],
    ]);
    expect(v.tcp.map((s) => `${s.ip}:${s.port}`)).toEqual(["203.0.113.7:443"]);
    expect(v.udp.map((s) => `${s.ip}:${s.port}`)).toEqual(["203.0.113.9:443"]);
    expect(v.probes.map((s) => s.ip)).toEqual(["2001:db8::10"]);
  });

  it("fails a truncated log even when what it holds is clean", () => {
    const v = judgeNetLog(parseNetLog(logText(quiet, { cut: true })));
    expect(v.complete).toBe(false);
    expect(v.ok).toBe(false);
  });
});

describe("process tree and TCP polls", () => {
  const procs = [
    { pid: 4, ppid: 0, created: 0 },
    { pid: 100, ppid: 4, created: 1000 }, // the app
    { pid: 200, ppid: 100, created: 1100 }, // WebView2 browser process
    { pid: 300, ppid: 200, created: 1200 }, // renderer
    { pid: 400, ppid: 50, created: 900 },
    // Parent id 100 reused: this process is older than the app, so it is not its child.
    { pid: 500, ppid: 100, created: 500 },
  ];

  it("follows parent ids down from the root, only to processes created after their parent", () => {
    expect([...processTree(procs, 100)].sort((a, b) => a - b)).toEqual([100, 200, 300]);
    expect([...processTree(procs, 999)]).toEqual([999]);
  });

  it("keeps only remote TCP connections of the tree", () => {
    const conns = [
      { pid: 300, remote: "127.0.0.1", remotePort: 80, state: "Established" },
      { pid: 300, remote: "::1", remotePort: 80, state: "SynSent" },
      { pid: 200, remote: "0.0.0.0", remotePort: 0, state: "Listen" },
      { pid: 200, remote: "203.0.113.7", remotePort: 443, state: "Established" },
      { pid: 400, remote: "203.0.113.8", remotePort: 443, state: "Established" },
    ];
    expect(remoteConnections(conns, processTree(procs, 100))).toEqual([
      { pid: 200, remote: "203.0.113.7", remotePort: 443, state: "Established" },
    ]);
  });

  it("folds polls into every pid seen and each remote connection once", () => {
    const polls = [
      { t: 1, procs: procs.slice(0, 3), conns: [] },
      { t: 2, procs, conns: [{ pid: 300, remote: "2001:db8::5", remotePort: 443, state: "SynSent" }] },
      { t: 3, procs, conns: [{ pid: 300, remote: "2001:db8::5", remotePort: 443, state: "Established" }] },
    ];
    const folded = foldPolls(polls, 100);
    expect([...folded.pids].sort((a, b) => a - b)).toEqual([100, 200, 300]);
    expect(folded.remote).toEqual([{ pid: 300, remote: "2001:db8::5", remotePort: 443, state: "SynSent", firstSeen: 2 }]);
  });
});
