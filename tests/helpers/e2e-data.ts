/**
 * Run a browser spec from inside the throwaway copy of the data the server was started on
 * (see playwright.config.ts), so the paths a spec reads and writes -- `games/...`,
 * `dist/...`, `templates/...` -- are that copy's and never the owner's.
 *
 * Imported for its effect, first, by every spec.
 */
const data = process.env.AZERON_E2E_DATA;
if (data === undefined || data === "") {
  throw new Error("AZERON_E2E_DATA is not set: run the specs through `npm run test:e2e`");
}
process.chdir(data);
