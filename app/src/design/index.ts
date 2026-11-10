// The Soundhood design system: every component of docs/DESIGN.md, implemented once and used on every
// screen size. Import the styles once at the app's root (`import "./design/index.css"`), then the
// components from here. Fixture pages: app/fixtures.html (dev server only).

// Primitives
export { Icon, type IconName, type IconProps, type IconSize } from "./components/Icon";
export { IconButton, type IconButtonProps } from "./components/IconButton";
export { Button, type ButtonProps, type ButtonVariant } from "./components/Button";
export { PlayButton, type PlayButtonProps } from "./components/PlayButton";
export { Switch, type SwitchProps } from "./components/Switch";
export { Checkbox, type CheckboxProps } from "./components/Checkbox";
export { Slider, SliderRow, type SliderProps, type SliderRowProps } from "./components/Slider";
export { Chip, ChipRow, type ChipProps, type ChipRowProps } from "./components/Chip";
export { Badge, type BadgeProps } from "./components/Badge";
export { SearchField, type SearchFieldProps } from "./components/SearchField";
export { TextField, type TextFieldProps } from "./components/TextField";
export {
  Dropdown,
  MultiSelect,
  type DropdownOption,
  type DropdownProps,
  type MultiSelectProps,
} from "./components/Dropdown";
export { MenuButton, type MenuButtonProps, type MenuItem } from "./components/Menu";

// Lists
export { Thumb, Mosaic, type ThumbProps, type MosaicProps } from "./components/Thumb";
export { Equaliser, type EqualiserProps } from "./components/Equaliser";
export { TrackRow, type TrackRowProps } from "./components/TrackRow";
export { ListRow, type ListRowProps } from "./components/ListRow";
export { PlaylistCard, CardGrid, type PlaylistCardProps, type CardGridProps } from "./components/PlaylistCard";
export { SectionHeader, type SectionHeaderProps } from "./components/SectionHeader";
export {
  VirtualList,
  type VirtualListHandle,
  type VirtualListProps,
  type VirtualRowProps,
  type ScrollAlign,
} from "./components/VirtualList";
export {
  Skeleton,
  ErrorRow,
  EmptyState,
  type SkeletonProps,
  type ErrorRowProps,
  type EmptyStateProps,
} from "./components/States";

// Player
export { Hairline, type HairlineProps } from "./components/Hairline";
export { MiniPlayer, type MiniPlayerProps } from "./components/MiniPlayer";
export { FullPlayer, type FullPlayerProps } from "./components/FullPlayer";
export { PlayerBar, type PlayerBarProps } from "./components/PlayerBar";
export { Transport, type TransportProps, type RepeatMode } from "./components/Transport";
export { Queue, type QueueProps, type QueueItem, type QueueSection } from "./components/Queue";
export { LyricsPane, currentLine, type LyricsPaneProps, type LyricLine } from "./components/LyricsPane";

// Shell and navigation
export { Shell, RightPane, type ShellProps, type RightPaneProps } from "./components/Shell";
export { ScreenHeader, type ScreenHeaderProps } from "./components/ScreenHeader";
export { BottomTabs, type BottomTabsProps, type Tab } from "./components/BottomTabs";
export { Sidebar, type SidebarProps, type NavEntry, type SidebarPlaylist } from "./components/Sidebar";

// Overlays
export { Sheet, behindLayer, sheetMayOpen, topLayer, topSheet, type SheetProps } from "./components/Sheet";
export { ToastProvider, ToastViewport, useToast, type ToastApi, type ToastOptions } from "./components/Toast";
export {
  SettingGroup,
  SettingRow,
  SwitchRow,
  ValueRow,
  type SettingGroupProps,
  type SettingRowProps,
  type SwitchRowProps,
  type ValueRowProps,
} from "./components/Settings";
export { BatchReport, type BatchReportProps, type BatchRow, type BatchStatus } from "./components/BatchReport";
export { TidyRow, type TidyRowProps, type TidyPart, type TidyConfidence } from "./components/TidyRow";
export { SelectModeBar, type SelectModeBarProps, type SelectAction } from "./components/SelectModeBar";
export { OnboardingStep, type OnboardingStepProps } from "./components/OnboardingStep";

// Artwork tint
export { useArtworkTint, computeTint, cachedTint } from "./tint/useArtworkTint";
export { TINT_FALLBACK, tintFromPixels } from "./tint/tint";

// Helpers
export { cx, cssVars } from "./lib/cx";
export { formatTime } from "./lib/time";
