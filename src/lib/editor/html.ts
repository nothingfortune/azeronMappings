/** Assemble a page into one self-contained HTML file, openable from the filesystem. */

import type { EditorPayload } from "../../types/editor.js";

/** JSON that is safe to sit inside a <script> block. */
function embed(payload: unknown): string {
  return JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/[\u2028\u2029]/g, (ch) => (ch === "\u2028" ? "\\u2028" : "\\u2029"));
}

export interface PageOptions {
  title: string;
  /** The global the bundle reads its payload from. */
  globalName: string;
  payload: unknown;
  bundle: string;
  /** True only when served by `azeron serve`, which is what backs the save API. */
  served?: boolean;
}

export function renderPage(options: PageOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${options.title}</title>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="payload">${embed(options.payload)}</script>
<script>
  window.${options.globalName} = JSON.parse(document.getElementById("payload").textContent);
  window.AZERON_SERVED = ${String(options.served === true)};
</script>
<script>
${options.bundle}
</script>
</body>
</html>
`;
}

export function renderEditorHtml(payload: EditorPayload, bundle: string, served = false): string {
  return renderPage({
    title: "Azeron profile editor",
    globalName: "AZERON_PAYLOAD",
    payload,
    bundle,
    served,
  });
}
