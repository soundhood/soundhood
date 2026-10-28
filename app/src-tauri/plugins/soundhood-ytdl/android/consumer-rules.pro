# R8 rules for any app that includes soundhood-ytdl (applied to the app's minified release).
#
# youtubedl-android has only ever run unminified on the phone (debug builds). Keep it, and the
# commons-compress code it unpacks python/ffmpeg with, exactly as shipped so a release behaves like
# the debug build: its updater parses GitHub's release JSON through Jackson.
-keep class com.yausername.** { *; }
-keep class org.apache.commons.compress.** { *; }
# XZ/7z support in commons-compress is an optional dependency that youtubedl-android does not ship.
-dontwarn org.tukaani.xz.**
