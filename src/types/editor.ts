import type { ExportDocument } from "./azeron.js";
import type { StickModeSet } from "../lib/stickmodes.js";
import type { ActionSetData, DeviceData, LintConfig, ProfileData } from "./profile.js";

export interface EditorProfile {
  slug: string;
  path: string;
  data: ProfileData;
}

export interface EditorGame {
  slug: string;
  name: string;
  rel: string;
  template: string;
  actions: ActionSetData;
  lintConfig: LintConfig;
  profiles: EditorProfile[];
}

export interface EditorGenre {
  name: string;
  actions: ActionSetData;
  default: ProfileData;
  /** Stick modes offered for this genre, if it defines any. */
  stickModes?: StickModeSet;
}

/** Everything the editor page needs, embedded at build time. */
export interface EditorPayload {
  generatedAt: string;
  devices: Record<string, DeviceData>;
  templates: Record<string, ExportDocument>;
  games: EditorGame[];
  genres: EditorGenre[];
}
