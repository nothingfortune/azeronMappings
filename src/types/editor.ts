import type { ExportDocument } from "./azeron.js";
import type { StickModeSet } from "../lib/stickmodes.js";
import type { PedalsDeviceData, SetsData } from "./pedals.js";
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
  /**
   * What each layout does beyond its profiles -- its pedals -- keyed by set name, the same
   * name the profiles carry in `profile.set`. One name selects keypads and pedals together.
   */
  sets: SetsData;
  /**
   * The text of the game's `sets.yaml` ("" when it has none). The page patches this, line by
   * line, when a layout's pedals are saved, so the file's comments and other sets survive;
   * the parsed `sets` above cannot say what the file looked like.
   */
  setsText: string;
  /** The set whose pedals are written into the game's own binding file, if the game says. */
  ingameSet?: string;
  /**
   * Whether the game's own binding file is set up here: the file is named in game.yaml, and
   * the categories of it that this repo owns are. The path itself stays on the server. A
   * game started from an export has neither, which is why its keys cannot be written yet.
   */
  ingameFile?: { configured: boolean; ownedCategories: number };
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
  /** Pedals devices by name: axes, not pins, so they are not in `devices`. */
  pedals: Record<string, PedalsDeviceData>;
  templates: Record<string, ExportDocument>;
  games: EditorGame[];
  genres: EditorGenre[];
}
