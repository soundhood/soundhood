// First-launch setup: up to three skippable steps, shown once (usePrefs.decideOnboarding has the
// migration rule: an existing install keeps working as it did and sees at most the Library step,
// when no folder is set).
//   1. Library: on a PC the folder picker; on the phone the folder's path (the standard Music
//      folder filled in), after the All-files access Android asks for when the app starts. The
//      index builds behind a progress row; Next does not wait for it.
//   2. Online lookups: one switch, off. Stored; nothing uses it yet.
//   3. YouTube helper: Enable downloader (off) and Keep download helper updated (off). The first
//      shows or hides the download UI; the second is stored for the helper manager.
// It is modal like a sheet: Tab stays inside it (from Skip or Done to its first control and round),
// and a focus given to the screens behind it, or fallen to the page, comes back to what had it
// inside, else to the setup itself. When it ends (Done, Skip on the last step) the focus goes to
// the main area (useFocusReturn), never to the page.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button, OnboardingStep, SettingRow, SwitchRow, TextField } from "../../design";
import { focusIfAble, trapTab } from "../../design/lib/dom";
import { useFocusReturn } from "../../design/lib/useFocusReturn";
import { useApp } from "../../app/context";
import { KEY_REAL_LIBRARY_DIR, storePromise } from "../../lib/store";
import { shownFolder } from "../../testLibrary";
import "../settings/settings.css";

const PHONE_MUSIC = "/storage/emulated/0/Music";

function LibraryStep({ step, total, onNext, nextLabel }: { step: number; total: number; onNext: () => void; nextLabel: string }) {
  const { isMobile, lib } = useApp();
  const [path, setPath] = useState(PHONE_MUSIC);
  const [reading, setReading] = useState(false);
  // A folder an earlier version remembered (switched away from for the test library), offered first.
  const [earlier, setEarlier] = useState<string>("");
  useEffect(() => {
    let live = true;
    void storePromise
      .then((s) => s.get<string>(KEY_REAL_LIBRARY_DIR))
      .then((v) => live && typeof v === "string" && v && setEarlier(v))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const take = async (dir: string) => {
    if (!dir.trim()) return;
    setReading(true);
    await lib.importFolderPath(dir);
    setReading(false);
  };
  const pick = async () => {
    try {
      const picked = await open({ directory: true, multiple: false, defaultPath: earlier || undefined });
      if (typeof picked === "string" && picked) await take(picked);
    } catch {
      /* the picker was closed */
    }
  };
  const found = lib.folder
    ? reading
      ? `Reading ${shownFolder(lib.folder, lib.fixtureRoot)}`
      : `${lib.allTracks.length} songs in ${shownFolder(lib.folder, lib.fixtureRoot)}`
    : "";

  return (
    <OnboardingStep
      step={step}
      total={total}
      icon="mark"
      title="Where is your music?"
      lines={
        isMobile
          ? ["Type the folder that holds your songs. Android asks once for access to your files.", "Soundhood reads it and changes nothing until you ask."]
          : ["Pick the folder that holds your songs.", "Soundhood reads it and changes nothing until you ask."]
      }
      onSkip={onNext}
      onNext={onNext}
      nextLabel={nextLabel}
      nextDisabled={!lib.folder}
    >
      {isMobile ? (
        <SettingRow label="Music folder" stacked>
          <div className="SettingRow-inline">
            <TextField aria-label="Music folder path" value={path} onChange={(e) => setPath(e.currentTarget.value)} />
            <Button small onClick={() => void take(path)} disabled={!path.trim() || reading}>
              Use
            </Button>
          </div>
        </SettingRow>
      ) : (
        <Button icon="folders" onClick={() => void pick()} disabled={reading}>
          {lib.folder ? "Choose another folder" : "Choose folder"}
        </Button>
      )}
      {found && (
        <p className="Onboarding-progress" role="status">
          {found}
        </p>
      )}
    </OnboardingStep>
  );
}

export function Onboarding() {
  const { prefs } = useApp();
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const steps = prefs.onboarding;
  const shown = !!steps?.length;
  // Each step is read out from its start.
  useEffect(() => {
    if (shown) box.current?.focus({ preventScroll: true });
  }, [shown, at]);
  useFocusReturn(box, shown);
  // Modal: the focus stays in the setup. What had it inside comes back when something takes it to
  // the screens behind (a sheet cannot open under the setup; the toasts above it may have it) or it
  // falls to the page.
  useLayoutEffect(() => {
    const root = box.current;
    if (!shown || !root) return;
    let last: HTMLElement | null = null;
    const back = () => {
      if (!(last && last !== root && root.contains(last) && focusIfAble(last))) root.focus({ preventScroll: true });
    };
    const onIn = (e: FocusEvent) => {
      if (!(e.target instanceof HTMLElement)) return;
      if (root.contains(e.target)) last = e.target;
      else if (!e.target.closest(".Toasts")) back();
    };
    const onOut = (e: FocusEvent) => {
      if (e.relatedTarget) return;
      requestAnimationFrame(() => {
        const at = document.activeElement;
        if (root.isConnected && (!at || at === document.body)) back();
      });
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, [shown]);
  if (!steps || !steps.length) return null;
  const i = Math.min(at, steps.length - 1);
  const total = steps.length;
  const last = i === total - 1;
  const next = () => (last ? prefs.finishOnboarding() : setAt(i + 1));
  const nextLabel = last ? "Done" : "Next";

  return (
    <div
      ref={box}
      className="Onboarding"
      role="dialog"
      aria-modal="true"
      aria-label="Set up Soundhood"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (box.current) trapTab(e, box.current);
      }}
    >
      {steps[i] === "library" && <LibraryStep key="library" step={i + 1} total={total} onNext={next} nextLabel={nextLabel} />}
      {steps[i] === "lookups" && (
        <OnboardingStep
          step={i + 1}
          total={total}
          icon="globe"
          title="Online lookups"
          lines={["Lets later versions look up lyrics, song details and cover art online.", "Nothing is sent anywhere while this is off."]}
          onSkip={next}
          onNext={next}
          nextLabel={nextLabel}
        >
          <SwitchRow label="Online lookups" checked={prefs.lookups} onChange={prefs.setLookups} />
        </OnboardingStep>
      )}
      {steps[i] === "helper" && (
        <OnboardingStep
          step={i + 1}
          total={total}
          icon="download"
          title="YouTube helper"
          lines={["Downloads the audio of a YouTube link you give it, into your music folder.", "While it is off, Soundhood never contacts YouTube."]}
          onSkip={next}
          onNext={next}
          nextLabel={nextLabel}
        >
          <SwitchRow label="Enable downloader" checked={prefs.downloader} onChange={prefs.setDownloader} />
          <SwitchRow label="Keep download helper updated" checked={prefs.helperUpdates} onChange={prefs.setHelperUpdates} />
        </OnboardingStep>
      )}
    </div>
  );
}
