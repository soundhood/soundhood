# Soundhood

A local-first music player and user-invoked downloader for desktop (Windows/Linux) and, in progress, Android.
Your folders are the library; playlists are small text files; no cloud, no accounts, no DRM, no telemetry.

## What this is
- A player that treats your own files as the source of truth.
- Playlists as plain `.m3u8` files (a song can be in many), artists from tags, folders as storage.
- An optional helper: paste a YouTube URL, pick a folder and playlists, get a tagged audio file (yt-dlp + ffmpeg).

## What this is NOT
- A streaming service.
- A DRM bypass toolkit.
- A tracker.

## Core principles
- Local-first by default
- Privacy by design
- Transparent file structure
- Cross-platform parity (desktop + phone)

## Docs
- PROJECT.md
- docs/
- LEGAL.md

## Status
Desktop app working (Tauri v2 · React · Rust). Android build in progress. Code name in paths and crates: `music-hood`.
