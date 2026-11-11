// Fixture page: the artwork tint. The app computes it in a worker (tintWorker.ts), which cannot
// decode the SVG fixture covers; this page runs the same pure function (tintFromPixels) on the main
// thread, from the same 32 x 32 reduction, to show what each cover gives.
import { useEffect, useState } from "react";
import { cssVars } from "../../lib/cx";
import { TINT_FALLBACK, tintFromPixels } from "../../tint/tint";
import { COVERS } from "../data";
import { Page, Row } from "../frame";

function useMainThreadTint(src: string): string | null {
  const [tint, setTint] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext("2d");
      if (!ctx || !live) return;
      ctx.drawImage(img, 0, 0, 32, 32);
      setTint(tintFromPixels(ctx.getImageData(0, 0, 32, 32).data) ?? TINT_FALLBACK);
    };
    img.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  return tint;
}

function Swatch({ src }: { src: string }) {
  const tint = useMainThreadTint(src);
  return (
    <div className="Fx-swatch" data-pending={tint ? undefined : ""}>
      <img src={src} alt="" />
      <span className="Fx-tint" style={cssVars({ "--tint": tint ?? undefined })} />
      {tint ?? "..."}
    </div>
  );
}

const SHOWN = [COVERS.aquaRings, COVERS.aquaArch, COVERS.aquaWaves, COVERS.greyDots, COVERS.greyRings, COVERS.greyArch];

function TintPage() {
  return (
    <Page
      title="Artwork tint"
      note="Each cover and the tint it gives: the biggest of four k-means clusters, lightness 0.18 to 0.32, chroma at most 0.08 (0.04 near aqua and purple)."
    >
      <Row>
        {SHOWN.map((src) => (
          <Swatch key={src} src={src} />
        ))}
      </Row>
    </Page>
  );
}

export const TINT_PAGES = { Tint: TintPage };
