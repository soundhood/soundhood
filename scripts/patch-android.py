#!/usr/bin/env python3
"""Re-apply Soundhood's app-level Android customisations after `tauri android init`.

`tauri android init` regenerates app/src-tauri/gen/android from the Tauri template and drops what
Soundhood adds on top. Everything a library manifest can declare (storage, foreground-service,
notification and wake-lock permissions, extractNativeLibs) lives in the soundhood-ytdl plugin's own
AndroidManifest.xml and merges into the app by itself. What is left is app-level, re-applied here:

  1. AndroidManifest.xml  the share-sheet target (SEND text/plain) on MainActivity; no backups
                          (rclone.conf in the app's files holds the Proton session tokens)
  2. MainActivity.kt      system-bar insets, share delivery to the web UI, the delayed All-files request
  3. strings.xml          the app name
  4. app/build.gradle.kts SDK levels, useLegacyPackaging, release signing
  5. gradle-wrapper.properties  the pinned Gradle zip's SHA-256 (distributionSha256Sum)

Idempotent: files are written only when their content changes, so a second run reports "ok" for
every step. Line endings of each file are kept. Run from anywhere:

    python scripts/patch-android.py

Exit code 0 when everything is patched; 1 when a template anchor is missing (patch that step by hand).
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ANDROID = os.path.join(HERE, "..", "app", "src-tauri", "gen", "android")
MAIN = os.path.join(ANDROID, "app", "src", "main")

# targetSdk changes runtime behaviour on newer Android versions: bump it on purpose, after testing on
# the phone, not whenever the Tauri template moves.
COMPILE_SDK = 36
TARGET_SDK = 36


class TemplateChanged(Exception):
    """A step's anchor is missing from the generated file."""


def read(path):
    """Return (text with \\n newlines, newline the file uses)."""
    with open(path, "rb") as f:
        raw = f.read().decode("utf-8")
    newline = "\r\n" if "\r\n" in raw else "\n"
    return raw.replace("\r\n", "\n"), newline


def patch_file(path, steps):
    """Apply `steps` (label, fn(text) -> text) to one file; write it once, only if it changed."""
    original, newline = read(path)
    text = original
    for label, fn in steps:
        after = fn(text)
        print(f"{label}: {'patched' if after != text else 'ok'}")
        text = after
    if text != original:
        with open(path, "wb") as f:
            f.write(text.replace("\n", newline).encode("utf-8"))


def insert_after(text, anchor, block, what):
    if anchor not in text:
        raise TemplateChanged(what)
    return text.replace(anchor, anchor + block, 1)


def insert_before(text, anchor, block, what):
    if anchor not in text:
        raise TemplateChanged(what)
    return text.replace(anchor, block + anchor, 1)


# 1. Manifest ---------------------------------------------------------------------------------------

SHARE_FILTER = """\
{i}<!-- Soundhood: appears in the Android share sheet for links and text (a video link -> Soundhood) -->
{i}<intent-filter>
{i}    <action android:name="android.intent.action.SEND" />
{i}    <category android:name="android.intent.category.DEFAULT" />
{i}    <data android:mimeType="text/plain" />
{i}</intent-filter>
"""

# What older versions of this script put into the app manifest; the plugin manifest declares it now.
LEGACY_PERMISSIONS = re.compile(
    r"\n    <!-- Soundhood: the library is a real folder tree.*?"
    r'<uses-permission android:name="android.permission.WAKE_LOCK" />\n',
    re.S,
)


def share_filter(s):
    if "android.intent.action.SEND" in s:
        return s
    m = re.search(
        r'([ \t]*)<intent-filter>\s*<action android:name="android\.intent\.action\.MAIN" />.*?</intent-filter>\n',
        s,
        re.S,
    )
    if not m:
        raise TemplateChanged("the launcher <intent-filter> of MainActivity")
    return s[: m.end()] + SHARE_FILTER.format(i=m.group(1)) + s[m.end() :]


def no_backup(s):
    """android:allowBackup="false": rclone.conf (Proton session tokens) must not leave the phone
    through Android backup."""
    if 'android:allowBackup="false"' in s:
        return s
    if "android:allowBackup=" in s:
        return re.sub(r'android:allowBackup="[^"]*"', 'android:allowBackup="false"', s, count=1)
    m = re.search(r"([ \t]*)<application\b", s)
    if not m:
        raise TemplateChanged("the <application> element")
    attr_indent = m.group(1) + "    "
    return s[: m.end()] + "\n" + attr_indent + 'android:allowBackup="false"' + s[m.end() :]


def drop_legacy_manifest_items(s):
    s = LEGACY_PERMISSIONS.sub("", s, count=1)
    return s.replace('    <application\n        android:extractNativeLibs="true"\n', "    <application\n", 1)


# 2. MainActivity -----------------------------------------------------------------------------------

MAIN_ACTIVITY = """\
package {pkg}

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
    // Let the webview finish loading the UI before bouncing to the system permission screen:
    // if the app goes to the background mid-load, Android throttles its requests and the page stays blank.
    Handler(Looper.getMainLooper()).postDelayed({{ requestAllFilesAccessIfNeeded() }}, 2500)
    handleShare(intent)
  }}

  override fun onNewIntent(intent: Intent) {{
    super.onNewIntent(intent)
    setIntent(intent)
    handleShare(intent)
  }}

  // Share sheet: another app (a browser, YouTube) sends us text/a link. Hand it to the web UI as
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
"""


def find_main_activity():
    """MainActivity.kt under java/<package path>/, skipping Tauri's generated/ folder."""
    java = os.path.join(MAIN, "java")
    for dirpath, dirnames, filenames in os.walk(java):
        dirnames[:] = [d for d in dirnames if d != "generated"]
        if "MainActivity.kt" in filenames:
            pkg = ".".join(os.path.relpath(dirpath, java).split(os.sep))
            return os.path.join(dirpath, "MainActivity.kt"), pkg
    raise TemplateChanged("MainActivity.kt")


# 3. App name ---------------------------------------------------------------------------------------


def app_name(t):
    return t.replace(">soundhood<", ">Soundhood<").replace(">tauri-app<", ">Soundhood<").replace(
        '>"soundhood"<', '>"Soundhood"<'
    )


# 4. app/build.gradle.kts ---------------------------------------------------------------------------

SIGNING_PRELUDE = """\
// Soundhood release signing (re-applied by scripts/patch-android.py). Every APK installed on the phone
// must carry the same key: Android refuses an update signed with another one, and uninstalling wipes
// the app's data. The key stays outside the repo, described by a keystore.properties file (storeFile,
// storePassword, keyAlias, keyPassword; a relative storeFile is relative to that file) found at
// $SOUNDHOOD_KEYSTORE_PROPERTIES, else <user home>/.soundhood/keystore.properties. Without that file
// the release is signed with this machine's Android debug key, which signed the builds installed so far.
val soundhoodKeystoreFile: File = providers.environmentVariable("SOUNDHOOD_KEYSTORE_PROPERTIES").orNull
    ?.takeIf { it.isNotBlank() }
    ?.let { File(it) }
    ?: File(
        providers.environmentVariable("USERPROFILE").orNull ?: System.getProperty("user.home"),
        ".soundhood/keystore.properties"
    )
val soundhoodKeystore: Properties? = soundhoodKeystoreFile.takeIf { it.isFile }?.let { f ->
    Properties().apply { f.inputStream().use { load(it) } }
}
if (soundhoodKeystore == null) {
    val note = "Soundhood: $soundhoodKeystoreFile not found, so the release APK is signed with " +
        "this machine's Android debug key (~/.android/debug.keystore)"
    // Said when a release is packaged (not while configuring), so configuration-cache hits show it too.
    tasks.configureEach {
        if (name.startsWith("package") && name.endsWith("Release")) {
            doFirst { logger.warn("w: $note") }
        }
    }
}
"""

SIGNING_CONFIGS = """\
    signingConfigs {
        soundhoodKeystore?.let { ks ->
            create("release") {
                val missing = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
                    .filter { ks.getProperty(it).isNullOrBlank() }
                if (missing.isNotEmpty()) {
                    throw GradleException("$soundhoodKeystoreFile lacks ${missing.joinToString()}")
                }
                storeFile = soundhoodKeystoreFile.parentFile.resolve(ks.getProperty("storeFile"))
                storePassword = ks.getProperty("storePassword")
                keyAlias = ks.getProperty("keyAlias")
                keyPassword = ks.getProperty("keyPassword")
            }
        }
    }
"""

RELEASE_SIGNING = """\
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
"""

LEGACY_PACKAGING = """\
    // youtubedl-android runs python/ffmpeg as executables: the .so files must exist on disk, not stay inside the APK
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }
"""


def sdk_levels(s):
    for key, level in (("compileSdk", COMPILE_SDK), ("targetSdk", TARGET_SDK)):
        if not re.search(rf"\b{key} = \d+", s):
            raise TemplateChanged(key)
        s = re.sub(rf"\b{key} = \d+", f"{key} = {level}", s, count=1)
    return s


def legacy_packaging(s):
    if "useLegacyPackaging" in s:
        return s
    anchor = "    buildFeatures {\n        buildConfig = true\n    }\n"
    return insert_after(s, anchor, LEGACY_PACKAGING, "the buildFeatures { buildConfig = true } block")


def signing(s):
    if "SOUNDHOOD_KEYSTORE_PROPERTIES" not in s:
        s = insert_before(s, "\nandroid {\n", "\n" + SIGNING_PRELUDE, "the top-level android { block")
    if "signingConfigs {" not in s:
        s = insert_before(s, "    buildTypes {\n", SIGNING_CONFIGS, "the buildTypes { block")
    if "signingConfig = " not in s:
        s = insert_after(s, '        getByName("release") {\n', RELEASE_SIGNING, 'the getByName("release") block')
    return s


# 5. gradle/wrapper/gradle-wrapper.properties -------------------------------------------------------

# The Gradle the wrapper downloads and the SHA-256 published for that zip
# (https://services.gradle.org/distributions/gradle-<version>-bin.zip.sha256). `tauri android init`
# writes the URL but not the checksum; without it the wrapper runs whatever it downloaded. Bump both
# together, on purpose.
GRADLE_VERSION = "9.6.1"
GRADLE_SHA256 = "9c0f7faeeb306cb14e4279a3e084ca6b596894089a0638e68a07c945a32c9e14"


def gradle_checksum(s):
    m = re.search(r"^distributionUrl=.*/gradle-([0-9][0-9.]*)-(bin|all)\.zip[ \t]*$", s, re.M)
    if not m:
        raise TemplateChanged("the distributionUrl line")
    if (m.group(1), m.group(2)) != (GRADLE_VERSION, "bin"):
        raise TemplateChanged(
            f"Gradle {m.group(1)}-{m.group(2)} in the wrapper, pinned is {GRADLE_VERSION}-bin; "
            "update GRADLE_VERSION and GRADLE_SHA256"
        )
    line = f"distributionSha256Sum={GRADLE_SHA256}"
    if re.search(r"^distributionSha256Sum=", s, re.M):
        return re.sub(r"^distributionSha256Sum=.*$", line, s, count=1, flags=re.M)
    return s.replace(m.group(0), m.group(0) + "\n" + line, 1)


def main():
    if not os.path.isdir(MAIN):
        sys.exit("gen/android not found: run `npm run tauri android init` in app/ first")
    try:
        patch_file(
            os.path.join(MAIN, "AndroidManifest.xml"),
            [
                ("manifest: share intent-filter", share_filter),
                ("manifest: no app-level permissions (the plugin declares them)", drop_legacy_manifest_items),
                # After the legacy clean-up, whose anchor is the line right after <application.
                ("manifest: allowBackup=false", no_backup),
            ],
        )

        path, pkg = find_main_activity()
        text, newline = read(path)
        wanted = MAIN_ACTIVITY.format(pkg=pkg)
        print(f"MainActivity ({pkg}): {'written' if text != wanted else 'ok'}")
        if text != wanted:
            with open(path, "wb") as f:
                f.write(wanted.replace("\n", newline).encode("utf-8"))

        patch_file(os.path.join(MAIN, "res", "values", "strings.xml"), [("strings: app name", app_name)])

        patch_file(
            os.path.join(ANDROID, "app", "build.gradle.kts"),
            [
                (f"gradle: compileSdk/targetSdk {COMPILE_SDK}/{TARGET_SDK}", sdk_levels),
                ("gradle: useLegacyPackaging", legacy_packaging),
                ("gradle: release signing", signing),
            ],
        )

        patch_file(
            os.path.join(ANDROID, "gradle", "wrapper", "gradle-wrapper.properties"),
            [(f"gradle wrapper: distributionSha256Sum for Gradle {GRADLE_VERSION}", gradle_checksum)],
        )
    except TemplateChanged as e:
        print(f"anchor not found ({e}): the Tauri template changed; patch that step by hand", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
