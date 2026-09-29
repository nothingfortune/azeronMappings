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
  }

  return { ...raw, positions: rawPositions } as unknown as ProfileData;
}
