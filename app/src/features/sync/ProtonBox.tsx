// The phone's Proton Drive box in the settings sheet: checking, no sync engine, connected (sync
// buttons, last sync, disconnect) or the login form.
import { SYNC_OFF_LINE } from "../../testLibrary";
import type { Proton } from "../../hooks/useProton";

type ProtonBoxProps = {
  proton: Proton;
  dlBusy: boolean;
  fixtureOn: boolean;
};

export function ProtonBox({ proton: p, dlBusy, fixtureOn }: ProtonBoxProps) {
  const { proton, protonForm, setProtonForm, protonBusy, lastSync } = p;
  return (
    <div className="queueBox">
      <div className="queueTitle headerRow">
        <span>Proton Drive</span>
        {proton?.connected ? <span className="modalHint" style={{ marginTop: 0 }}>{proton.username}</span> : null}
      </div>
      {!proton ? (
        <div className="modalHint">checking…</div>
      ) : !proton.bundled ? (
        <div className="modalHint">This build has no sync engine (rclone not bundled).</div>
      ) : proton.connected ? (
        <div className="queueAdd" style={{ marginTop: 0 }}>
          <button className="btn primaryBtn" onClick={() => p.protonSync("both")} disabled={protonBusy !== "" || dlBusy || fixtureOn}>{protonBusy === "sync" ? "Syncing…" : "Sync now"}</button>
          <button className="btn" onClick={() => p.protonSync("down")} disabled={protonBusy !== "" || dlBusy || fixtureOn} title="Only fetch what the PC added">Get new</button>
          <button className="btn" onClick={() => p.protonSync("up")} disabled={protonBusy !== "" || dlBusy || fixtureOn} title="Only send what the phone added">Send new</button>
          <span className="modalHint" style={{ marginTop: 0 }}>{lastSync ? `last: ${new Date(lastSync).toLocaleString()}` : "never synced"}</span>
          <button className="linkBtn" onClick={p.protonLogout} disabled={protonBusy !== ""}>disconnect</button>
          {fixtureOn ? <div className="modalHint syncOffLine" style={{ flex: "1 1 100%", marginTop: 0 }}>{SYNC_OFF_LINE}</div> : null}
        </div>
      ) : (
        <div className="queueAdd" style={{ marginTop: 0 }}>
          <input className="downloadInput" placeholder="Proton email" inputMode="email" autoCapitalize="none" value={protonForm.username} onChange={(e) => setProtonForm({ ...protonForm, username: e.target.value })} />
          <input className="downloadInput" placeholder="Password" type="password" value={protonForm.password} onChange={(e) => setProtonForm({ ...protonForm, password: e.target.value })} />
          <input className="downloadInput" placeholder="2FA code (if enabled)" inputMode="numeric" value={protonForm.twofa} onChange={(e) => setProtonForm({ ...protonForm, twofa: e.target.value })} style={{ flex: "0 1 170px" }} />
          <button className="btn primaryBtn" onClick={p.protonLogin} disabled={protonBusy !== ""}>{protonBusy === "login" ? "Connecting…" : "Connect"}</button>
          <div className="modalHint" style={{ flex: "1 1 100%", marginTop: 0 }}>
            The password is used once to open the session and is not stored; the app keeps only Proton's session tokens, on this phone.
            Sync copies in both directions and never deletes.
          </div>
        </div>
      )}
    </div>
  );
}
