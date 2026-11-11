// Entry of app/fixtures.html: one fixture page per design-system component, chosen by the hash
// (#TrackRow). Without a hash it lists the pages. The page sets data-fixture on <html> once it has
// rendered; tools/screenshot/components.spec.mjs waits for it before photographing.
import { StrictMode, useEffect, useState, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "./fixtures.css";
import { Page } from "./frame";
import PAGE_LIST from "./pages.json";
import { LIST_PAGES } from "./pages/lists";
import { OVERLAY_PAGES } from "./pages/overlays";
import { PLAYER_PAGES } from "./pages/player";
import { PRIMITIVE_PAGES } from "./pages/primitives";
import { SHELL_PAGES } from "./pages/shell";
import { TINT_PAGES } from "./pages/tint";

const REGISTRY: Record<string, ComponentType> = {
  ...PRIMITIVE_PAGES,
  ...LIST_PAGES,
  ...PLAYER_PAGES,
  ...SHELL_PAGES,
  ...OVERLAY_PAGES,
  ...TINT_PAGES,
};

declare global {
  interface Window {
    /** Every registered page, for the spec's check that pages.json lists them all. */
    __FIXTURE_PAGES__?: string[];
  }
}
window.__FIXTURE_PAGES__ = Object.keys(REGISTRY);

const current = () => decodeURIComponent(location.hash.slice(1));

function Index() {
  return (
    <Page title="Soundhood components" note="One fixture page per component of docs/DESIGN.md.">
      <nav className="Fx-index" aria-label="Pages">
        {PAGE_LIST.map((name) => (
          <a key={name} href={`#${name}`}>
            {name}
          </a>
        ))}
      </nav>
    </Page>
  );
}

function Fixtures() {
  const [name, setName] = useState(current);
  useEffect(() => {
    const onHash = () => setName(current());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const Fixture = name ? REGISTRY[name] : undefined;
  useEffect(() => {
    document.title = name ? `${name}, Soundhood components` : "Soundhood components";
    document.documentElement.dataset.fixture = Fixture ? name : name ? "missing" : "index";
  }, [name, Fixture]);

  if (!name) return <Index />;
  if (!Fixture) {
    return (
      <Page title="No such page" note={`There is no fixture page called ${name}.`}>
        <Index />
      </Page>
    );
  }
  return <Fixture key={name} />;
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Fixtures />
  </StrictMode>,
);
