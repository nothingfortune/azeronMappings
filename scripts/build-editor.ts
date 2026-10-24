/**
 * Bundle the browser editor into build/editor-app.js.
 *
 * The editor imports the same src/lib modules the CLI does; esbuild pulls them in so the
 * page ships one copy of the compiler and linter rather than a reimplementation.
 */
import process from "node:process";

import { build } from "esbuild";

interface Bundle {
  entry: string;
  outfile: string;
}

// One page. The press test used to be a second one; it is a tab of the editor now.
const bundles: Bundle[] = [{ entry: "src/editor/main.ts", outfile: "build/editor-app.js" }];

for (const { entry, outfile } of bundles) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2022"],
    outfile,
    legalComments: "none",
    logLevel: "warning",
  });
  if (result.errors.length > 0) process.exit(1);
}
