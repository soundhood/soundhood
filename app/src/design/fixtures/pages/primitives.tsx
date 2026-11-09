// Fixture pages: primitives. Each page shows the component's states with invented data; the
// controls work, so the page doubles as a playground in the dev server (/fixtures.html#Name).
import { useState } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Checkbox } from "../../components/Checkbox";
import { Chip, ChipRow } from "../../components/Chip";
import { Dropdown, MultiSelect } from "../../components/Dropdown";
import { Icon } from "../../components/Icon";
import { IconButton } from "../../components/IconButton";
import { MenuButton } from "../../components/Menu";
import { PlayButton } from "../../components/PlayButton";
import { SearchField } from "../../components/SearchField";
import { SettingRow, SwitchRow } from "../../components/Settings";
import { Slider, SliderRow } from "../../components/Slider";
import { Switch } from "../../components/Switch";
import { TextField } from "../../components/TextField";
import { ICONS, type IconName } from "../../icons/icons";
import { formatTime } from "../../lib/time";
import { NOW, PLAYLISTS, noop } from "../data";
import { Cols, Demo, Page, Row, Stack, Surface } from "../frame";

function IconPage() {
  const names = Object.keys(ICONS) as IconName[];
  return (
    <Page title="Icon" note="The Soundhood set: 24 x 24 grid, 1.5 px round strokes; transport glyphs and dots are solid.">
      <Demo label="Sizes 20, 24, 32">
        <Row>
          {([20, 24, 32] as const).map((s) => (
            <Icon key={s} name="mark" size={s} />
          ))}
          {([20, 24, 32] as const).map((s) => (
            <Icon key={`p${s}`} name="play" size={s} />
          ))}
          <Icon name="settings" size={32} title="Settings" />
        </Row>
      </Demo>
      <Demo label="The set">
        <div className="Fx-icons">
          {names.map((n) => (
            <div key={n}>
              <Icon name={n} />
              <span>{n}</span>
            </div>
          ))}
        </div>
      </Demo>
    </Page>
  );
}

function IconButtonPage() {
  const [shuffle, setShuffle] = useState(true);
  return (
    <Page title="IconButton" note="A round hit target (32 px with a mouse, 44 px on touch) around a 20 or 24 px icon.">
      <Demo label="Resting, strong, on (pressed), disabled">
        <Row>
          <IconButton icon="more" label="More" />
          <IconButton icon="queue" label="Queue" />
          <IconButton icon="chevronDown" label="Close the player" strong />
          <IconButton icon="shuffle" label="Shuffle" pressed={shuffle} onClick={() => setShuffle(!shuffle)} />
          <IconButton icon="repeat" label="Repeat" pressed={false} />
          <IconButton icon="trash" label="Delete" disabled />
        </Row>
      </Demo>
      <Demo label="Icon sizes 20 and 24">
        <Row>
          <IconButton icon="lyrics" size={20} label="Lyrics" />
          <IconButton icon="lyrics" label="Lyrics" />
          <IconButton icon="playlistAdd" size={20} label="Add to playlist" />
          <IconButton icon="playlistAdd" label="Add to playlist" />
        </Row>
      </Demo>
    </Page>
  );
}

function ButtonPage() {
  return (
    <Page title="Button" note="A 40 px pill, 32 px small. One primary (aqua) per screen.">
      <Demo label="Default, primary, danger, text, link">
        <Row>
          <Button>Queue</Button>
          <Button variant="primary" icon="download">
            Download
          </Button>
          <Button variant="danger">Delete 3 songs</Button>
          <Button variant="text">Cancel</Button>
          <Button variant="link">Browse songs</Button>
        </Row>
      </Demo>
      <Demo label="Small">
        <Row>
          <Button small icon="undo">
            Undo
          </Button>
          <Button small>Rescan</Button>
          <Button small variant="text">
            Clear
          </Button>
          <Button small variant="link">
            Show all 5
          </Button>
        </Row>
      </Demo>
      <Demo label="Disabled">
        <Row>
          <Button disabled>Queue</Button>
          <Button variant="primary" disabled>
            Download
          </Button>
          <Button small disabled>
            Update
          </Button>
        </Row>
      </Demo>
    </Page>
  );
}

function PlayButtonPage() {
  const [playing, setPlaying] = useState(true);
  return (
    <Page title="PlayButton" note="Round and aqua: 40 px in the player bar, 64 px in the full player. The glyph cross-fades.">
      <Demo label="Playing (shows pause) and paused (shows play)">
        <Row>
          <PlayButton playing={playing} onClick={() => setPlaying(!playing)} />
          <PlayButton playing={false} />
          <PlayButton large playing />
          <PlayButton large playing={false} />
        </Row>
      </Demo>
    </Page>
  );
}

function SwitchPage() {
  const [a, setA] = useState(true);
  const [b, setB] = useState(false);
  return (
    <Page title="Switch" note="32 x 18; purple with a lilac knob when on. In a settings row the whole row toggles it.">
      <Demo label="On, off, disabled">
        <Row>
          <Switch checked aria-label="On" />
          <Switch checked={false} aria-label="Off" />
          <Switch checked disabled aria-label="On, disabled" />
          <Switch checked={false} disabled aria-label="Off, disabled" />
        </Row>
      </Demo>
      <Demo label="In settings rows">
        <Surface>
          <SwitchRow label="Show the queue beside the list" help="On wide windows" checked={a} onChange={setA} />
          <SwitchRow label="Online lookups" help="Finds missing covers and lyrics. Nothing is sent while it is off." checked={b} onChange={setB} />
          <SwitchRow label="Keep download helper updated" checked={false} onChange={noop} disabled />
        </Surface>
      </Demo>
    </Page>
  );
}

function CheckboxPage() {
  const [on, setOn] = useState(true);
  return (
    <Page title="Checkbox" note="20 px; a --fg-1 outline when off, aqua with an ink tick when on (Select mode, Tidy).">
      <Demo label="Off, on">
        <Row>
          <Checkbox checked={false} aria-label="Not chosen" />
          <Checkbox checked={on} onChange={setOn} aria-label="Chosen" />
        </Row>
      </Demo>
    </Page>
  );
}

function SliderPage() {
  const [pos, setPos] = useState(72);
  const [vol, setVol] = useState(70);
  const valueText = (s: number) => `${formatTime(s)} of ${formatTime(NOW.seconds)}`;
  return (
    <Page title="Slider" note="A 3 px track, purple up to the value, a lilac knob. Arrow keys: 5 s for position, 5 % for volume.">
      <Demo label="Position with times">
        <Stack>
          <SliderRow start={formatTime(pos)} end={formatTime(NOW.seconds)}>
            <Slider label="Position" value={pos} max={NOW.seconds} keyStep={5} valueText={valueText} onChange={setPos} />
          </SliderRow>
        </Stack>
      </Demo>
      <Demo label="Stacked (full player)">
        <Stack>
          <SliderRow stacked start="1:12" end="2:52">
            <Slider label="Position" value={72} max={172} keyStep={5} />
          </SliderRow>
        </Stack>
      </Demo>
      <Demo label="Volume 0, 70 and 100 %">
        <Cols>
          {[0, vol, 100].map((v, i) => (
            <Stack key={i}>
              <Slider label="Volume" value={v} max={100} keyStep={5} onChange={i === 1 ? setVol : undefined} />
            </Stack>
          ))}
        </Cols>
      </Demo>
      <Demo label="Disabled">
        <Stack>
          <Slider label="Position" value={40} max={100} keyStep={5} disabled />
        </Stack>
      </Demo>
    </Page>
  );
}

function ChipPage() {
  const chips = ["All", "Songs", "Artists", "Playlists", "Folders", "Downloads", "Rips", "Vinyl"];
  const [on, setOn] = useState("All");
  return (
    <Page title="Chip" note="32 px filter pills under a search field. Pressed steps up to --bg-3; the row scrolls sideways.">
      <Demo label="One pressed; the row runs off the edge">
        <ChipRow label="Show" className="Fx-pad">
          {chips.map((c) => (
            <Chip key={c} pressed={c === on} onClick={() => setOn(c)}>
              {c}
            </Chip>
          ))}
        </ChipRow>
      </Demo>
    </Page>
  );
}

function BadgePage() {
  return (
    <Page title="Badge" note="18 px: purple fill under light text, or a lilac outline.">
      <Demo label="Smart playlist, generated lyrics">
        <Row>
          <Badge icon="smart">Smart</Badge>
          <Badge outline>Generated</Badge>
        </Row>
      </Demo>
    </Page>
  );
}

function SearchFieldPage() {
  const [a, setA] = useState("");
  const [b, setB] = useState("neon");
  return (
    <Page title="SearchField" note="40 px on --bg-1; a clear button while it has text. Esc clears, then leaves.">
      <Demo label="Empty, with text">
        <Stack>
          <SearchField value={a} onChange={setA} />
          <SearchField value={b} onChange={setB} />
        </Stack>
      </Demo>
    </Page>
  );
}

function TextFieldPage() {
  const [v, setV] = useState("");
  return (
    <Page title="TextField" note="40 px on --bg-2 with a 1 px line; the placeholder in --fg-1.">
      <Demo label="Placeholder, value, disabled">
        <Stack>
          <TextField placeholder="Paste a YouTube link" aria-label="Link" value={v} onChange={(e) => setV(e.target.value)} />
          <TextField aria-label="Playlist name" defaultValue="Late Night Drive" />
          <TextField aria-label="Folder" defaultValue="Music" disabled />
        </Stack>
      </Demo>
      <Demo label="In a stacked settings row">
        <Surface>
          <SettingRow label="Download a link" stacked>
            <div className="SettingRow-inline">
              <TextField placeholder="Paste a YouTube link" aria-label="Link" />
              <Button small icon="paste">
                Paste
              </Button>
            </div>
          </SettingRow>
        </Surface>
      </Demo>
    </Page>
  );
}

const ORDER = [
  { value: "natural", label: "Natural order" },
  { value: "title", label: "Title A to Z" },
  { value: "artist", label: "Artist A to Z" },
  { value: "long", label: "Longest first" },
  { value: "short", label: "Shortest first" },
] as const;
type Order = (typeof ORDER)[number]["value"];

function DropdownPage() {
  const [order, setOrder] = useState<Order>("natural");
  return (
    <Page title="Dropdown" note="A button with the value and a chevron; a listbox popover of 36 px options. Never a native select.">
      <Demo label="Closed">
        <Row>
          <Dropdown label="Order" options={ORDER} value={order} onChange={setOrder} />
          <Dropdown label="Order" options={ORDER} value="title" onChange={noop} disabled />
        </Row>
      </Demo>
      <Demo label="Open" className="Fx-room">
        <Row>
          <Dropdown label="Order" options={ORDER} value="natural" onChange={noop} defaultOpen />
        </Row>
      </Demo>
    </Page>
  );
}

const FOLDERS = PLAYLISTS.slice(0, 6).map((p) => ({ value: p.id, label: p.name }));

function MultiSelectPage() {
  const [chosen, setChosen] = useState<string[]>([FOLDERS[0].value, FOLDERS[2].value]);
  return (
    <Page title="MultiSelect" note='Stays open and toggles. The button reads "None", one name, or "N chosen".'>
      <Demo label="None, one, several">
        <Row>
          <MultiSelect label="Playlists" options={FOLDERS} values={[]} onChange={noop} />
          <MultiSelect label="Playlists" options={FOLDERS} values={[FOLDERS[1].value]} onChange={noop} />
          <MultiSelect label="Playlists" options={FOLDERS} values={chosen} onChange={setChosen} />
        </Row>
      </Demo>
      <Demo label="Open" className="Fx-room">
        <Row>
          <MultiSelect label="Playlists" options={FOLDERS} values={chosen} onChange={setChosen} defaultOpen />
        </Row>
      </Demo>
    </Page>
  );
}

function MenuPage() {
  const items = [
    { id: "play", label: "Play", icon: "play" as const, onSelect: noop },
    { id: "shuffle", label: "Shuffle", icon: "shuffle" as const, onSelect: noop },
    { id: "rename", label: "Rename", icon: "edit" as const, onSelect: noop },
    { id: "delete", label: "Delete", icon: "trash" as const, danger: true, onSelect: noop },
  ];
  return (
    <Page title="MenuButton" note="A more button with a short menu of actions (a playlist card, Select mode).">
      <Demo label="Open" className="Fx-room">
        <Row>
          <MenuButton label="More for Late Night Drive" items={items} defaultOpen />
        </Row>
      </Demo>
    </Page>
  );
}

export const PRIMITIVE_PAGES = {
  Icon: IconPage,
  IconButton: IconButtonPage,
  Button: ButtonPage,
  PlayButton: PlayButtonPage,
  Switch: SwitchPage,
  Checkbox: CheckboxPage,
  Slider: SliderPage,
  Chip: ChipPage,
  Badge: BadgePage,
  SearchField: SearchFieldPage,
  TextField: TextFieldPage,
  Dropdown: DropdownPage,
  MultiSelect: MultiSelectPage,
  MenuButton: MenuPage,
};
