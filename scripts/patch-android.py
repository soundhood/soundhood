#!/usr/bin/env python3
"""Re-apply Soundhood's Android customisations after `tauri android init`.

`tauri android init` regenerates src-tauri/gen/android from scratch, which drops:
  - the storage / media / foreground-service permissions in AndroidManifest.xml
  - the "All files access" request in MainActivity.kt
  - the app name in strings.xml
Run from anywhere:  python scripts/patch-android.py
"""
import glob, os, sys

here = os.path.dirname(os.path.abspath(__file__))
main = os.path.join(here, "..", "app", "src-tauri", "gen", "android", "app", "src", "main")
if not os.path.isdir(main):
    sys.exit("gen/android not found — run `npm run tauri android init` first")

# 1. permissions
p = os.path.join(main, "AndroidManifest.xml")
s = open(p, encoding="utf-8").read()
anchor = '    <uses-permission android:name="android.permission.INTERNET" />\n'
block = '''
    <!-- Soundhood: the library is a real folder tree the user owns (default /storage/emulated/0/Music).
         "All files access" lets the app read/write it directly (m3u8 playlists included). -->
    <uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />
    <!-- background playback (native audio service), added ahead of the player work -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
'''
if "MANAGE_EXTERNAL_STORAGE" not in s:
    if anchor not in s:
        sys.exit("manifest anchor not found — Tauri template changed; patch by hand")
    s = s.replace(anchor, anchor + block, 1)
    open(p, "w", encoding="utf-8", newline="").write(s)
    print("manifest: permissions added")
else:
    print("manifest: already patched")

# 1b. share sheet target (SEND text/plain) on MainActivity
s = open(p, encoding="utf-8").read()
if "android.intent.action.SEND" not in s:
    anchor2 = '                <!-- AndroidTV support -->\n                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />\n            </intent-filter>\n'
    if anchor2 not in s:
        sys.exit("manifest launcher intent-filter not found — patch the share intent-filter by hand")
    s = s.replace(anchor2, anchor2 + '            <!-- Soundhood: appears in the Android share sheet for links/text (YouTube tab in Brave -> Soundhood) -->\n            <intent-filter>\n                <action android:name="android.intent.action.SEND" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <data android:mimeType="text/plain" />\n            </intent-filter>\n', 1)
    open(p, "w", encoding="utf-8", newline="").write(s)
    print("manifest: share intent-filter added")
else:
    print("manifest: share intent-filter already present")

# 2. MainActivity: ask for All-files access once
mas = glob.glob(os.path.join(main, "java", "com", "*", "*", "MainActivity.kt"))
if not mas:
    sys.exit("MainActivity.kt not found")
ma = mas[0]
pkg = ".".join(os.path.relpath(os.path.dirname(ma), os.path.join(main, "java")).split(os.sep))
src = f'''package {pkg}

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import org.json.JSONObject
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {{
  override fun onCreate(savedInstanceState: Bundle?) {{
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Edge-to-edge is forced on Android 15+, which draws the web UI under the status bar and the
    // gesture bar. Pad the content by the system bars instead, on a dark background, light icons.
    val root = findViewById<View>(android.R.id.content)
    window.decorView.setBackgroundColor(Color.parseColor("#0f0f0f"))
    WindowCompat.getInsetsController(window, root).isAppearanceLightStatusBars = false
    WindowCompat.getInsetsController(window, root).isAppearanceLightNavigationBars = false
    ViewCompat.setOnApplyWindowInsetsListener(root) {{ v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      insets
    }}
    // Let the webview finish loading the UI before bouncing to the system permission screen —
    // if the app goes to the background mid-load, Android throttles its requests and the page stays blank.
    Handler(Looper.getMainLooper()).postDelayed({{ requestAllFilesAccessIfNeeded() }}, 2500)
    handleShare(intent)
  }}

  override fun onNewIntent(intent: Intent) {{
    super.onNewIntent(intent)
    setIntent(intent)
    handleShare(intent)
  }}

  // Share sheet: another app (Brave, YouTube) sends us text/a link. Hand it to the web UI as
  // window.__soundhoodShare(text); retried until the page is up (cold start).
  private var pendingShare: String? = null
  private fun handleShare(intent: Intent?) {{
    if (intent == null || intent.action != Intent.ACTION_SEND) return
    val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
    intent.action = null
    pendingShare = text
    deliverShare(0)
  }}
  private fun deliverShare(attempt: Int) {{
    val text = pendingShare ?: return
    val wv = findWebView(findViewById(android.R.id.content))
    if (wv == null) {{
      if (attempt < 60) Handler(Looper.getMainLooper()).postDelayed({{ deliverShare(attempt + 1) }}, 500)
      return
    }}
    val js = "(function(){{ if (window.__soundhoodShare) {{ window.__soundhoodShare(" + JSONObject.quote(text) + "); return 'ok'; }} return 'no'; }})()"
    wv.evaluateJavascript(js) {{ result ->
      if (result != null && result.contains("ok")) pendingShare = null
      else if (attempt < 60) Handler(Looper.getMainLooper()).postDelayed({{ deliverShare(attempt + 1) }}, 500)
    }}
  }}
  private fun findWebView(v: View?): WebView? {{
    if (v is WebView) return v
    if (v is ViewGroup) {{
      for (i in 0 until v.childCount) {{
        val r = findWebView(v.getChildAt(i))
        if (r != null) return r
      }}
    }}
    return null
  }}

  // Soundhood reads and writes the user's own Music folder tree directly (playlists are files in it).
  // On Android 11+ that needs "All files access", which is granted on a system settings screen.
  private fun requestAllFilesAccessIfNeeded() {{
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
    if (Environment.isExternalStorageManager()) return
    try {{
      val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
      intent.data = Uri.parse("package:$packageName")
      startActivity(intent)
    }} catch (_: Exception) {{
      startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
    }}
  }}
}}
'''
open(ma, "w", encoding="utf-8", newline="").write(src)
print(f"MainActivity: written for package {pkg}")

# 3. app name
p = os.path.join(main, "res", "values", "strings.xml")
t = open(p, encoding="utf-8").read()
t2 = t.replace(">soundhood<", ">Soundhood<").replace(">tauri-app<", ">Soundhood<").replace('>"soundhood"<', '>"Soundhood"<')
if t2 != t:
    open(p, "w", encoding="utf-8", newline="").write(t2)
    print("strings: app name set to Soundhood")
else:
    print("strings: ok")

# 4. youtubedl-android needs the native libs extracted to disk (python/ffmpeg are executables)
p = os.path.join(main, "AndroidManifest.xml")
s = open(p, encoding="utf-8").read()
if "extractNativeLibs" not in s:
    s = s.replace("    <application\n", "    <application\n        android:extractNativeLibs=\"true\"\n", 1)
    open(p, "w", encoding="utf-8", newline="").write(s)
    print("manifest: extractNativeLibs added")
else:
    print("manifest: extractNativeLibs ok")
p = os.path.join(main, "..", "..", "build.gradle.kts")
s = open(p, encoding="utf-8").read()
if "useLegacyPackaging" not in s:
    anchor3 = "    buildFeatures {\n        buildConfig = true\n    }\n"
    if anchor3 not in s:
        sys.exit("build.gradle.kts buildFeatures block not found — add packaging { jniLibs { useLegacyPackaging = true } } by hand")
    s = s.replace(anchor3, anchor3 + "    // youtubedl-android runs python/ffmpeg as executables: the .so files must exist on disk, not stay inside the APK\n    packaging {\n        jniLibs {\n            useLegacyPackaging = true\n        }\n    }\n", 1)
    open(p, "w", encoding="utf-8", newline="").write(s)
    print("gradle: useLegacyPackaging added")
else:
    print("gradle: useLegacyPackaging ok")
