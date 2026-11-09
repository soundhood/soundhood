// The phone layout: one screen at a time, the select mode for touch, the settings sheet, and the
// measured height of the bottom block. The desktop ignores all of it.
import { useEffect, useRef, useState } from "react";
import type { PhoneScreen } from "../lib/types";

export type PhoneLayout = ReturnType<typeof usePhoneLayout>;

export function usePhoneLayout({ isMobile, currentPath }: { isMobile: boolean; currentPath: string }) {
  // Phone layout: one screen at a time. browse = Playlists/Artists/Folders, tracks = the song list,
  // player = full-screen now playing. Desktop ignores all three.
  const [mScreen, setMScreen] = useState<PhoneScreen>("browse");
  // On a touchscreen a tap plays; "Select" switches taps to ticking rows for bulk playlist edits.
  const [mSelectMode, setMSelectMode] = useState<boolean>(false);
  const [mSettings, setMSettings] = useState<boolean>(false);
  // Height of the phone's bottom block (mini player + tabs + gesture bar): the full-screen player
  // stops above it instead of guessing a fixed number.
  const mBottomRef = useRef<HTMLDivElement | null>(null);
  const [mBottomH, setMBottomH] = useState<number>(80);
  useEffect(() => {
    const el = mBottomRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setMBottomH(el.getBoundingClientRect().height));
    ro.observe(el);
    setMBottomH(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, [isMobile, currentPath, mScreen]);
  const goTracks = () => { if (isMobile) setMScreen("tracks"); };

  return { mScreen, setMScreen, mSelectMode, setMSelectMode, mSettings, setMSettings, mBottomRef, mBottomH, goTracks };
}
