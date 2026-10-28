package com.mgmat.soundhood.ytdl

import android.app.Activity
import android.util.Log
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.io.File
import kotlin.concurrent.thread

@InvokeArg
class DownloadArgs {
  lateinit var url: String
  lateinit var outDir: String
  var playlist: Boolean = false
  var id: String = "dl"
}

@InvokeArg
class ProtonLoginArgs {
  lateinit var username: String
  lateinit var password: String
  var twofa: String = ""
  var mailboxPassword: String = ""
}

@InvokeArg
class ProtonSyncArgs {
  lateinit var libraryDir: String
  var remoteDir: String = "Music"
  /** "down" (Proton → phone), "up" (phone → Proton) or "both" (down, then up). Nothing is ever deleted. */
  var direction: String = "both"
}

@InvokeArg
class CancelArgs {
  lateinit var id: String
}

/**
 * yt-dlp on the phone. youtubedl-android ships python + yt-dlp + ffmpeg (+ quickjs as the JS runtime
 * YouTube needs) as native libs; it adds --js-runtimes and --ffmpeg-location itself.
 * The options mirror the desktop sidecar call in lib.rs so both ends name files the same way.
 */
private const val TAG = "SoundhoodYtdl"

/** The file that marks a generated fixture library (soundhood_core::fixtures::MARKER). */
private const val FIXTURE_MARKER = ".soundhood-fixture"

@TauriPlugin
class YtdlPlugin(private val activity: Activity) : Plugin(activity) {
  @Volatile private var ready = false
  @Volatile private var initError: String? = null
  private val initLock = Object()

  override fun load(webView: WebView) {
    // Unpacking python on first run takes a few seconds — never on the UI thread.
    thread(name = "ytdl-init") { ensureInit() }
  }

  private fun ensureInit(): String? {
    synchronized(initLock) {
      if (ready) return null
      try {
        val ctx = activity.applicationContext
        Log.i(TAG, "init: unpacking python/yt-dlp/ffmpeg if needed")
        YoutubeDL.getInstance().init(ctx)
        FFmpeg.getInstance().init(ctx)
        ready = true
        initError = null
        Log.i(TAG, "init: ready, yt-dlp " + (try { YoutubeDL.getInstance().version(ctx) } catch (e: Throwable) { "?" }))
      } catch (e: Throwable) {
        initError = e.message ?: e.toString()
        Log.e(TAG, "init failed", e)
      }
      return initError
    }
  }

  private fun isAudio(f: File): Boolean {
    val ext = f.name.substringAfterLast('.', "").lowercase()
    return ext in setOf("m4a", "mp3", "opus", "ogg", "oga", "flac", "wav", "aac", "webm", "mp4")
  }

  private fun emit(event: String, obj: JSObject) {
    activity.runOnUiThread { trigger(event, obj) }
  }

  @Command
  fun download(invoke: Invoke) {
    val args = invoke.parseArgs(DownloadArgs::class.java)
    // Only a web link reaches yt-dlp: never an option such as --exec, a local file or another
    // scheme (the link may come from a share or the synced queue file). And never an output folder
    // with a ".." segment, which would land files outside the library.
    // Whole channels are refused in Rust before this runs (src/commands.rs check_download, with the
    // core's is_channel_link, the rule the desktop applies): the plugin's `download` command is
    // registered in Rust, so Tauri never routes it here directly. No second, narrower copy here.
    val scheme = args.url.take(8).lowercase()
    if (!(scheme.startsWith("http://") || scheme.startsWith("https://"))) {
      invoke.reject("Not a web link: ${args.url}")
      return
    }
    if (args.outDir.split('/', '\\').any { it == ".." }) {
      invoke.reject("Refusing a download folder with '..': ${args.outDir}")
      return
    }
    Log.i(TAG, "download: ${args.url} -> ${args.outDir} (playlist=${args.playlist})")
    thread(name = "ytdl-download") {
      val err = ensureInit()
      if (err != null) {
        invoke.reject("yt-dlp could not start: $err")
        return@thread
      }
      val outDir = File(args.outDir)
      if (!outDir.exists() && !outDir.mkdirs()) {
        invoke.reject("Cannot create folder ${outDir.absolutePath}")
        return@thread
      }
      val started = System.currentTimeMillis() - 5000
      val lines = ArrayDeque<String>()
      try {
        val titleJunk = "(?i)\\s*[\\(\\[][^\\)\\]]*\\b(official|lyrics?|audio|visuali[sz]er|4k|hd|hq|music video|video|clip|full album|full)\\b[^\\)\\]]*[\\)\\]]"
        val mhNameParse = "%(track)s - %(artist)s:(?P<mh_name>(?!NA - ).+ - (?!NA\$).+)"
        val req = YoutubeDLRequest(args.url)
        if (args.playlist) req.addOption("--yes-playlist") else req.addOption("--no-playlist")
        req.addOption("-f", "bestaudio[ext=m4a]/bestaudio")
        // three-argument options go in as raw command words
        req.addCommands(listOf("--replace-in-metadata", "title", titleJunk, ""))
        req.addCommands(listOf("--replace-in-metadata", "title", "\\s{2,}", " "))
        req.addOption("--parse-metadata", mhNameParse)
        req.addOption("-o", File(outDir, "%(mh_name,title)s.%(ext)s").absolutePath)
        req.addOption("--windows-filenames")
        req.addOption("--trim-filenames", "200")
        req.addOption("--embed-metadata")
        req.addOption("--embed-thumbnail")
        req.addOption("--extract-audio")
        req.addOption("--audio-format", "m4a")
        req.addOption("--no-mtime")
        req.addOption("--newline")
        emit("progress", JSObject().apply { put("id", args.id); put("progress", -1); put("line", "[soundhood] saving into: ${outDir.absolutePath}") })
        // Fail fast and visibly: yt-dlp's warnings/errors go to stderr, which is merged into the
        // progress stream (redirectErrorStream = true) so a stall shows its reason.
        // All of yt-dlp's traffic goes through the in-app proxy: DNS + connections in the app's own
        // network stack (the bare python process could not resolve names on this phone).
        req.addOption("--proxy", "http://127.0.0.1:" + LocalProxy.start())
        req.addOption("--socket-timeout", "20")
        req.addOption("--retries", "3")
        req.addOption("--fragment-retries", "3")
        val resp = YoutubeDL.getInstance().execute(req, args.id, true) { progress, eta, line ->
          if (lines.size > 200) lines.removeFirst()
          lines.addLast(line)
          Log.i(TAG, "yt-dlp: $line")
          emit("progress", JSObject().apply { put("id", args.id); put("progress", progress); put("eta", eta); put("line", line) })
        }
        val files = JSArray()
        outDir.listFiles()
          ?.filter { it.isFile && it.lastModified() >= started && isAudio(it) }
          ?.sortedBy { it.lastModified() }
          ?.forEach { files.put(it.absolutePath) }
        val res = JSObject()
        res.put("exitCode", resp.exitCode)
        res.put("files", files)
        res.put("log", (lines.joinToString("\n") + "\n" + resp.err).takeLast(6000))
        Log.i(TAG, "download done: exit ${resp.exitCode}, ${files.length()} file(s)")
        invoke.resolve(res)
      } catch (e: YoutubeDL.CanceledException) {
        invoke.reject("cancelled")
      } catch (e: Throwable) {
        Log.e(TAG, "download failed", e)
        val tail = lines.joinToString("\n").takeLast(3000)
        invoke.reject(((e.message ?: e.toString()) + "\n" + tail).take(6000))
      }
    }
  }

  @Command
  fun cancel(invoke: Invoke) {
    val args = invoke.parseArgs(CancelArgs::class.java)
    val ok = try { YoutubeDL.getInstance().destroyProcessById(args.id) } catch (e: Throwable) { false }
    invoke.resolve(JSObject().apply { put("cancelled", ok) })
  }

  @Command
  fun ytdlpVersion(invoke: Invoke) {
    thread(name = "ytdl-version") {
      val err = ensureInit()
      if (err != null) { invoke.reject("yt-dlp could not start: $err"); return@thread }
      val v = try { YoutubeDL.getInstance().version(activity.applicationContext) } catch (e: Throwable) { null }
      invoke.resolve(JSObject().apply { put("version", v ?: "unknown") })
    }
  }

  @Command
  fun ytdlpUpdate(invoke: Invoke) {
    thread(name = "ytdl-update") {
      val err = ensureInit()
      if (err != null) { invoke.reject("yt-dlp could not start: $err"); return@thread }
      try {
        val status = YoutubeDL.getInstance().updateYoutubeDL(activity.applicationContext, YoutubeDL.UpdateChannel.STABLE)
        val v = YoutubeDL.getInstance().version(activity.applicationContext) ?: "unknown"
        invoke.resolve(JSObject().apply { put("status", status?.name ?: "UNKNOWN"); put("version", v) })
      } catch (e: Throwable) {
        invoke.reject(e.message ?: e.toString())
      }
    }
  }

  /** Diagnostic: the bundled python talks to the network by itself — DNS, raw TCP, HTTPS. */
  @Command
  fun netcheck(invoke: Invoke) {
    thread(name = "ytdl-netcheck") {
      val err = ensureInit()
      if (err != null) { invoke.reject("yt-dlp could not start: $err"); return@thread }
      try {
        val ctx = activity.applicationContext
        val binDir = File(ctx.applicationInfo.nativeLibraryDir)
        val pyHome = File(File(File(ctx.noBackupFilesDir, "youtubedl-android"), "packages"), "python").resolve("usr")
        val script = """
import socket, time, urllib.request, sys, threading
def step(name, fn, limit=12):
    t = time.time()
    box = {}
    def run():
        try: box["r"] = fn()
        except Exception as e: box["e"] = e
    th = threading.Thread(target=run, daemon=True); th.start(); th.join(limit)
    if th.is_alive(): print(f"{name}: HANGS (> {limit}s, gave up)")
    elif "e" in box: print(f"{name}: FAILED {box['e']!r} ({time.time()-t:.1f}s)")
    else: print(f"{name}: ok {box['r']} ({time.time()-t:.1f}s)")
    sys.stdout.flush()
print("python", sys.version.split()[0]); sys.stdout.flush()
step("via app proxy https youtube", lambda: urllib.request.build_opener(urllib.request.ProxyHandler({"https": "http://127.0.0.1:PROXYPORT", "http": "http://127.0.0.1:PROXYPORT"})).open("https://www.youtube.com/robots.txt", timeout=15).status, 20)
step("dns www.youtube.com", lambda: [a[4][0] for a in socket.getaddrinfo("www.youtube.com", 443)][:3])
step("dns one.one.one.one", lambda: [a[4][0] for a in socket.getaddrinfo("one.one.one.one", 443)][:2])
step("tcp 1.1.1.1:443", lambda: socket.create_connection(("1.1.1.1", 443), timeout=8).close())
step("tcp youtube ipv4", lambda: socket.create_connection(("142.250.184.238", 443), timeout=8).close())
step("https 1.1.1.1", lambda: urllib.request.urlopen("https://1.1.1.1/", timeout=10).status)
step("https youtube robots", lambda: urllib.request.urlopen("https://www.youtube.com/robots.txt", timeout=15).status)
"""
        val t0 = System.currentTimeMillis()
        val javaDns = try { java.net.InetAddress.getAllByName("www.youtube.com").take(3).joinToString { it.hostAddress ?: "?" } } catch (e: Throwable) { "FAILED ${e.message}" }
        Log.i(TAG, "netcheck: java dns www.youtube.com: $javaDns (${System.currentTimeMillis() - t0} ms)")
        // The app's own stack, for comparison: raw TCP to a YouTube address, and a real HTTPS request.
        val t1 = System.currentTimeMillis()
        val javaTcp = try { java.net.Socket().use { it.connect(java.net.InetSocketAddress("142.250.184.238", 443), 8000); "ok" } } catch (e: Throwable) { "FAILED ${e.message}" }
        Log.i(TAG, "netcheck: java tcp youtube ipv4: $javaTcp (${System.currentTimeMillis() - t1} ms)")
        val t2 = System.currentTimeMillis()
        val javaHttps = try {
          val c = java.net.URL("https://www.youtube.com/robots.txt").openConnection() as java.net.HttpURLConnection
          c.connectTimeout = 10000; c.readTimeout = 10000
          val code = c.responseCode; c.disconnect(); "ok $code"
        } catch (e: Throwable) { "FAILED ${e.message}" }
        Log.i(TAG, "netcheck: java https youtube robots: $javaHttps (${System.currentTimeMillis() - t2} ms)")
        val proxyPort = LocalProxy.start()
        val pb = ProcessBuilder(File(binDir, "libpython.so").absolutePath, "-c", script.replace("PROXYPORT", proxyPort.toString()))
        pb.redirectErrorStream(true)
        val env = pb.environment()
        env["PYTHONHOME"] = pyHome.absolutePath
        env["LD_LIBRARY_PATH"] = File(pyHome, "lib").absolutePath
        env["SSL_CERT_FILE"] = File(pyHome, "etc/tls/cert.pem").absolutePath
        env["TMPDIR"] = ctx.cacheDir.absolutePath
        env["PATH"] = (System.getenv("PATH") ?: "") + ":" + binDir.absolutePath
        val proc = pb.start()
        val out = StringBuilder()
        val reader = proc.inputStream.bufferedReader()
        val t = thread(isDaemon = true) {
          try { reader.forEachLine { out.append(it).append('\n'); Log.i(TAG, "netcheck: $it") } } catch (_: Throwable) { /* closed on timeout */ }
        }
        val finished = proc.waitFor(90, java.util.concurrent.TimeUnit.SECONDS)
        if (!finished) { proc.destroyForcibly(); out.append("(timed out after 90 s)\n") }
        t.join(2000)
        invoke.resolve(JSObject().apply { put("output", "app (java) dns www.youtube.com: $javaDns\napp (java) tcp youtube ipv4: $javaTcp\napp (java) https youtube robots: $javaHttps\napp proxy port: $proxyPort\n" + out.toString()) })
      } catch (e: Throwable) {
        Log.e(TAG, "netcheck failed", e)
        invoke.reject(e.message ?: e.toString())
      }
    }
  }

  // ---------- Proton Drive via rclone ----------

  private fun rcloneLine(kind: String, line: String) {
    emit("sync", JSObject().apply { put("kind", kind); put("line", line) })
  }

  @Command
  fun protonStatus(invoke: Invoke) {
    val ctx = activity.applicationContext
    invoke.resolve(JSObject().apply {
      put("bundled", Rclone.isBundled(ctx))
      put("connected", Rclone.isConnected(ctx))
      put("username", Rclone.username(ctx) ?: "")
    })
  }

  @Command
  fun protonLogin(invoke: Invoke) {
    val args = invoke.parseArgs(ProtonLoginArgs::class.java)
    thread(name = "proton-login") {
      val ctx = activity.applicationContext
      try {
        if (!Rclone.isBundled(ctx)) { invoke.reject("rclone is not bundled in this build"); return@thread }
        val obscured = Rclone.obscure(ctx, args.password)
        if (obscured.isNullOrEmpty()) { invoke.reject("could not prepare the password (rclone obscure failed)"); return@thread }
        val env = HashMap<String, String>()
        env["RCLONE_CONFIG_PROTON_PASSWORD"] = obscured
        if (args.twofa.isNotBlank()) env["RCLONE_CONFIG_PROTON_2FA"] = args.twofa.trim()
        if (args.mailboxPassword.isNotBlank()) {
          val mb = Rclone.obscure(ctx, args.mailboxPassword)
          if (!mb.isNullOrEmpty()) env["RCLONE_CONFIG_PROTON_MAILBOX_PASSWORD"] = mb
        }
        Rclone.writeBaseConfig(ctx, args.username.trim())
        // A real call: logs in, and on success rclone stores the session tokens in the config file.
        val r = Rclone.run(ctx, listOf("lsd", "${Rclone.REMOTE}:", "--max-depth", "1", "-v"), env, 180) { rcloneLine("login", it) }
        if (r.exitCode != 0) {
          Rclone.forget(ctx)
          invoke.reject("Proton login failed:\n" + r.output.takeLast(3000))
          return@thread
        }
        invoke.resolve(JSObject().apply {
          put("connected", Rclone.isConnected(ctx))
          put("username", args.username.trim())
          put("folders", r.output.lines().filter { it.trim().startsWith("-1") || it.contains(" -1 ") }.joinToString("\n"))
          put("log", r.output.takeLast(4000))
        })
      } catch (e: Throwable) {
        Log.e(TAG, "proton login failed", e)
        invoke.reject(e.message ?: e.toString())
      }
    }
  }

  @Command
  fun protonSync(invoke: Invoke) {
    val args = invoke.parseArgs(ProtonSyncArgs::class.java)
    // The fixture library ("Use fixture root") must never meet the real Proton Drive library: an
    // upload would put test tracks and playlists into it, a download would pull the whole library in.
    if (File(args.libraryDir, FIXTURE_MARKER).isFile) {
      invoke.reject("Sync is off while the test library is shown")
      return
    }
    thread(name = "proton-sync") {
      val ctx = activity.applicationContext
      try {
        if (!Rclone.isConnected(ctx)) { invoke.reject("Not connected to Proton Drive"); return@thread }
        val remote = "${Rclone.REMOTE}:" + args.remoteDir.trim('/')
        val local = args.libraryDir.trimEnd('/')
        val common = listOf(
          // size-only: the phone's copy of the library was not made by rclone, so file times differ
          // everywhere — comparing by size avoids re-copying thousands of identical files.
          "--size-only", "--transfers", "2", "--checkers", "2",
          // Proton throttles bursts (429): keep well under its rate and let rclone retry patiently.
          "--tpslimit", "4", "--tpslimit-burst", "8", "--retries", "5", "--low-level-retries", "20",
          "--stats", "2s", "--stats-one-line", "--stats-log-level", "NOTICE", "-v",
          // A pattern without a "/" matches its name in every folder, the library root included. A
          // leading "**/" would need a folder in front, so root-level files would slip through.
          "--exclude", ".thumbnails/**", "--exclude", ".nomedia", "--exclude", "*.tmp", "--exclude", "*.part",
          "--exclude", ".stfolder/**", "--exclude", ".stignore", "--exclude", "desktop.ini", "--exclude", "Thumbs.db",
          // Soundhood's own per-device files that must never travel: the phone's bin (deleted
          // tracks), conflict copies and snapshots, and the hidden temp files of an in-progress write.
          "--exclude", "_Soundhood/.bin/**", "--exclude", "_Soundhood/conflicts/**",
          "--exclude", "_Soundhood/snapshots/**", "--exclude", ".soundhood-tmp-*"
        )
        val steps = ArrayList<Pair<String, List<String>>>()
        if (args.direction == "down" || args.direction == "both") steps.add("down" to (listOf("copy", remote, local) + common))
        if (args.direction == "up" || args.direction == "both") steps.add("up" to (listOf("copy", local, remote) + common))
        val log = StringBuilder()
        var failed: String? = null
        for ((kind, cmd) in steps) {
          rcloneLine(kind, "[soundhood] ${if (kind == "down") "Proton Drive → phone" else "phone → Proton Drive"} …")
          val r = Rclone.run(ctx, cmd, timeoutSec = 6 * 3600) { rcloneLine(kind, it) }
          log.append("[$kind] exit ${r.exitCode}\n").append(r.output.takeLast(3000)).append('\n')
          if (r.exitCode != 0) { failed = kind; break }
        }
        if (failed != null) {
          val needsLogin = log.contains("401") || log.contains("authentication", true) || log.contains("login", true) && log.contains("fail", true)
          invoke.reject((if (needsLogin) "Proton session expired — connect again.\n" else "Sync failed ($failed).\n") + log.toString().takeLast(3000))
          return@thread
        }
        invoke.resolve(JSObject().apply { put("ok", true); put("log", log.toString().takeLast(4000)) })
      } catch (e: Throwable) {
        Log.e(TAG, "proton sync failed", e)
        invoke.reject(e.message ?: e.toString())
      }
    }
  }

  @Command
  fun protonLogout(invoke: Invoke) {
    Rclone.forget(activity.applicationContext)
    invoke.resolve(JSObject().apply { put("connected", false) })
  }
}
