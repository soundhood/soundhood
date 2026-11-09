// Fixture pages: the player surfaces.
import { useState } from "react";
import { FullPlayer } from "../../components/FullPlayer";
import { Hairline } from "../../components/Hairline";
import { LyricsPane, type LyricLine } from "../../components/LyricsPane";
import { MenuButton } from "../../components/Menu";
import { MiniPlayer } from "../../components/MiniPlayer";
import { Queue } from "../../components/Queue";
import { Transport, type RepeatMode } from "../../components/Transport";
import { AppShell, POSITION, getProgress, useQueueFixture } from "../appShell";
import { NOW, TINT, TRACKS, noop } from "../data";
import { Box, Cols, Demo, Page, Stack, Surface } from "../frame";

function HairlinePage() {
  return (
    <Page title="Hairline" note="2 px of aqua scaled by the playing position, moved by requestAnimationFrame, no transition.">
      {[0, 0.42, 1].map((p) => (
        <Demo key={p} label={`${Math.round(p * 100)} %`}>
          <Surface>
            <div className="Fx-strip">
              <Hairline getProgress={() => p} />
            </div>
          </Surface>
        </Demo>
      ))}
    </Page>
  );
}

function MiniPlayerPage() {
  const [playing, setPlaying] = useState(true);
  const long = TRACKS[7];
  return (
    <Page
      title="MiniPlayer"
      note="56 px on --bg-1 with the hairline on top; the cover glows with the artwork tint. Tap or swipe up opens the player."
      tint={TINT}
    >
        <Demo label="Playing">
          <Surface flush>
            <MiniPlayer
              title={NOW.title}
              artist={NOW.artist}
              cover={NOW.cover}
              playing={playing}
              onPlayPause={() => setPlaying(!playing)}
              getProgress={getProgress}
            />
          </Surface>
        </Demo>
        <Demo label="Paused, a long title">
          <Surface flush>
            <MiniPlayer
              title={`${long.title} (Extended Night Version, Remastered)`}
              artist={`${long.artist} and the Saltwater Radio Orchestra`}
              cover={long.cover}
              playing={false}
              getProgress={() => 0.8}
            />
          </Surface>
        </Demo>
        <Demo label="No cover">
          <Surface flush>
            <MiniPlayer title="Voice memo 14" artist="Unknown artist" playing={false} getProgress={() => 0.1} />
          </Surface>
        </Demo>
    </Page>
  );
}

const more = <MenuButton label="More for Tin Roof Rain" items={[{ id: "tags", label: "Edit tags", icon: "edit", onSelect: noop }]} />;

function FullPlayerPage() {
  const [playing, setPlaying] = useState(true);
  const [shuffle, setShuffle] = useState(true);
  const [repeat, setRepeat] = useState<RepeatMode>("all");
  const [position, setPosition] = useState(POSITION);
  return (
    <AppShell
      view="playing"
      right={false}
      main={
        <FullPlayer
          title={NOW.title}
          artist={NOW.artist}
          cover={NOW.cover}
          source={{ kind: "playlist", name: "Late Night Drive" }}
          facts={[NOW.duration, "AAC 256 kbps", NOW.folder, "4 of 12"]}
          playing={playing}
          shuffle={shuffle}
          repeat={repeat}
          position={position}
          duration={NOW.seconds}
          onSeek={setPosition}
          onPlayPause={() => setPlaying(!playing)}
          onShuffle={() => setShuffle(!shuffle)}
          onRepeat={() => setRepeat(repeat === "off" ? "all" : repeat === "all" ? "one" : "off")}
          onClose={noop}
          onQueue={noop}
          onAddToPlaylist={noop}
          more={more}
        />
      }
    />
  );
}

function PlayerBarPage() {
  return <AppShell right={false} />;
}

function TransportPage() {
  const [playing, setPlaying] = useState(true);
  const repeats: RepeatMode[] = ["off", "all", "one"];
  return (
    <Page title="Transport" note="Shuffle, previous, play, next, repeat. Shuffle and repeat are aqua while on; repeat cycles off, all, one.">
      <Demo label="Player bar size: shuffle on, repeat off">
        <Stack>
          <Transport playing={playing} onPlayPause={() => setPlaying(!playing)} shuffle repeat="off" />
        </Stack>
      </Demo>
      <Demo label="Full player size: repeat off, all, one">
        <Stack>
          {repeats.map((r) => (
            <Transport key={r} large playing={r !== "one"} shuffle={r === "one"} repeat={r} />
          ))}
        </Stack>
      </Demo>
    </Page>
  );
}

function QueuePage() {
  const queue = useQueueFixture();
  return (
    <Page title="Queue" note="Now playing stays on top. Drag the handle, long-press on touch or Alt+Up/Down to reorder; swipe left or Delete to remove.">
      <Surface>
        <Box className="Fx-queue">
          <Queue heading {...queue} />
        </Box>
      </Surface>
    </Page>
  );
}

const TIMED: LyricLine[] = [
  { time: 0, text: "Rain on the tin roof, counting the hours" },
  { time: 6, text: "Streetlights are humming a song of their own" },
  { time: 12, text: "" },
  { time: 18, text: "Every drop a drummer, every gutter a choir" },
  { time: 24, text: "I leave the window open and the radio on" },
  { time: 30, text: "Somewhere a ferry is calling us home" },
  { time: 36, text: "Hold the note a little longer" },
  { time: 42, text: "Let the morning wait outside" },
  { time: 48, text: "Rain on the tin roof" },
];

const PLAIN: LyricLine[] = [
  { text: "Glass tides turning over" },
  { text: "Salt in the harbour light" },
  { text: "" },
  { text: "We were the last boat out" },
  { text: "Singing into the night" },
];

function LyricsPanePage() {
  const [position, setPosition] = useState(25);
  return (
    <Page title="LyricsPane" note="Timed lines: the current one in --fg-0, a tap seeks. Plain lines, the Generated badge, and the empty state.">
      <Cols>
        <Demo label="Timed, generated">
          <Surface>
            <Box>
              <LyricsPane lines={TIMED} position={position} onSeek={setPosition} generated />
            </Box>
          </Surface>
        </Demo>
        <Demo label="Plain">
          <Surface>
            <Box>
              <LyricsPane lines={PLAIN} />
            </Box>
          </Surface>
        </Demo>
        <Demo label="None">
          <Surface>
            <Box>
              <LyricsPane lines={null} />
            </Box>
          </Surface>
        </Demo>
      </Cols>
    </Page>
  );
}

export const PLAYER_PAGES = {
  Hairline: HairlinePage,
  MiniPlayer: MiniPlayerPage,
  FullPlayer: FullPlayerPage,
  PlayerBar: PlayerBarPage,
  Transport: TransportPage,
  Queue: QueuePage,
  LyricsPane: LyricsPanePage,
};
