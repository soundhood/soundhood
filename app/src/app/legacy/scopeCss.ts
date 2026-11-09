// Confines the old stylesheet (legacyStyles.ts) to the parts of the UI that are still old: every
// rule only applies inside an element with the class `.legacy` (the settings sheet's content and the
// old dialogs), so nothing of it reaches the rebuilt screens. Its rules for the page itself (body,
// html, #root) and for the old app frame (.app) are dropped; `.app.mobile` becomes `.legacy.mobile`.
// The old stylesheet has no nested blocks except @media, no strings with braces and no @keyframes.

const SCOPE = ".legacy";

function scopeSelector(sel: string): string | null {
  const s = sel.trim();
  if (!s) return null;
  if (s === ":root") return SCOPE;
  if (s === "body" || s === "html" || s === "#root" || s === ".app") return null;
  if (s.startsWith(".app.mobile")) return `${SCOPE}.mobile${s.slice(".app.mobile".length)}`;
  return `${SCOPE} ${s}`;
}

function scopeRules(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    if (head.startsWith("@")) {
      let depth = 1;
      let j = open + 1;
      while (depth > 0 && j < css.length) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
        j++;
      }
      out += `${head}{${scopeRules(css.slice(open + 1, j - 1))}}\n`;
      i = j;
      continue;
    }
    const close = css.indexOf("}", open);
    const body = css.slice(open + 1, close);
    const selectors = head.split(",").map(scopeSelector).filter((x): x is string => x !== null);
    if (selectors.length) out += `${selectors.join(", ")}{${body}}\n`;
    i = close + 1;
  }
  return out;
}

/** `css` with every rule confined to `.legacy` (see above). */
export function scopeLegacyCss(css: string): string {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // The page's text colour and font, which the old rules inherited from body; and the browser's own
  // font for the old controls (the design system's base makes controls inherit the text around them).
  const font = `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const base = [
    `${SCOPE}{ color: var(--text); font-family: ${font}; }`,
    `${SCOPE} :is(button, input, textarea){ font: 400 13.3333px ${font}; letter-spacing: normal; }`,
  ];
  return [...base, scopeRules(plain)].join("\n");
}
