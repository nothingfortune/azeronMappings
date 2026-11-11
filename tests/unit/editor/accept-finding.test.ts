// @vitest-environment happy-dom
/**
 * A finding that is fine in this layout is accepted from the Checks panel, with the
 * reason, instead of by writing lint.acknowledged into game.yaml by hand.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import { showDockTab } from "../../helpers/editor.js";

const PAYLOAD = buildPayload();
const SERVED = window as unknown as { AZERON_SERVED?: boolean };

/** The test data with its first accepted finding taken back, so the check raises it. */
function withOneRaised(): { payload: typeof PAYLOAD; taken: unknown } {
  const payload = structuredClone(PAYLOAD);
  const game = payload.games[0];
  const acknowledged = game?.lintConfig.acknowledged ?? [];
  const taken = acknowledged[0];
  if (game) game.lintConfig = { ...game.lintConfig, acknowledged: acknowledged.slice(1) };
  return { payload, taken };
}

afterEach(() => {
  SERVED.AZERON_SERVED = false;
  vi.unstubAllGlobals();
});

describe("accepting a finding", () => {
  it("records it with the reason given, and the check stops raising it", async () => {
    SERVED.AZERON_SERVED = true;
    const { payload, taken } = withOneRaised();
    const calls: { path: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string, init?: { body?: string }) => {
        calls.push({ path, body: init?.body === undefined ? null : JSON.parse(init.body) });
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ok: true, entry: taken }),
        });
      }),
    );
    vi.stubGlobal(
      "prompt",
      vi.fn(() => "on purpose"),
    );
    document.body.innerHTML = '<div id="app"></div>';
    start(payload);
    showDockTab("checks");
    const accept = document.querySelector<HTMLButtonElement>(".checks .accept-finding");
    if (!accept) throw new Error("no Accept on the raised finding");
    accept.click();
    await vi.waitFor(() => {
      expect(document.querySelector(".checks .accept-finding")).toBeNull();
    });
    const body = calls.find((call) => call.path === "/api/acknowledge")?.body as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({ game: "everspace", reason: "on purpose" });
    expect(typeof body.rule).toBe("string");
  });

  it("sends nothing when no reason is given", () => {
    SERVED.AZERON_SERVED = true;
    const { payload } = withOneRaised();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal(
      "prompt",
      vi.fn(() => null),
    );
    document.body.innerHTML = '<div id="app"></div>';
    start(payload);
    showDockTab("checks");
    document.querySelector<HTMLButtonElement>(".checks .accept-finding")?.click();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is not offered where the page cannot save", () => {
    const { payload } = withOneRaised();
    document.body.innerHTML = '<div id="app"></div>';
    start(payload);
    showDockTab("checks");
    expect(document.querySelector(".checks .accept-finding")).toBeNull();
  });
});
