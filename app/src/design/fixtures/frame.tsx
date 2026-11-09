// Frames for the fixture pages: a page that is a shell-named container, a titled demo, a row.
import type { ReactNode } from "react";
import { cssVars, cx } from "../lib/cx";

/** A scrolling page of demos; its width is what the components' container queries see. */
export function Page({ title, note, tint, children }: { title: string; note?: string; tint?: string; children: ReactNode }) {
  return (
    <div className="Fx-page" style={cssVars({ "--tint": tint })}>
      <div className="Fx-scope Shell-scope">
        <div className="Fx-title">
          <h1>{title}</h1>
          {note && <p>{note}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

/** One state of a component, with an overline naming it. */
export function Demo({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <section className={cx("Fx-demo", className)}>
      <h2 className="Fx-label">{label}</h2>
      {children}
    </section>
  );
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("Fx-row", className)}>{children}</div>;
}

export function Stack({ children }: { children: ReactNode }) {
  return <div className="Fx-stack">{children}</div>;
}

/** A --bg-1 surface. */
export function Surface({ children, flush }: { children: ReactNode; flush?: boolean }) {
  return <div className={cx("Fx-surface", flush && "is-flush")}>{children}</div>;
}

export function Cols({ children }: { children: ReactNode }) {
  return <div className="Fx-cols">{children}</div>;
}

/** A fixed-height box for parts that scroll. */
export function Box({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("Fx-box", className)}>{children}</div>;
}
