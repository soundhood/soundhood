// The phone's full-screen player: back, where it plays from, cover, title and artist, the seek bar,
// the controls and add to playlist.
import type { CSSProperties } from "react";
import { Dropdown } from "../../app/legacy/Dropdown";
import { ChevronIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, ShuffleIcon } from "../../app/legacy/icons";
import { clamp, formatTime } from "../../lib/format";
import type { Library } from "../../hooks/useLibrary";
import type { PhoneLayout } from "../../hooks/usePhoneLayout";
import type { Player } from "../../hooks/usePlayer";
import type { Playlists } from "../../hooks/usePlaylists";

type PhonePlayerProps = {
  lib: Library;
  player: Player;
  playlists: Playlists;
  phone: PhoneLayout;
};

export function PhonePlayer({ lib, player, playlists, phone }: PhonePlayerProps) {
  const { playlistFiles, inPlaylist, filteredTracks } = lib;
  const { coverUrl, currentName, currentPlaylist, currentTrack, currentPath, currentIndex, isPlaying, progress, duration, shuffle, setShuffle } = player;
  const shownCount = filteredTracks.length;
  return (
    <div className="mPlayer">
      <div className="mPlayerTop">
        <button className="iconBtn" onClick={() => phone.setMScreen("tracks")} title="Back to the list"><ChevronIcon dir="down" /></button>
        <div className="dimText mPlayerFrom">{currentPlaylist || "All tracks"}</div>
        <div className="dimText">{currentIndex >= 0 ? `${currentIndex + 1}/${shownCount}` : `0/${shownCount}`}</div>
      </div>
      <div className={`mPlayerArt ${coverUrl ? "hasArt" : ""}`}>{coverUrl ? <img src={coverUrl} alt="" /> : <span>♪</span>}</div>
      <div className="mPlayerTitle">{currentName || "Nothing playing"}</div>
      <div className="mPlayerSub">{currentTrack?.artist || " "}</div>
      <div className="timeline">
        <div className="time">{formatTime(progress)}</div>
        <input
          className="range"
          type="range"
          style={{ "--p": `${duration ? (clamp(progress, 0, duration) / duration) * 100 : 0}%` } as CSSProperties}
          min={0}
          max={duration || 0}
          step={0.25}
          value={clamp(progress, 0, duration || 0)}
          onChange={(e) => player.seekTo(e.target.value)}
        />
        <div className="time">{formatTime(duration)}</div>
      </div>
      <div className="mPlayerControls">
        <button
          className={`shuffleBtn ${shuffle ? "on" : ""}`}
          onClick={() => setShuffle((s) => !s)}
          aria-pressed={shuffle}
          title={shuffle ? "Shuffle is on" : "Shuffle is off"}
        >
          <ShuffleIcon on={shuffle} />
        </button>
        <button className="circle" onClick={player.playPrev} title="Previous"><PrevIcon size={22} /></button>
        <button className="circle big" onClick={player.togglePlay} title="Play/Pause">{isPlaying ? <PauseIcon size={28} /> : <PlayIcon size={28} />}</button>
        <button className="circle" onClick={player.playNext} title="Next"><NextIcon size={22} /></button>
        <span className="shuffleBtn" style={{ visibility: "hidden" }} />
      </div>
      {currentPath ? (
        <div className="mPlayerAdd">
          <Dropdown
            up
            value=""
            placeholder="Add to playlist…"
            title="Add the playing track to a playlist"
            options={playlistFiles.filter((p) => !(currentTrack && inPlaylist(p, currentTrack))).map((p) => p.name)}
            onSelect={(name) => { if (currentTrack) playlists.addToPlaylist(name, [currentTrack]); }}
          />
        </div>
      ) : null}
    </div>
  );
}
