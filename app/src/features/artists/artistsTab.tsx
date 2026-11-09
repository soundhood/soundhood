// The Artists tab: every artist named in a tag with their track count, across every folder.
import type { BrowseTabArgs } from "../library/browseTypes";

export function renderArtistsTab({ isMobile, lib, player, goTracks }: BrowseTabArgs) {
  const { artistQuery, setArtistQuery, shownArtists, artistView, setArtistView, setPlView } = lib;
  return (
    <>
      <div className="searchRow">
        <input
          className="search"
          placeholder="Filter artists…"
          value={artistQuery}
          onChange={(e) => setArtistQuery(e.target.value)}
        />
      </div>
      <div className="list">
        {shownArtists.map((a) => (
          <div
            key={a.name}
            className={`pill artistPill ${a.name === artistView ? "active" : ""}`}
            onClick={() => { setPlView(""); if (isMobile) { setArtistView(a.name); goTracks(); } else setArtistView((cur) => (cur === a.name ? "" : a.name)); }}
            onDoubleClick={() => player.shufflePlayArtist(a.name)}
            title={`All ${a.count} track${a.count === 1 ? "" : "s"} by ${a.name}, across every folder · double-click to shuffle-play`}
          >
            <span className="artistName">{a.name}</span>
            <span className="artistCount">{a.count}</span>
          </div>
        ))}
      </div>
    </>
  );
}
