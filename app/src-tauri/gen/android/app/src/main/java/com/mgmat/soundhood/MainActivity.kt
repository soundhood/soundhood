package com.mgmat.soundhood

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
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Edge-to-edge is forced on Android 15+, which draws the web UI under the status bar and the
    // gesture bar. Pad the content by the system bars instead, on a dark background, light icons.
    val root = findViewById<View>(android.R.id.content)
    window.decorView.setBackgroundColor(Color.parseColor("#0f0f0f"))
    WindowCompat.getInsetsController(window, root).isAppearanceLightStatusBars = false
    WindowCompat.getInsetsController(window, root).isAppearanceLightNavigationBars = false
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      insets
    }
    // Let the webview finish loading the UI before bouncing to the system permission screen —
    // if the app goes to the background mid-load, Android throttles its requests and the page stays blank.
    Handler(Looper.getMainLooper()).postDelayed({ requestAllFilesAccessIfNeeded() }, 2500)
  }

  // Soundhood reads and writes the user's own Music folder tree directly (playlists are files in it).
  // On Android 11+ that needs "All files access", which is granted on a system settings screen.
  private fun requestAllFilesAccessIfNeeded() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
    if (Environment.isExternalStorageManager()) return
    try {
      val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
      intent.data = Uri.parse("package:$packageName")
      startActivity(intent)
    } catch (_: Exception) {
      startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
    }
  }
}
