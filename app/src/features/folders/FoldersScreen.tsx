// The Folders tab: where the files are stored. "All songs" first (every song in the library), then
// each first-level folder with its song count; a tap or click opens its songs.
import { useMemo, type RefObject } from "react";
import { ListRow, Thumb, VirtualList } from "../../design";
import { useApp } from "../../app/context";
import type { Detail } from "../../hooks/useNavigation";
import { folderLabel, songCount } from "../library/trackInfo";

export function foldersMeta(n: number): string {
  return `${n} ${n === 1 ? "folder" : "folders"}`;
}

/** Songs per folder ("(all)": every song). */
export function useFolderCounts(): Map<string, number> {
  const { lib } = useApp();
  return useMemo(() => {
    const counts = new Map<string, number>([["(all)", lib.allTracks.length]]);
    for (const t of lib.allTracks) {
      const f = t.playlist || "(root)";
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    return counts;
  }, [lib.allTracks]);
}

export const folderDetail = (name: string): Detail => (name === "(all)" ? { kind: "all", name } : { kind: "folder", name });

export function FoldersBody({ scroller }: { scroller: RefObject<HTMLElement | null> }) {
  const { lib, nav } = useApp();
  const counts = useFolderCounts();
  const folders = lib.folders;
  return (
    <VirtualList
      items={folders}
      getKey={(f) => f}
      label="Folders"
      scroller={scroller}
      onKeyDown={(e, i) => {
        if (e.key === "Enter" && folders[i]) {
          e.preventDefault();
          nav.openDetail(folderDetail(folders[i]));
        }
      }}
      renderRow={(f, _i, row) => (
        <ListRow
          {...row}
          thumb={f === "(all)" ? <Thumb /> : <Thumb folder />}
          name={folderLabel(f)}
          meta={songCount(counts.get(f) ?? 0)}
          chevron
          onClick={() => nav.openDetail(folderDetail(f))}
        />
      )}
    />
  );
}
