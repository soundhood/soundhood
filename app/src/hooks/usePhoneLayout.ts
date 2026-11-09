// Two flags the shell keeps for every layout (the name is older than the shared UI): whether the
// settings sheet is open, and Select mode, where a tap or click ticks a row instead of playing it.
// Where the user is in the app (tabs, open list, Playing, search) is useNavigation's.
import { useState } from "react";

export type PhoneLayout = ReturnType<typeof usePhoneLayout>;

export function usePhoneLayout() {
  // Select mode: taps tick rows for bulk playlist edits (a mouse can also Ctrl+click or Shift+click).
  const [mSelectMode, setMSelectMode] = useState<boolean>(false);
  // The settings sheet. useProton refreshes the phone's Proton status while it is open, and
  // useDownloads opens it on the phone once a shared link has been queued.
  const [mSettings, setMSettings] = useState<boolean>(false);

  return { mSelectMode, setMSelectMode, mSettings, setMSettings };
}
