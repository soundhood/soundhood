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
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {{
  override fun onCreate(savedInstanceState: Bundle?) {{
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Let the webview finish loading the UI before bouncing to the system permission screen —
    // if the app goes to the background mid-load, Android throttles its requests and the page stays blank.
    Handler(Looper.getMainLooper()).postDelayed({{ requestAllFilesAccessIfNeeded() }}, 2500)
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
