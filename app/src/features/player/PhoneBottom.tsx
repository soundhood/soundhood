// The phone's bottom block: the mini player (with its progress line) over the tab bar. Its height
// is measured, so the full-screen player stops above it.
import { NextIcon, PauseIcon, PlayIcon } from "../../app/legacy/icons";
import type { Library } from "../../hooks/useLibrary";
import type { PhoneLayout } from "../../hooks/usePhoneLayout";
import type { Player } from "../../hooks/usePlayer";

type PhoneBottomProps = {
  lib: Library;
  player: Player;
  phone: PhoneLayout;
};

export function PhoneBottom({ lib, player, phone }: PhoneBottomProps) {
  const { sideTab, setSideTab } = lib;
  const { currentPath, coverUrl, currentName, currentTrack, currentPlaylist, isPlaying, progress, duration } = player;
  const { mScreen, setMScreen, mBottomRef } = phone;
  return (
    <div className="mBottom" ref={mBottomRef}>
      {currentPath && mScreen !== "player" ? (
        <div className="miniBar" onClick={() => setMScreen("player")} title="Open the player">
          <div className="miniArt">{coverUrl ? <img src={coverUrl} alt="" /> : <span>♪</span>}</div>
          <div className="miniInfo">
            <div className="npTitle">{currentName}</div>
            <div className="npSub">{currentTrack?.artist || currentPlaylist || ""}</div>
          </div>
          <button className="circle" onClick={(e) => { e.stopPropagation(); player.togglePlay(); }} title="Play/Pause">{isPlaying ? <PauseIcon /> : <PlayIcon />}</button>
          <button className="circle" onClick={(e) => { e.stopPropagation(); player.playNext(); }} title="Next"><NextIcon /></button>
        </div>
      ) : null}
      {currentPath && mScreen !== "player" ? (
        <div className="miniProgress"><div style={{ width: `${duration ? (progress / duration) * 100 : 0}%` }} /></div>
      ) : null}
      <nav className="tabBar">
        <button className={`tabBtn ${mScreen !== "player" && sideTab === "playlists" ? "active" : ""}`} onClick={() => { setSideTab("playlists"); setMScreen("browse"); }}>Playlists</button>
        <button className={`tabBtn ${mScreen !== "player" && sideTab === "artists" ? "active" : ""}`} onClick={() => { setSideTab("artists"); setMScreen("browse"); }}>Artists</button>
        <button className={`tabBtn ${mScreen !== "player" && sideTab === "folders" ? "active" : ""}`} onClick={() => { setSideTab("folders"); setMScreen("browse"); }}>Folders</button>
        <button className={`tabBtn ${mScreen === "player" ? "active" : ""}`} onClick={() => setMScreen("player")} disabled={!currentPath}>Playing</button>
      </nav>
    </div>
  );
}
