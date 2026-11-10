// Settings, YouTube: the downloader switch, and while it is on: the last failed download (an error
// row with Copy log and Retry), a link field with Add and Paste (both open "Where should this go?"),
// the download queue and the links waiting, and on the phone the in-app helper's version with
// Update and the network check (the PC's helper ships with the installer).
import { Button, ErrorRow, SettingGroup, SettingRow, SwitchRow, TextField, ValueRow } from "../../design";
import { useApp } from "../../app/context";

export function YouTubeGroup({ onShowLinks }: { onShowLinks: () => void }) {
  const { isMobile, dl, proton, log, prefs } = useApp();
  const waiting = dl.shareQueue.length;
  const helperBusy = proton.ytdlpBusy || dl.dlBusy;

  return (
    <SettingGroup title="YouTube">
      <SwitchRow
        label="Downloader"
        help={
          prefs.downloader
            ? "Downloads the audio of a link you give it, nothing else"
            : prefs.unreadable
              ? "Off: the settings could not be read (see the log), so it stays off until you turn it on"
              : "Off: links are not taken and the download controls are hidden"
        }
        checked={prefs.downloader}
        onChange={prefs.setDownloader}
      />
      {prefs.downloader && (
        <>
          {dl.failure && <ErrorRow title={dl.failure.title} detail={dl.failure.detail} onCopyLog={() => void log.copyLog()} onRetry={dl.failure.retry} />}
          <SettingRow label="Download a link" help="Then choose its folder and playlists" stacked>
            <div className="SettingRow-inline">
              <TextField
                aria-label="Link"
                placeholder="Paste a YouTube link"
                inputMode="url"
                value={dl.queueInput}
                onChange={(e) => dl.setQueueInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") dl.addQueueInput();
                }}
              />
              <Button small onClick={dl.addQueueInput} disabled={!dl.queueInput.trim()}>
                Add
              </Button>
              <Button small icon="paste" onClick={() => void dl.pasteLink()}>
                Paste
              </Button>
            </div>
          </SettingRow>
          {waiting > 0 && (
            <>
              <SettingRow label="Download queue" help="The waiting links one after another, each into its own folder">
                <Button small onClick={dl.runQueue} disabled={dl.dlBusy}>
                  Download queue ({waiting})
                </Button>
              </SettingRow>
              <ValueRow label="Links waiting" help="Queued here or on your other device" value={waiting} onClick={onShowLinks} />
            </>
          )}
          {isMobile && (
            <>
              <SettingRow label="Download helper" help={proton.ytdlpVersion ? `yt-dlp ${proton.ytdlpVersion}` : "Reading its version"}>
                <Button small onClick={() => void proton.updateYtdlp()} disabled={helperBusy}>
                  {proton.ytdlpBusy ? "Updating" : "Update"}
                </Button>
              </SettingRow>
              <SettingRow label="Network check" help="Can the helper reach YouTube? The result goes to the log.">
                <Button small onClick={() => void proton.netcheck()} disabled={helperBusy}>
                  Check
                </Button>
              </SettingRow>
            </>
          )}
        </>
      )}
    </SettingGroup>
  );
}
