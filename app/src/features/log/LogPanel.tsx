// The visible log: a panel under the download bar on the desktop, the tail of it in the phone's
// settings sheet.

export function LogPanel({ text }: { text: string }) {
  return (
    <div className="downloadLogs">
      <pre>{text}</pre>
    </div>
  );
}

export function PhoneLogPanel({ text }: { text: string }) {
  return (
    <div className="downloadLogs mLogs"><pre>{text.slice(-3000)}</pre></div>
  );
}
