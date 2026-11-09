// Settings, Proton Drive: only where the host syncs by itself (the phone; on the PC the Proton Drive
// app mirrors the library). Checking, no sync engine, the login (email, a password used once, a 2FA
// code), or connected: the account with Disconnect, Sync now, Get new, Send new and the last sync.
// A login or a sync that failed shows an error row with Copy log and Retry. Off while the test
// library is shown, so it never reaches the real Proton Drive folder.
import { Button, ErrorRow, SettingGroup, SettingRow, TextField } from "../../design";
import { useApp } from "../../app/context";
import { SYNC_OFF_LINE } from "../../testLibrary";

export function ProtonGroup() {
  const { isMobile, proton: p, dl, lib, log } = useApp();
  if (!isMobile) return null;
  const status = p.proton;
  const syncOff = p.protonBusy !== "" || dl.dlBusy || lib.fixtureOn;
  const last = p.lastSync ? `Last sync ${new Date(p.lastSync).toLocaleString()}` : "Never synced";
  const form = p.protonForm;

  return (
    <SettingGroup title="Proton Drive">
      {p.error && <ErrorRow title={p.error.title} detail={p.error.detail} onCopyLog={() => void log.copyLog()} onRetry={p.error.retry} />}
      {!status ? (
        <SettingRow label="Checking the sync engine" />
      ) : !status.bundled ? (
        <SettingRow label="No sync engine" help="This build has no rclone inside, so it cannot sync." />
      ) : status.connected ? (
        <>
          <SettingRow label="Account" help={status.username}>
            <Button small variant="text" onClick={() => void p.protonLogout()} disabled={p.protonBusy !== ""}>
              Disconnect
            </Button>
          </SettingRow>
          <SettingRow label="Sync" help={lib.fixtureOn ? SYNC_OFF_LINE : `Copies both ways and never deletes. ${last}`}>
            <Button small onClick={() => void p.protonSync("both")} disabled={syncOff}>
              {p.protonBusy === "sync" ? "Syncing" : "Sync now"}
            </Button>
          </SettingRow>
          <SettingRow label="Only fetch" help="What the PC added">
            <Button small onClick={() => void p.protonSync("down")} disabled={syncOff}>
              Get new
            </Button>
          </SettingRow>
          <SettingRow label="Only send" help="What the phone added">
            <Button small onClick={() => void p.protonSync("up")} disabled={syncOff}>
              Send new
            </Button>
          </SettingRow>
        </>
      ) : (
        <SettingRow
          label="Connect"
          help="The password is used once to open the session and is not stored; the app keeps only Proton's session tokens, on this phone. Sync copies in both directions and never deletes."
          stacked
        >
          <div className="ProtonLogin">
            <TextField
              aria-label="Proton email"
              placeholder="Proton email"
              inputMode="email"
              autoCapitalize="none"
              value={form.username}
              onChange={(e) => p.setProtonForm({ ...form, username: e.currentTarget.value })}
            />
            <TextField
              aria-label="Password"
              placeholder="Password"
              type="password"
              value={form.password}
              onChange={(e) => p.setProtonForm({ ...form, password: e.currentTarget.value })}
            />
            <TextField
              aria-label="2FA code"
              placeholder="2FA code (if enabled)"
              inputMode="numeric"
              value={form.twofa}
              onChange={(e) => p.setProtonForm({ ...form, twofa: e.currentTarget.value })}
            />
            <Button small onClick={() => void p.protonLogin()} disabled={p.protonBusy !== ""}>
              {p.protonBusy === "login" ? "Connecting" : "Connect"}
            </Button>
          </div>
        </SettingRow>
      )}
    </SettingGroup>
  );
}
