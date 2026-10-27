package com.mgmat.soundhood.ytdl

import android.content.Context
import android.util.Log
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * rclone (bundled as jniLibs/arm64-v8a/librclone.so, a static Go executable) driven for one purpose:
 * mirroring the Music folder with Proton Drive. All traffic goes through the in-app relay (HTTP_PROXY),
 * for the same reason yt-dlp does. The config lives in the app's private files dir; after the first
 * login only the username and rclone's cached session tokens remain in it — the password is never
 * written to disk (it is passed to that one login run through the environment).
 */
object Rclone {
  private const val TAG = "SoundhoodYtdl"
  const val REMOTE = "proton"

  class Result(val exitCode: Int, val output: String, val timedOut: Boolean)

  fun binary(ctx: Context): File = File(ctx.applicationInfo.nativeLibraryDir, "librclone.so")
  fun configFile(ctx: Context): File = File(ctx.filesDir, "rclone.conf")
  fun isBundled(ctx: Context): Boolean = binary(ctx).exists()
  fun isConnected(ctx: Context): Boolean = configFile(ctx).exists() && configFile(ctx).readText().contains("client_access_token")
  fun username(ctx: Context): String? {
    val f = configFile(ctx)
    if (!f.exists()) return null
    return f.readLines().firstOrNull { it.trim().startsWith("username") }?.substringAfter('=')?.trim()
  }

  fun writeBaseConfig(ctx: Context, username: String) {
    val f = configFile(ctx)
    f.parentFile?.mkdirs()
    f.writeText("[$REMOTE]\ntype = protondrive\nusername = $username\nenable_caching = false\n")
  }

  fun forget(ctx: Context) {
    configFile(ctx).delete()
    File(ctx.filesDir, "rclone-cache").deleteRecursively()
  }

  /** Runs rclone with the given arguments; every output line goes to onLine (and logcat). */
  fun run(ctx: Context, args: List<String>, extraEnv: Map<String, String> = emptyMap(), timeoutSec: Long = 3600, onLine: ((String) -> Unit)? = null): Result {
    val bin = binary(ctx)
    if (!bin.exists()) return Result(127, "rclone is not bundled in this build (librclone.so missing)", false)
    val cmd = ArrayList<String>()
    cmd.add(bin.absolutePath)
    cmd.addAll(args)
    val pb = ProcessBuilder(cmd)
    pb.redirectErrorStream(true)
    val env = pb.environment()
    val proxy = "http://127.0.0.1:" + LocalProxy.start()
    env["HTTP_PROXY"] = proxy
    env["HTTPS_PROXY"] = proxy
    env["NO_PROXY"] = "127.0.0.1,localhost"
    env["RCLONE_CONFIG"] = configFile(ctx).absolutePath
    env["RCLONE_CACHE_DIR"] = File(ctx.filesDir, "rclone-cache").absolutePath
    // Root certificates: a plain Linux build of rclone doesn't know Android's certificate store.
    // Use the CA bundle shipped with the yt-dlp kit's python, or Android's own PEM directory.
    val pyCerts = File(File(ctx.noBackupFilesDir, "youtubedl-android"), "packages/python/usr/etc/tls/cert.pem")
    if (pyCerts.exists()) env["SSL_CERT_FILE"] = pyCerts.absolutePath
    env["SSL_CERT_DIR"] = "/system/etc/security/cacerts"
    env["HOME"] = ctx.filesDir.absolutePath
    env["TMPDIR"] = ctx.cacheDir.absolutePath
    env.putAll(extraEnv)
    val proc = pb.start()
    val out = StringBuilder()
    val reader = thread(isDaemon = true) {
      try {
        proc.inputStream.bufferedReader().forEachLine { line ->
          if (out.length < 200_000) out.append(line).append('\n')
          Log.i(TAG, "rclone: $line")
          onLine?.invoke(line)
        }
      } catch (_: Throwable) {
      }
    }
    val finished = proc.waitFor(timeoutSec, TimeUnit.SECONDS)
    if (!finished) {
      proc.destroyForcibly()
      reader.join(2000)
      return Result(124, out.toString() + "\n(rclone stopped: took longer than ${timeoutSec}s)", true)
    }
    reader.join(5000)
    return Result(proc.exitValue(), out.toString(), false)
  }

  /** `rclone obscure` — the reversible encoding rclone expects for password values. */
  fun obscure(ctx: Context, secret: String): String? {
    val r = run(ctx, listOf("obscure", secret), timeoutSec = 30)
    if (r.exitCode != 0) return null
    return r.output.trim().lines().lastOrNull()?.trim()
  }
}
