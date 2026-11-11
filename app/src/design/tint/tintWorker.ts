// Module worker for the artwork tint: fetches the cover, draws it on a 32 x 32 OffscreenCanvas and
// answers { id, tint } (a CSS colour, or null when the cover cannot be read). Started by
// useArtworkTint.ts; the maths is in tint.ts. SVG covers cannot be decoded in a worker and come
// back as null (the caller falls back to --bg-1); real covers are JPEG or PNG.
import { tintFromPixels } from "./tint";

interface TintRequest {
  id: number;
  url: string;
}

const SIZE = 32;

// The app's TypeScript config has no WebWorker lib: describe the two members used here.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<TintRequest>) => void) | null;
  postMessage: (message: { id: number; tint: string | null }) => void;
};

scope.onmessage = (e) => {
  const { id, url } = e.data;
  void (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bitmap = await createImageBitmap(await res.blob(), {
        resizeWidth: SIZE,
        resizeHeight: SIZE,
        resizeQuality: "medium",
      });
      const canvas = new OffscreenCanvas(SIZE, SIZE);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(bitmap, 0, 0, SIZE, SIZE);
      bitmap.close();
      scope.postMessage({ id, tint: tintFromPixels(ctx.getImageData(0, 0, SIZE, SIZE).data) });
    } catch {
      scope.postMessage({ id, tint: null });
    }
  })();
};
