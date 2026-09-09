package com.mgmat.soundhood.ytdl

import android.util.Log
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

/**
 * A tiny HTTP proxy on 127.0.0.1 for the bundled yt-dlp. Name resolution and the outgoing
 * connections happen here, in the app's own (Java) network stack — the python process only ever
 * talks to localhost. Supports CONNECT (all of YouTube is https) and plain absolute-URL requests.
 */
object LocalProxy {
  private const val TAG = "SoundhoodYtdl"
  private var server: ServerSocket? = null
  @Volatile var port: Int = 0
    private set

  @Synchronized
  fun start(): Int {
    server?.let { if (!it.isClosed) return port }
    // Explicit 127.0.0.1: Android's getLoopbackAddress() is ::1, which python's 127.0.0.1 cannot reach.
    val ss = ServerSocket(0, 50, InetAddress.getByAddress("localhost", byteArrayOf(127, 0, 0, 1)))
    server = ss
    port = ss.localPort
    thread(name = "sh-proxy-accept", isDaemon = true) {
      while (!ss.isClosed) {
        val client = try { ss.accept() } catch (e: Exception) { break }
        thread(isDaemon = true) { try { handle(client) } catch (e: Throwable) { Log.w(TAG, "proxy: ${e.message}") } finally { try { client.close() } catch (_: Exception) {} } }
      }
    }
    Log.i(TAG, "proxy: listening on 127.0.0.1:$port")
    return port
  }

  private fun readLine(input: InputStream): String? {
    val sb = StringBuilder()
    while (true) {
      val b = input.read()
      if (b < 0) return if (sb.isEmpty()) null else sb.toString()
      if (b == '\n'.code) break
      if (b != '\r'.code) sb.append(b.toChar())
      if (sb.length > 16384) return null
    }
    return sb.toString()
  }

  private fun pipe(from: InputStream, to: OutputStream) {
    val buf = ByteArray(64 * 1024)
    try {
      while (true) {
        val n = from.read(buf)
        if (n < 0) break
        to.write(buf, 0, n)
        to.flush()
      }
    } catch (_: Exception) {
    }
  }

  private fun connectAny(host: String, port: Int): Socket? {
    val addrs = try { InetAddress.getAllByName(host).toList() } catch (e: Exception) {
      Log.w(TAG, "proxy: cannot resolve $host — ${e.message}"); return null
    }
    val ordered = addrs.filter { it is java.net.Inet4Address } + addrs.filter { it !is java.net.Inet4Address }
    var lastErr: String? = null
    for (a in ordered) {
      val s = Socket()
      try {
        s.connect(InetSocketAddress(a, port), 10000)
        return s
      } catch (e: Exception) {
        lastErr = "${a.hostAddress}: ${e.message}"
        Log.w(TAG, "proxy: $host -> $lastErr")
        try { s.close() } catch (_: Exception) {}
      }
    }
    Log.w(TAG, "proxy: cannot reach $host:$port (${addrs.size} address(es); last: $lastErr)")
    return null
  }

  private fun handle(client: Socket) {
    client.soTimeout = 30000
    val input = client.getInputStream()
    val out = client.getOutputStream()
    val requestLine = readLine(input) ?: return
    val headers = ArrayList<String>()
    while (true) {
      val l = readLine(input) ?: return
      if (l.isEmpty()) break
      headers.add(l)
    }
    val parts = requestLine.split(' ')
    if (parts.size < 2) return
    val method = parts[0]
    val target = parts[1]

    val host: String
    val port: Int
    var forwardHead: ByteArray? = null
    if (method == "CONNECT") {
      host = target.substringBeforeLast(':')
      port = target.substringAfterLast(':').toIntOrNull() ?: 443
    } else {
      // absolute-URL request: http://host[:port]/path
      val noScheme = target.substringAfter("://", target)
      val hostPort = noScheme.substringBefore('/')
      val path = "/" + noScheme.substringAfter('/', "")
      host = hostPort.substringBefore(':')
      port = hostPort.substringAfter(':', "80").toIntOrNull() ?: 80
      val sb = StringBuilder()
      sb.append(method).append(' ').append(path).append(' ').append(if (parts.size > 2) parts[2] else "HTTP/1.1").append("\r\n")
      for (h in headers) {
        if (h.startsWith("Proxy-", ignoreCase = true)) continue
        sb.append(h).append("\r\n")
      }
      sb.append("\r\n")
      forwardHead = sb.toString().toByteArray()
    }

    // Resolve here (the app's resolver), then try IPv4 addresses first, IPv6 after — like a browser
    // does, because on some networks IPv6 is advertised but not routed.
    val remote = connectAny(host, port)
    if (remote == null) {
      out.write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n".toByteArray())
      out.flush()
      return
    }
    remote.use { r ->
      r.soTimeout = 0
      client.soTimeout = 0
      val rOut = r.getOutputStream()
      if (method == "CONNECT") {
        out.write("HTTP/1.1 200 Connection established\r\n\r\n".toByteArray())
        out.flush()
      } else {
        rOut.write(forwardHead!!)
        rOut.flush()
      }
      val up = thread(isDaemon = true) {
        pipe(input, rOut)
        try { r.shutdownOutput() } catch (_: Exception) {}
      }
      pipe(r.getInputStream(), out)
      try { client.shutdownOutput() } catch (_: Exception) {}
      up.join(2000)
    }
  }
}
