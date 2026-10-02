/**
 * Turn parsed YAML into the domain shape, complaining clearly when it is malformed.
 *
 * Parsing gives back `unknown`; everything downstream assumes a profile has a device and
 * a mapping of positions. Checking that once here means the rest of the toolchain can
 * trust its own types instead of defending against the file on every line.
 */

import type { ProfileData } from "../types/profile.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class ProfileShapeError extends Error {}

export function normalizeProfileData(raw: unknown, where: string): ProfileData {
  if (!isRecord(raw)) throw new ProfileShapeError(`${where}: not a YAML mapping`);

  const meta = raw.profile;
  if (!isRecord(meta)) throw new ProfileShapeError(`${where}: missing a 'profile:' block`);
  if (typeof meta.device !== "string") {
    throw new ProfileShapeError(`${where}: profile.device must name a device`);
  }

  const rawPositions = raw.positions ?? {};
  if (!isRecord(rawPositions))
    throw new ProfileShapeError(`${where}: 'positions:' must be a mapping`);
  for (const [name, spec] of Object.entries(rawPositions)) {
    if (!isRecord(spec)) {
      throw new ProfileShapeError(
        `${where}: position '${name}' is empty or not a mapping. Give it a binding, or ` +
          "remove the line.",
      );
    }
    // A stick with directions and no mode. Keyboard is the only mode a stick may have
    // (constraint 1), so it is not a choice left open: the editor once wrote a stick this
    // way, after it had been cleared and a direction put back, and it then compiled as no
    // stick at all. Read as what it can only be, it is written back whole on the next save.
    if (isRecord(spec.directions) && spec.mode === undefined) spec.mode = "keyboard";
  }

  return { ...raw, positions: rawPositions } as unknown as ProfileData;
}
