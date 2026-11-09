// The desktop player bar: now playing (cover, title, add to playlist), the controls, the seek bar,
// volume, shuffle and the position in the list.
import type { CSSProperties } from "react";
import { Dropdown } from "../../app/legacy/Dropdown";
import { NextIcon, PauseIcon, PlayIcon, PrevIcon, ShuffleIcon } from "../../app/legacy/icons";
import { clamp, formatTime } from "../../lib/format";
import type { Library } from "../../hooks/useLibrary";
import type { Player } from "../../hooks/usePlayer";
import type { Playlists } from "../../hooks/usePlaylists";

type PlayerBarProps = {
  lib: Library;
  player: Player;
  playlists: Playlists;
};

export function PlayerBar({ lib, player, playlists }: PlayerBarProps) {
  const { allTracks, playlistFiles, inPlaylist, filteredTracks } = lib;
  const { coverUrl, currentName, currentPlaylist, currentTrack, currentPath, isPlaying, progress, duration, volume, setVolume, shuffle, setShuffle, currentIndex } = player;
  const shownCount = filteredTracks.length;
  return (
    <div className="player">
      <div className="nowPlaying">
        <div className="npArt">{coverUrl ? <img src={coverUrl} alt="" /> : <span>♪</span>}</div>
        <div className="npText">
        <div className="npTitle">{currentName || "Nothing playing"}</div>
        <div className="npSub">
          {currentPlaylist
            ? `${currentTrack?.artist ? currentTrack.artist + " • " : ""}${currentPlaylist}`
            : `All playlists • ${allTracks.length} tracks`}
        </div>
        {currentPath ? (
          <Dropdown
            className="ddSmall"
            up
            value=""
            placeholder="Add to playlist…"
            title="Add the playing track to a playlist"
            options={playlistFiles.filter((p) => !(currentTrack && inPlaylist(p, currentTrack))).map((p) => p.name)}
            onSelect={(name) => { if (currentTrack) playlists.addToPlaylist(name, [currentTrack]); }}
          />
        ) : null}
        </div>
      </div>

      <div className="controls">
        <button className="circle" onClick={player.playPrev} title="Previous"><PrevIcon /></button>
        <button className="circle" onClick={player.togglePlay} title="Play/Pause">{isPlaying ? <PauseIcon /> : <PlayIcon />}</button>
        <button className="circle" onClick={player.playNext} title="Next"><NextIcon /></button>
      </div>

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

      <div className="rightInfo">
        <div className="volume" title={`Volume ${Math.round(volume * 100)}%`}>
          <span>{volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}</span>
          <input
            className="range volRange"
            type="range"
            style={{ "--p": `${volume * 100}%` } as CSSProperties}
            min={0}
            max={1}
            step={0.02}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </div>
        <div style={{ opacity: 0.35 }}>•</div>
        <button
          className={`shuffleBtn ${shuffle ? "on" : ""}`}
          onClick={() => setShuffle((s) => !s)}
          title={shuffle ? "Shuffle is on; click to play in order" : "Shuffle is off; click to shuffle"}
          aria-pressed={shuffle}
        >
          <ShuffleIcon on={shuffle} />
        </button>
        <div style={{ opacity: 0.35 }}>•</div>
        <div>{currentIndex >= 0 ? `${currentIndex + 1}/${shownCount}` : `0/${shownCount}`}</div>
      </div>

    </div>
  );
}
