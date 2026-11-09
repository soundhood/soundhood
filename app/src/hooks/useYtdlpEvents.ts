// The PC's yt-dlp events (output lines, the files a download wrote, its end), registered once and
// robust against React StrictMode and HMR. Its own hook so the shell can register it after the
// startup load, where this effect always ran (App.tsx). useDownloads re-exports it.
import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import { capLog } from "../coreIpc";
import type { Setter } from "../lib/types";

type YtdlpEventsArgs = {
  noteDlOutput: (text: string) => void;
  setDlLogs: Setter<string>;
  lastDownloadRef: MutableRefObject<string[]>;
  finishDownloadRef: MutableRefObject<(exitCode: number, filePaths: string[]) => Promise<void>>;
};

export function useYtdlpEvents({ noteDlOutput, setDlLogs, lastDownloadRef, finishDownloadRef }: YtdlpEventsArgs) {
  // The newest noteDlOutput (it reads the platform); the listeners are registered once.
  const noteRef = useRef(noteDlOutput);
  useEffect(() => {
    noteRef.current = noteDlOutput;
  });
  useEffect(() => {
    let active = true;

    let unlistenOut: (() => void) | undefined;
    let unlistenErr: (() => void) | undefined;
    let unlistenDone: (() => void) | undefined;
    let unlistenFile: (() => void) | undefined;

    const setup = async () => {
      // The log keeps its tail (capLog), like the phone's, so a long download cannot grow it forever.
      const uOut = await listen<string>("ytdlp:stdout", (e) => {
        // add newline if missing, to keep logs readable
        const chunk = e.payload.endsWith("\n") ? e.payload : e.payload + "\n";
        noteRef.current(chunk);
        setDlLogs((prev) => capLog(prev) + chunk);
      });

      const uErr = await listen<string>("ytdlp:stderr", (e) => {
        const chunk = e.payload.endsWith("\n") ? e.payload : e.payload + "\n";
        noteRef.current(chunk);
        setDlLogs((prev) => capLog(prev) + chunk);
      });

      const uFile = await listen<string[]>("ytdlp:files", (e) => {
        lastDownloadRef.current = Array.isArray(e.payload) ? e.payload : [];
      });

      const uDone = await listen<number>("ytdlp:done", async (e) => {
        setDlLogs((prev) => capLog(prev) + `\n[done] exit code: ${e.payload}\n`);
        const filePaths = lastDownloadRef.current;
        lastDownloadRef.current = [];
        await finishDownloadRef.current(e.payload, filePaths);
      });

      // If StrictMode unmounted us before the awaits finished, immediately unlisten.
      if (!active) {
        uOut();
        uErr();
        uFile();
        uDone();
        return;
      }

      unlistenOut = uOut;
      unlistenErr = uErr;
      unlistenFile = uFile;
      unlistenDone = uDone;
    };

    setup();

    return () => {
      active = false;
      unlistenOut?.();
      unlistenErr?.();
      unlistenFile?.();
      unlistenDone?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
