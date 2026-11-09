// Pure parts of tools/netlog-check.mjs: reading a Chromium net log (the one WebView2 writes with
// --log-net-log), the hosts and socket addresses it names, and the TCP connections of the app's
// process tree polled from Get-NetTCPConnection. Every function works on plain data, so the rules
// are unit-tested on synthetic logs.

/** The only hosts the desktop app may name: Tauri's own custom protocols, served in-process. */
export const ALLOWED_HOSTS = ["tauri.localhost", "ipc.localhost", "asset.localhost"];

// Event parameters that name the target of a request (a URL or a host), and those that name a
// socket's remote address. Everything else (DNS and proxy configuration, network anonymization keys,
// local addresses) describes the machine, not a connection.
const URL_KEYS = ["url", "original_url", "location", "initiator"];
const HOST_KEYS = ["host", "hostname", "host_and_port", "server", "origin", "group_id"];
const ADDRESS_KEYS = ["address", "address_list", "remote_address"];

// Schemes that never reach the network.
const LOCAL_SCHEMES = new Set(["data:", "blob:", "about:", "javascript:", "chrome:", "edge:", "chrome-extension:", "devtools:", "file:"]);

/**
 * Reads net-log text: { complete, constants, events }. Chromium writes the constants on the first
 * line and one event per line; a log cut off by a killed WebView2 is not valid JSON, so it is read
 * line by line and comes back with complete = false (the check fails on it).
 */
export function parseNetLog(text) {
  try {
    const log = JSON.parse(text);
    return { complete: true, constants: log.constants ?? {}, events: log.events ?? [] };
  } catch {
    // fall through to the line reader
  }
  let constants = {};
  const events = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/,$/, "");
    if (line.startsWith('{"constants":')) {
      try {
        constants = JSON.parse(line.slice('{"constants":'.length));
      } catch {
        // an unreadable constants line leaves the names numeric
      }
      continue;
    }
    if (!line.startsWith("{")) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === "object" && "type" in e) events.push(e);
    } catch {
      // the last line of a cut-off log
    }
  }
  return { complete: false, constants, events };
}

/** Name lookups from the log's constants: event(type), source(type); numbers when unknown. */
export function nameTables(constants = {}) {
  const invert = (o) => new Map(Object.entries(o ?? {}).map(([k, v]) => [v, k]));
  const events = invert(constants.logEventTypes);
  const sources = invert(constants.logSourceType);
  return {
    event: (t) => events.get(t) ?? String(t),
    source: (t) => sources.get(t) ?? String(t),
  };
}

/**
 * The host a parameter value names, lower-cased, or null when it names none: a URL ("http://a.b/x"),
 * a scheme-host-port ("https://a.b:443"), host and port ("a.b:443", "[::1]:80") or a socket-pool group
 * ("http://a.b <http://a.b same_site>", older "ssl/a.b:443").
 */
export function hostOf(value) {
  if (typeof value !== "string") return null;
  let v = value.trim().split(/\s+/)[0] ?? "";
  while (/^(?:pm|ssl|socks4|socks5|http_proxy|https_proxy)\//i.test(v)) v = v.slice(v.indexOf("/") + 1);
  if (!v || v === "null") return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^[^:/]+:\d+$/.test(v)) {
    let url;
    try {
      url = new URL(v);
    } catch {
      return null;
    }
    if (LOCAL_SCHEMES.has(url.protocol) || !url.hostname) return null;
    return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  }
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(v);
  if (bracket) return bracket[1].toLowerCase();
  const hostPort = /^([^:]+)(?::\d+)?$/.exec(v);
  return hostPort ? hostPort[1].toLowerCase() : v.toLowerCase();
}

/** "[::1]:80" or "127.0.0.1:80" -> { ip, port }; an address without a port has port null. */
export function endpointOf(text) {
  const t = String(text).trim();
  const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(t);
  if (bracket) return { ip: bracket[1].toLowerCase(), port: bracket[2] ? +bracket[2] : null };
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+))?$/.exec(t);
  if (v4) return { ip: v4[1], port: v4[2] ? +v4[2] : null };
  return { ip: t.toLowerCase(), port: null };
}

/** True for 127.0.0.0/8, ::1 and an IPv4-mapped 127.x address. */
export function isLoopback(ip) {
  const a = String(ip).toLowerCase().replace(/^\[|\]$/g, "");
  if (a === "::1" || a === "0:0:0:0:0:0:0:1") return true;
  const v4 = a.startsWith("::ffff:") ? a.slice(7) : a;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

/** True for an address that names no remote end (0.0.0.0, ::). */
export function isUnspecified(ip) {
  const a = String(ip).toLowerCase();
  return a === "0.0.0.0" || a === "::" || a === "0:0:0:0:0:0:0:0" || a === "";
}

/**
 * Everything the log's events point at: { hosts: [{ host, event }], sockets: [{ protocol, ip, port,
 * event, sourceId }], udpSent(sourceId) }. Socket entries come from address parameters; the protocol
 * is "udp" for UDP events and UDP sources, "tcp" otherwise. One UDP socket is logged as two linked
 * sources (UDP_CLIENT_SOCKET connects, UDP_SOCKET carries the bytes), so `udpSent` answers for the
 * whole group a source belongs to.
 */
export function extractTargets(log) {
  const names = nameTables(log.constants);
  const isUdp = (sourceType) => /UDP/.test(names.source(sourceType));
  const hosts = [];
  const sockets = [];
  const parent = new Map();
  const find = (id) => {
    while (parent.has(id) && parent.get(id) !== id) id = parent.get(id);
    return id;
  };
  const sentIds = [];
  for (const e of log.events) {
    const event = names.event(e.type);
    const sourceId = e.source?.id ?? null;
    if (event === "UDP_BYTES_SENT" || event === "UDP_BYTES_RECEIVED") sentIds.push(sourceId);
    const p = e.params;
    if (!p || typeof p !== "object") continue;
    const dep = p.source_dependency;
    if (dep && isUdp(e.source?.type) && isUdp(dep.type)) parent.set(find(sourceId), find(dep.id));
    for (const k of URL_KEYS.concat(HOST_KEYS)) {
      const h = hostOf(p[k]);
      if (h) hosts.push({ host: h, event });
    }
    const protocol = event.startsWith("UDP_") || isUdp(e.source?.type) ? "udp" : "tcp";
    for (const k of ADDRESS_KEYS) {
      const values = Array.isArray(p[k]) ? p[k] : p[k] === undefined ? [] : [p[k]];
      for (const v of values) {
        if (typeof v !== "string") continue;
        sockets.push({ protocol, ...endpointOf(v), event, sourceId });
      }
    }
  }
  const sentGroups = new Set(sentIds.map(find));
  return { hosts, sockets, udpSent: (sourceId) => sentGroups.has(find(sourceId)) };
}

/**
 * The verdict on one net log: { ok, complete, badHosts: [{ host, event, count }], tcp: [{ ip, port,
 * event }], udp: [...], probes: [...], allowedHosts: [host] }.
 * - A host other than ALLOWED_HOSTS fails.
 * - A TCP address that is not loopback fails.
 * - A UDP socket to a remote address fails when it sent or received bytes; one that only connected
 *   is a probe (the IPv6 reachability check: a UDP connect sends no packet) and is only reported.
 * - A log that is not complete JSON fails: the window was not closed normally.
 */
export function judgeNetLog(log) {
  const { hosts, sockets, udpSent } = extractTargets(log);
  const bad = new Map();
  const allowed = new Set();
  for (const h of hosts) {
    if (ALLOWED_HOSTS.includes(h.host)) {
      allowed.add(h.host);
      continue;
    }
    const entry = bad.get(h.host) ?? { host: h.host, event: h.event, count: 0 };
    entry.count++;
    bad.set(h.host, entry);
  }
  // One entry per protocol, address and port: a connect is logged on the socket and on its job.
  const unique = (list) => {
    const seen = new Set();
    return list
      .filter((s) => {
        const key = `${s.protocol} ${s.ip} ${s.port}`;
        return seen.has(key) ? false : (seen.add(key), true);
      })
      .map(({ protocol, ip, port, event }) => ({ protocol, ip, port, event }));
  };
  const remote = sockets.filter((s) => !isLoopback(s.ip) && !isUnspecified(s.ip));
  const tcp = unique(remote.filter((s) => s.protocol === "tcp"));
  const udp = unique(remote.filter((s) => s.protocol === "udp" && udpSent(s.sourceId)));
  const probes = unique(remote.filter((s) => s.protocol === "udp" && !udpSent(s.sourceId)));
  const badHosts = [...bad.values()].sort((a, b) => a.host.localeCompare(b.host));
  return {
    ok: log.complete && badHosts.length === 0 && tcp.length === 0 && udp.length === 0,
    complete: log.complete,
    badHosts,
    tcp,
    udp,
    probes,
    allowedHosts: [...allowed].sort(),
    events: log.events.length,
  };
}

/**
 * The process ids of `rootPid`'s tree in one process list ([{ pid, ppid, created }], created in ms):
 * the root and every process whose parent is in the tree and that was created after that parent,
 * so a parent id reused by an unrelated later process does not adopt it.
 */
export function processTree(processes, rootPid) {
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const root = byPid.get(rootPid);
  const tree = new Map([[rootPid, root?.created ?? -Infinity]]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of processes) {
      if (tree.has(p.pid) || !tree.has(p.ppid)) continue;
      if (p.created < tree.get(p.ppid)) continue;
      tree.set(p.pid, p.created);
      grew = true;
    }
  }
  return new Set(tree.keys());
}

/**
 * TCP connections of `pids` with a remote end that is neither loopback nor unspecified: [{ pid,
 * remote, remotePort, state }]. Listening and bound sockets have no remote end and are skipped.
 */
export function remoteConnections(connections, pids) {
  return connections
    .filter((c) => pids.has(c.pid))
    .filter((c) => !["Listen", "Bound"].includes(c.state))
    .filter((c) => !isLoopback(c.remote) && !isUnspecified(c.remote))
    .map((c) => ({ pid: c.pid, remote: c.remote, remotePort: c.remotePort, state: c.state }));
}

/**
 * Folds the polls ([{ t, procs, conns }]) of one run: { pids: every pid seen in the tree, remote:
 * unique [{ pid, remote, remotePort, state, firstSeen }] }.
 */
export function foldPolls(polls, rootPid) {
  const pids = new Set();
  const remote = new Map();
  for (const poll of polls) {
    const tree = processTree(poll.procs ?? [], rootPid);
    for (const pid of tree) pids.add(pid);
    for (const c of remoteConnections(poll.conns ?? [], tree)) {
      const key = `${c.pid} ${c.remote} ${c.remotePort}`;
      if (!remote.has(key)) remote.set(key, { ...c, firstSeen: poll.t });
    }
  }
  return { pids, remote: [...remote.values()] };
}
