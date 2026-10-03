/**
 * Elite Dangerous keeps its bindings in a `.binds` file: XML, one control to an element,
 * under `%LOCALAPPDATA%/Frontier Developments/Elite Dangerous/Options/Bindings`.
 *
 * The file names a control by its internal tag (`UseBoostJuice`, `HumanoidSprintButton`,
 * `ToggleButtonUpInput`) and says nothing about what it is called on the controls screen or
 * which screen it is on. This module reads the file and gives every control a plain name,
 * the mode of play it belongs to and a group within that mode, so that 400 tags become a
 * list a person can find things in.
 *
 * The same key may do different things in different modes -- W is forward thrust in the
 * ship, accelerate in the buggy, walk on foot -- which is how the game is meant to be bound
 * and is why the mode is part of what a control is.
 *
 * Read line by line rather than as a document, and every line kept, so a later write can
 * change the lines it means to and leave the rest byte for byte. Node-free.
 */

import type { ActionSpec } from "../types/profile.js";

/** One place a control can be bound: a button has two, an axis one. */
export interface EliteSlot {
  slot: "Primary" | "Secondary" | "Binding";
  /** `Keyboard`, `Mouse`, `{NoDevice}`, or a device id such as `28DE11FF`. */
  device: string;
  key: string;
  /** Keys that must be held as well, as the game writes them. */
  modifiers: { device: string; key: string }[];
  /** On-foot bindings can ask for the key to be held rather than pressed. */
  hold?: boolean;
  /** First and last line of the slot in the file. */
  line: number;
  endLine: number;
}

export type EliteKind = "button" | "axis" | "setting" | "other";

export interface EliteControl {
  /** The element's name: the game's own id for the control. */
  tag: string;
  kind: EliteKind;
  line: number;
  endLine: number;
  slots: EliteSlot[];
  /** A setting's value, or the text of an element that is neither. */
  value?: string;
  inverted?: boolean;
  deadzone?: number;
  toggleOn?: boolean;
}

export interface EliteBinds {
  preset: string;
  major: string;
  minor: string;
  keyboardLayout: string | null;
  controls: EliteControl[];
  /** Tags that appear more than once. The game uses the first and complains. */
  duplicates: string[];
  lines: string[];
  eol: string;
}

export class EliteError extends Error {}

const NO_DEVICE = "{NoDevice}";

const attr = (line: string, name: string): string | null =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(line)?.[1] ?? null;

/** Read a `.binds` file. Throws on text that is not one. */
export function parseBinds(text: string): EliteBinds {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const rootAt = lines.findIndex((line) => /^\s*<Root\b/.test(line));
  if (rootAt === -1) throw new EliteError("not an Elite Dangerous bindings file: no <Root>");
  const root = lines[rootAt] ?? "";

  const controls: EliteControl[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  let keyboardLayout: string | null = null;
  let open: EliteControl | null = null;
  let slot: EliteSlot | null = null;
  let inComment = false;

  for (let index = rootAt + 1; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").trim();
    if (line === "" || line === "</Root>") continue;

    // The installed presets carry comments between controls ("Vanity Cam Start"). They are
    // kept in `lines` like everything else and mean nothing here, whether they sit on one
    // line or run over several.
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    if (line.startsWith("<!--")) {
      if (!line.includes("-->", 4)) inComment = true;
      continue;
    }

    if (open === null) {
      const whole = /^<(\w+)>([^<]*)<\/\1>$/.exec(line);
      if (whole) {
        const [, tag = "", value = ""] = whole;
        if (tag === "KeyboardLayout") keyboardLayout = value;
        controls.push({ tag, kind: "other", line: index, endLine: index, slots: [], value });
        continue;
      }
      const single = /^<(\w+)\b[^>]*\/>$/.exec(line);
      if (single) {
        const tag = single[1] ?? "";
        const value = attr(line, "Value");
        controls.push({
          tag,
          kind: value === null ? "other" : "setting",
          line: index,
          endLine: index,
          slots: [],
          ...(value === null ? {} : { value }),
        });
        continue;
      }
      // An opening tag may carry attributes the game does not write today.
      const opening = /^<(\w+)(\s[^<>]*[^/<>])?\s*>$/.exec(line);
      // Anything else between controls is kept and not understood: only a file with no
      // <Root> is not a bindings file.
      if (!opening) continue;
      open = { tag: opening[1] ?? "", kind: "other", line: index, endLine: index, slots: [] };
      continue;
    }

    if (line === `</${open.tag}>`) {
      open.endLine = index;
      const kinds = new Set(open.slots.map((entry) => entry.slot));
      open.kind = kinds.has("Binding") ? "axis" : kinds.size > 0 ? "button" : "other";
      controls.push(open);
      open = null;
      continue;
    }

    if (slot !== null) {
      if (/^<\/(Primary|Secondary|Binding)>$/.test(line)) {
        slot.endLine = index;
        slot = null;
        continue;
      }
      if (line.startsWith("<Modifier")) {
        slot.modifiers.push({ device: attr(line, "Device") ?? "", key: attr(line, "Key") ?? "" });
        continue;
      }
      if (line.startsWith("<Hold")) {
        slot.hold = attr(line, "Value") === "1";
        continue;
      }
      // Anything else the game adds to a binding is kept in `lines` and not understood.
      continue;
    }

    const bound = /^<(Primary|Secondary|Binding)\b/.exec(line);
    if (bound) {
      const entry: EliteSlot = {
        slot: bound[1] as EliteSlot["slot"],
        device: attr(line, "Device") ?? NO_DEVICE,
        key: attr(line, "Key") ?? "",
        modifiers: [],
        line: index,
        endLine: index,
      };
      open.slots.push(entry);
      if (!line.endsWith("/>")) slot = entry;
      continue;
    }
    const value = attr(line, "Value");
    if (line.startsWith("<Inverted")) open.inverted = value === "1";
    else if (line.startsWith("<Deadzone")) open.deadzone = Number(value);
    else if (line.startsWith("<ToggleOn")) open.toggleOn = value === "1";
    // Anything else the game adds to a control is kept in `lines` and not understood.
  }
  if (open !== null) throw new EliteError(`<${open.tag}> is never closed`);

  for (const control of controls) {
    if (seen.has(control.tag) && !duplicates.includes(control.tag)) duplicates.push(control.tag);
    seen.add(control.tag);
  }
  return {
    preset: attr(root, "PresetName") ?? "",
    major: attr(root, "MajorVersion") ?? "",
    minor: attr(root, "MinorVersion") ?? "",
    keyboardLayout,
    controls,
    duplicates,
    lines,
    eol,
  };
}

/** Whether a slot has anything on it. */
export function isBound(slot: EliteSlot): boolean {
  return slot.device !== NO_DEVICE && slot.key !== "";
}

// --- keys ---------------------------------------------------------------------------------

/** The game's name for a key, by the name this repo uses (a `KeyboardEvent.code`). */
const TO_ELITE: Record<string, string> = {
  Space: "Key_Space",
  Enter: "Key_Enter",
  Tab: "Key_Tab",
  Escape: "Key_Escape",
  Backspace: "Key_Backspace",
  Delete: "Key_Delete",
  Insert: "Key_Insert",
  Home: "Key_Home",
  End: "Key_End",
  PageUp: "Key_PageUp",
  PageDown: "Key_PageDown",
  ArrowUp: "Key_UpArrow",
  ArrowDown: "Key_DownArrow",
  ArrowLeft: "Key_LeftArrow",
  ArrowRight: "Key_RightArrow",
  ShiftLeft: "Key_LeftShift",
  ShiftRight: "Key_RightShift",
  ControlLeft: "Key_LeftControl",
  ControlRight: "Key_RightControl",
  AltLeft: "Key_LeftAlt",
  AltRight: "Key_RightAlt",
  BracketLeft: "Key_LeftBracket",
  BracketRight: "Key_RightBracket",
  Semicolon: "Key_SemiColon",
  Quote: "Key_Apostrophe",
  Comma: "Key_Comma",
  Period: "Key_Period",
  Slash: "Key_Slash",
  Backslash: "Key_BackSlash",
  Minus: "Key_Minus",
  Equal: "Key_Equals",
  Backquote: "Key_Grave",
  NumpadAdd: "Key_Numpad_Add",
  NumpadSubtract: "Key_Numpad_Subtract",
  NumpadMultiply: "Key_Numpad_Multiply",
  NumpadDivide: "Key_Numpad_Divide",
  NumpadDecimal: "Key_Numpad_Decimal",
};

const FROM_ELITE: Record<string, string> = Object.fromEntries(
  Object.entries(TO_ELITE).map(([ours, theirs]) => [theirs, ours]),
);

/** The game's name for one of our keys, or null when it has none we know of. */
export function eliteKeyFor(name: string): string | null {
  if (name in TO_ELITE) return TO_ELITE[name] ?? null;
  const letter = /^Key([A-Z])$/.exec(name);
  if (letter?.[1]) return `Key_${letter[1]}`;
  const digit = /^Digit([0-9])$/.exec(name);
  if (digit?.[1]) return `Key_${digit[1]}`;
  const numpad = /^Numpad([0-9])$/.exec(name);
  if (numpad?.[1]) return `Key_Numpad_${numpad[1]}`;
  if (/^F([1-9]|1[0-2])$/.test(name)) return `Key_${name}`;
  return null;
}

/** Our name for one of the game's keyboard keys, or null when we have none. */
export function nameForEliteKey(key: string): string | null {
  if (key in FROM_ELITE) return FROM_ELITE[key] ?? null;
  const letter = /^Key_([A-Z])$/.exec(key);
  if (letter?.[1]) return `Key${letter[1]}`;
  const digit = /^Key_([0-9])$/.exec(key);
  if (digit?.[1]) return `Digit${digit[1]}`;
  const numpad = /^Key_Numpad_([0-9])$/.exec(key);
  if (numpad?.[1]) return `Numpad${numpad[1]}`;
  if (/^Key_F([1-9]|1[0-2])$/.test(key)) return key.slice("Key_".length);
  return null;
}

// --- what each control is -----------------------------------------------------------------

/** The modes of play. A key is one thing in each, and may be something else in the next. */
export const ELITE_MODES = {
  ship: "Ship",
  landing: "Ship, landing gear down",
  srv: "Buggy (SRV)",
  foot: "On foot",
  fss: "System scanner (FSS)",
  dss: "Surface scanner (DSS)",
  fighter: "Fighter orders",
  multicrew: "Multicrew",
  ui: "Menus and panels",
  map: "Galaxy map",
  headlook: "Headlook",
  camera: "Camera suite",
  store: "Store and commander creator",
  general: "Everywhere",
  construction: "Colony construction",
} as const;

export type EliteMode = keyof typeof ELITE_MODES;

export type EliteRole = "combat" | "movement" | "travel" | "menu" | "utility";

export interface EliteDescription {
  mode: EliteMode;
  /** A heading within the mode: "Thrust", "Targeting", "Weapons". */
  group: string;
  /** What a person would call it. */
  label: string;
  /** The nearest of this repo's role tags, which the checks use. */
  role: EliteRole;
}

/** Tags that belong to the buggy without saying so in their name. */
const SRV_TAGS = new Set([
  "ToggleDriveAssist",
  "SteerLeftButton",
  "SteerRightButton",
  "VerticalThrustersButton",
  "IncreaseSpeedButtonMax",
  "DecreaseSpeedButtonMax",
  "IncreaseSpeedButtonPartial",
  "DecreaseSpeedButtonPartial",
  "RecallDismissShip",
  "SteeringAxis",
  "DriveSpeedAxis",
]);

const GENERAL_TAGS = new Set([
  "Pause",
  "FriendsMenu",
  "MicrophoneMute",
  "HMDReset",
  "ShowPGScoreSummaryInput",
  "MouseReset",
  "BlockMouseDecay",
]);

function modeOf(tag: string): EliteMode {
  // Placing a settlement and the colonisation module are a mode of their own, with keys that
  // mean other things in the ship.
  if (/Settlement|Colonisation|ConstructionOption/.test(tag)) return "construction";
  if (/^FocusDistance|^ToggleVanityCamera/.test(tag)) return "camera";
  if (tag.startsWith("Humanoid") || tag.endsWith("_Humanoid")) return "foot";
  if (tag.includes("Buggy") || SRV_TAGS.has(tag)) return "srv";
  if (tag.endsWith("_Landing")) return "landing";
  // Entering the scanner is done from the ship; everything else is done inside it.
  if (tag === "ExplorationFSSEnter") return "ship";
  if (tag.startsWith("ExplorationFSS")) return "fss";
  if (tag.startsWith("ExplorationSAA") || tag.startsWith("SAA")) return "dss";
  if (tag.startsWith("MultiCrew")) return "multicrew";
  if (tag.startsWith("Order") || tag === "OpenOrders") return "fighter";
  if (/^Cam[A-Z]/.test(tag) || tag === "GalaxyMapHome") return "map";
  if (tag.startsWith("Store") || tag.startsWith("CommanderCreator")) return "store";
  if (/^HeadLook(Reset|Pitch|Yaw)/.test(tag)) return "headlook";
  if (
    /FreeCam|VanityCamera|PhotoCameraToggle|^(Pitch|Yaw|Roll)Camera|^FStop/.test(tag) ||
    /^(ToggleRotationLock|FixCamera(Relative|World)Toggle|QuitCamera|ToggleAdvanceMode)$/.test(tag)
  ) {
    return "camera";
  }
  if (tag.startsWith("UI_") || /^Cycle(Next|Previous)(Panel|Page)$/.test(tag)) return "ui";
  if (tag.startsWith("GalnetAudio") || GENERAL_TAGS.has(tag)) return "general";
  return "ship";
}

/** What the game calls a control on its own screen, where the tag would mislead or say little. */
const LABELS: Record<string, string> = {
  UseBoostJuice: "Engine boost",
  HyperSuperCombination: "Frame shift drive (jump or supercruise)",
  Supercruise: "Supercruise",
  Hyperspace: "Hyperspace jump",
  ToggleFlightAssist: "Flight assist on/off",
  DisableRotationCorrectToggle: "Rotational correction on/off",
  OrbitLinesToggle: "Orbit lines on/off",
  UseAlternateFlightValuesToggle: "Alternate flight controls on/off",
  ToggleReverseThrottleInput: "Reverse throttle",
  ForwardKey: "Increase throttle",
  BackwardKey: "Decrease throttle",
  YawToRollButton: "Yaw into roll (hold)",
  SelectTarget: "Target ahead",
  SelectTarget_Buggy: "Target ahead",
  SelectHighestThreat: "Target highest threat",
  SelectTargetsTarget: "Target wingman's target",
  WingNavLock: "Wingman nav-lock",
  TargetWingman0: "Target wingman 1",
  TargetWingman1: "Target wingman 2",
  TargetWingman2: "Target wingman 3",
  TargetNextRouteSystem: "Target next system in route",
  PrimaryFire: "Fire primary",
  SecondaryFire: "Fire secondary",
  CycleFireGroupNext: "Next fire group",
  CycleFireGroupPrevious: "Previous fire group",
  DeployHardpointToggle: "Deploy or retract hardpoints",
  ToggleButtonUpInput: "Silent running",
  DeployHeatSink: "Deploy heat sink",
  UseShieldCell: "Use shield cell",
  FireChaffLauncher: "Fire chaff",
  ChargeECM: "Charge ECM",
  TriggerFieldNeutraliser: "Trigger field neutraliser",
  ShipSpotLightToggle: "Ship lights",
  NightVisionToggle: "Night vision",
  LandingGearToggle: "Landing gear",
  ToggleCargoScoop: "Cargo scoop",
  ToggleCargoScoop_Buggy: "Cargo scoop",
  EjectAllCargo: "Eject all cargo",
  EjectAllCargo_Buggy: "Eject all cargo",
  IncreaseEnginesPower: "Power to engines",
  IncreaseWeaponsPower: "Power to weapons",
  IncreaseSystemsPower: "Power to systems",
  ResetPowerDistribution: "Reset power distribution",
  IncreaseEnginesPower_Buggy: "Power to engines",
  IncreaseWeaponsPower_Buggy: "Power to weapons",
  IncreaseSystemsPower_Buggy: "Power to systems",
  ResetPowerDistribution_Buggy: "Reset power distribution",
  RadarIncreaseRange: "Radar range up",
  RadarDecreaseRange: "Radar range down",
  UIFocus: "Look at panels (UI focus)",
  UIFocus_Buggy: "Look at panels (UI focus)",
  FocusLeftPanel: "Target panel (left)",
  FocusRightPanel: "Systems panel (right)",
  FocusRadarPanel: "Role panel (bottom)",
  FocusCommsPanel: "Comms panel",
  QuickCommsPanel: "Quick comms",
  GalaxyMapOpen: "Open galaxy map",
  SystemMapOpen: "Open system map",
  OpenCodexGoToDiscovery: "Open codex",
  PlayerHUDModeToggle: "Switch HUD mode (combat or analysis)",
  ExplorationFSSEnter: "Enter system scanner (FSS)",
  HeadLookToggle: "Headlook on/off",
  ShowPGScoreSummaryInput: "CQC scoreboard",
  HMDReset: "Reset headset view",
  MicrophoneMute: "Microphone mute",
  FriendsMenu: "Friends menu",
  Pause: "Pause menu",
  MouseReset: "Reset mouse",
  BlockMouseDecay: "Hold mouse position",
  WeaponColourToggle: "Weapon colour on/off",
  EngineColourToggle: "Engine colour on/off",
  CycleNextPanel: "Next panel tab",
  CyclePreviousPanel: "Previous panel tab",
  CycleNextPage: "Next page",
  CyclePreviousPage: "Previous page",
  UI_Toggle: "Menu: toggle",
  UI_Select: "Menu: select",
  UI_Back: "Menu: back",
  UI_Up: "Menu: up",
  UI_Down: "Menu: down",
  UI_Left: "Menu: left",
  UI_Right: "Menu: right",
  ToggleDriveAssist: "Drive assist on/off",
  SteerLeftButton: "Steer left",
  SteerRightButton: "Steer right",
  VerticalThrustersButton: "Vertical thrusters",
  AutoBreakBuggyButton: "Handbrake",
  HeadlightsBuggyButton: "Headlights",
  ToggleBuggyTurretButton: "Turret on/off",
  IncreaseSpeedButtonMax: "Accelerate",
  DecreaseSpeedButtonMax: "Brake or reverse",
  IncreaseSpeedButtonPartial: "Accelerate (analog)",
  DecreaseSpeedButtonPartial: "Brake or reverse (analog)",
  DriveSpeedAxis: "Drive speed",
  RecallDismissShip: "Recall or dismiss ship",
  OpenOrders: "Open fighter orders",
  ThrottleAxis: "Throttle",
  AheadThrust: "Forward and back thrust",
  LateralThrustRaw: "Left and right thrust",
  VerticalThrustRaw: "Up and down thrust",
  HumanoidItemWheelButton: "Item wheel",
  HumanoidEmoteWheelButton: "Emote wheel",
  HumanoidPrimaryInteractButton: "Interact",
  HumanoidSecondaryInteractButton: "Interact (secondary)",
  HumanoidZoomButton: "Aim down sights",
  HumanoidPing: "Ping",
  ExplorationFSSDiscoveryScan: "Discovery scan (honk)",
  ExplorationFSSQuit: "Leave the scanner",
  ExplorationSAAExitThirdPerson: "Leave the scanner",
  PhotoCameraToggle: "Open camera suite",
  LateralThrust: "Left and right thrust",
  VerticalThrust: "Up and down thrust",
};

/** Words the tags run together or abbreviate, and how to write them. */
const WORDS: [RegExp, string][] = [
  [/\bU I\b/g, "UI"],
  [/\bH U D\b/g, "HUD"],
  [/\bE C M\b/g, "ECM"],
  [/\bE M P\b/g, "EMP"],
  [/\bF Stop\b/g, "F-stop"],
  [/\bFov\b/gi, "field of view"],
  [/\bCam\b/g, "Camera"],
  [/\bInc\b/g, "up"],
  [/\bDec\b/g, "down"],
  [/\bComp Analyser\b/g, "profile analyser"],
];

/** `HumanoidSelectFragGrenade` -> "Select frag grenade": the tag, as words. */
function wordsOf(tag: string): string {
  let rest = tag
    .replace(/_(Buggy|Landing|Humanoid)$/, "")
    .replace(/^Humanoid/, "")
    .replace(/^Exploration(FSS|SAA)/, "")
    .replace(/^(SAA|MultiCrew)ThirdPerson/, "")
    .replace(/^MultiCrew/, "")
    .replace(/^Buggy/, "")
    .replace(/Buggy/g, "")
    .replace(/^CommanderCreator_/, "")
    .replace(/^GalnetAudio_/, "Galnet audio ")
    .replace(/^Store/, "")
    .replace(/^Order/, "Order: ")
    .replace(/(Button|Input|Raw)$/, "")
    .replace(/Button(?=_|$)/, "")
    .replace(/(Axis)?Alternate$/, " (alternate)")
    .replace(/AxisRaw$|Axis$|Raw$/, "")
    .replace(/_/g, " ");
  // Split the camel case: before a capital that follows a lower-case letter or a digit.
  rest = rest.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  for (const [pattern, word] of WORDS) rest = rest.replace(pattern, word);
  rest = rest.replace(/\s+/g, " ").trim();
  if (rest === "") return tag;
  const sentence = rest.charAt(0).toUpperCase() + rest.slice(1).toLowerCase();
  return sentence.replace(/\b(ui|hud|ecm|emp|fss)\b/gi, (word) => word.toUpperCase());
}

function labelOf(tag: string): string {
  // The buggy's and the suit's copies of a ship control are the same thing by another tag.
  const base = tag.replace(/_(Buggy|Landing|Humanoid)$/, "");
  const known = LABELS[tag] ?? LABELS[base] ?? LABELS[`${base}Raw`];
  if (known !== undefined) return known;
  const speed = /^SetSpeed(Minus)?(\d+|Zero)$/.exec(tag);
  if (speed) {
    const amount = speed[2] === "Zero" ? "0" : (speed[2] ?? "");
    return `Set speed to ${speed[1] ? "-" : ""}${amount}%`;
  }
  const camera = /^VanityCamera(One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)$/.exec(tag);
  if (camera) return `Camera: ${(camera[1] ?? "").toLowerCase()}`;
  const emote = /^HumanoidEmoteSlot(\d)$/.exec(tag);
  if (emote) return `Emote ${emote[1] ?? ""}`;
  return wordsOf(tag);
}

/** The heading a control goes under within its mode, and the role the checks give it. */
function groupOf(tag: string, mode: EliteMode): { group: string; role: EliteRole } {
  // Matched on what the control is: the mode's own prefix would hide a leading "Pitch".
  const what = tag.replace(/^(Humanoid|Buggy|MultiCrew(ThirdPerson)?)/, "");
  const is = (pattern: RegExp): boolean => pattern.test(what);
  if (mode === "ui" || mode === "map" || mode === "store") return { group: "Menus", role: "menu" };
  if (mode === "camera" || mode === "headlook") return { group: "Camera", role: "utility" };
  if (mode === "general") return { group: "General", role: "utility" };
  if (mode === "fighter") return { group: "Orders", role: "combat" };
  if (mode === "fss" || mode === "dss") return { group: "Scanner", role: "utility" };
  if (mode === "construction") return { group: "Construction", role: "utility" };
  if (mode === "multicrew") return { group: "Multicrew", role: is(/Fire/) ? "combat" : "utility" };

  if (
    is(/HeatSink|ShieldCell|Chaff|ECM|FieldNeutraliser|ToggleButtonUpInput/) ||
    is(/HealthPack|Battery|ToggleShields/)
  ) {
    return { group: "Defence", role: "combat" };
  }
  if (is(/Power/)) return { group: "Power", role: "utility" };
  if (is(/Fire|Hardpoint|FireGroup|Melee|Reload|Grenade|Weapon|Zoom|Turret/) && !is(/Colour/)) {
    return { group: "Weapons", role: "combat" };
  }
  if (is(/Target|Threat|Wingman|WingNavLock|Subsystem/)) {
    return { group: "Targeting", role: "combat" };
  }
  if (is(/Hyper|Supercruise/)) return { group: "Frame shift drive", role: "travel" };
  if (is(/^(Yaw|Roll|Pitch)|Rotate|Steer/)) return { group: "Turning", role: "movement" };
  if (is(/Thrust|Strafe|^Forward(Button|Axis)|^Backward(?!Key)|Jump|Crouch|Sprint|Walk/)) {
    return { group: "Moving", role: "movement" };
  }
  if (is(/Speed|Throttle|ForwardKey|BackwardKey|BoostJuice|FlightAssist|DriveAssist|AutoBreak/)) {
    return { group: "Speed", role: "movement" };
  }
  if (is(/Panel|MapOpen|Codex|UIFocus|HUDMode|FSSEnter|Wheel|Emote|Comms|Orders|PhotoCamera/)) {
    return { group: "Panels and modes", role: "menu" };
  }
  const systems = mode === "foot" ? "Suit" : mode === "srv" ? "Buggy systems" : "Ship systems";
  return { group: systems, role: "utility" };
}

/** Everything this repo says about a control the file only names. */
export function describeControl(tag: string): EliteDescription {
  const mode = modeOf(tag);
  const { group, role } = groupOf(tag, mode);
  return { mode, group, label: labelOf(tag), role };
}

export interface EliteSummary {
  /** Per mode: how many controls there are to bind, and how many have something on them. */
  modes: { mode: EliteMode; label: string; controls: number; bound: number }[];
  /** Every device the file binds something to, and how many slots it holds. */
  devices: { device: string; slots: number }[];
  settings: number;
  duplicates: string[];
}

/** The file at a glance: what there is to bind in each mode, and what it is bound to. */
export function summarise(binds: EliteBinds): EliteSummary {
  const perMode = new Map<EliteMode, { controls: number; bound: number }>();
  const perDevice = new Map<string, number>();
  let settings = 0;
  for (const control of binds.controls) {
    if (control.kind === "setting") settings += 1;
    if (control.kind !== "button" && control.kind !== "axis") continue;
    const { mode } = describeControl(control.tag);
    const count = perMode.get(mode) ?? { controls: 0, bound: 0 };
    count.controls += 1;
    if (control.slots.some(isBound)) count.bound += 1;
    perMode.set(mode, count);
    for (const slot of control.slots) {
      if (isBound(slot)) perDevice.set(slot.device, (perDevice.get(slot.device) ?? 0) + 1);
    }
  }
  return {
    modes: (Object.keys(ELITE_MODES) as EliteMode[])
      .filter((mode) => perMode.has(mode))
      .map((mode) => ({
        mode,
        label: ELITE_MODES[mode],
        ...(perMode.get(mode) ?? { controls: 0, bound: 0 }),
      })),
    devices: [...perDevice.entries()]
      .map(([device, slots]) => ({ device, slots }))
      .sort((a, b) => b.slots - a.slots),
    settings,
    duplicates: binds.duplicates,
  };
}

// --- writing ------------------------------------------------------------------------------

/** What one action asks of its control, in the game's own names. */
interface Wanted {
  device: "Keyboard" | "Mouse";
  key: string;
  /** Held keys, as the game names them. */
  modifiers: string[];
}

const MOUSE_BUTTONS: Record<string, string> = {
  left: "Mouse_1",
  right: "Mouse_2",
  middle: "Mouse_3",
};

/**
 * What an action sends, or null for one that sends nothing. An action may name a key, a key
 * with one held modifier (`key` and `meta`), a modifier on its own (`meta` alone: the
 * modifier is then the key), or a mouse button, which may also have a modifier held.
 */
function wantedBy(id: string, spec: ActionSpec): Wanted | null {
  const key = spec.key ?? null;
  const meta = spec.meta ?? null;
  const mouse = spec.mouse ?? null;
  if (key !== null && mouse !== null) {
    throw new EliteError(`${id} names both a key (${key}) and a mouse button (${mouse})`);
  }
  const named = (name: string): string => {
    const found = eliteKeyFor(name);
    if (found === null) throw new EliteError(`${id}: Elite has no name for the key ${name}`);
    return found;
  };
  if (mouse !== null) {
    const button = MOUSE_BUTTONS[mouse];
    if (button === undefined) {
      throw new EliteError(`${id}: ${mouse} is not a mouse button (left, right or middle)`);
    }
    return { device: "Mouse", key: button, modifiers: meta === null ? [] : [named(meta)] };
  }
  if (key !== null) {
    return { device: "Keyboard", key: named(key), modifiers: meta === null ? [] : [named(meta)] };
  }
  if (meta !== null) return { device: "Keyboard", key: named(meta), modifiers: [] };
  return null;
}

/** A binding as a short string, in our key names where there are some: `ShiftLeft+KeyW`. */
function describeBinding(device: string, key: string, modifiers: readonly string[]): string {
  const name = (value: string): string =>
    device === "Mouse" && /^Mouse_\d$/.test(value)
      ? (Object.entries(MOUSE_BUTTONS).find(([, theirs]) => theirs === value)?.[0] ?? value)
      : (nameForEliteKey(value) ?? value);
  const held = modifiers.map((entry) => nameForEliteKey(entry) ?? entry).sort();
  const base = device === "Mouse" ? `mouse ${name(key)}` : name(key);
  return [...held, base].join("+");
}

const isKeyboardOrMouse = (slot: EliteSlot): boolean =>
  isBound(slot) && (slot.device === "Keyboard" || slot.device === "Mouse");

/** A slot the repo may rewrite: on the keyboard or mouse, or on nothing. */
const isOurs = (slot: EliteSlot): boolean =>
  slot.device === "Keyboard" || slot.device === "Mouse" || slot.device === NO_DEVICE;

const bindingOf = (slot: EliteSlot): string =>
  describeBinding(
    slot.device,
    slot.key,
    slot.modifiers.map((entry) => entry.key),
  );

const wantedText = (wanted: Wanted | null): string =>
  wanted === null ? "" : describeBinding(wanted.device, wanted.key, wanted.modifiers);

/**
 * Each control a vocabulary names, with the action that names it, and the controls it names
 * that the file does not have. Refuses what cannot be written.
 */
function claims(
  binds: EliteBinds,
  vocabulary: Record<string, ActionSpec>,
): {
  found: { action: string; control: EliteControl; wanted: Wanted | null }[];
  absent: { action: string; tag: string; wanted: Wanted | null }[];
} {
  const byTag = new Map<string, EliteControl>();
  for (const control of binds.controls)
    if (!byTag.has(control.tag)) byTag.set(control.tag, control);
  const owner = new Map<string, string>();
  const found: { action: string; control: EliteControl; wanted: Wanted | null }[] = [];
  const absent: { action: string; tag: string; wanted: Wanted | null }[] = [];
  for (const [action, spec] of Object.entries(vocabulary)) {
    const tag = spec.ingame;
    if (tag === undefined) continue;
    const earlier = owner.get(tag);
    if (earlier !== undefined) {
      throw new EliteError(`${earlier} and ${action} both name the control ${tag}`);
    }
    owner.set(tag, action);
    if (!/^[A-Za-z_][\w.-]*$/.test(tag)) {
      throw new EliteError(`${action} names ${tag}, which is not a control name`);
    }
    const control = byTag.get(tag);
    if (control === undefined) {
      absent.push({ action, tag, wanted: wantedBy(action, spec) });
      continue;
    }
    if (control.kind !== "button") {
      throw new EliteError(`${action} names ${tag}, which is not a button control`);
    }
    found.push({ action, control, wanted: wantedBy(action, spec) });
  }
  return { found, absent };
}

export interface EliteChange {
  action: string;
  control: string;
  slot: "Primary" | "Secondary";
  /** What the slot held, or "" when it held no keyboard or mouse binding. */
  from: string;
  /** What it holds now, or "" when it is cleared. */
  to: string;
}

export interface EliteWrite {
  text: string;
  changes: EliteChange[];
}

/** The slot's lines as the game writes them, with `hold` kept from the slot it replaces. */
function renderSlot(
  name: string,
  indent: string,
  unit: string,
  wanted: Wanted | null,
  hold: string | null,
): string[] {
  const head =
    wanted === null
      ? `<${name} Device="{NoDevice}" Key=""`
      : `<${name} Device="${wanted.device}" Key="${wanted.key}"`;
  const children = [
    ...(wanted?.modifiers ?? []).map((key) => `<Modifier Device="Keyboard" Key="${key}" />`),
    ...(hold === null ? [] : [hold]),
  ];
  if (children.length === 0) return [`${indent}${head} />`];
  return [
    `${indent}${head}>`,
    ...children.map((child) => `${indent}${unit}${child}`),
    `${indent}</${name}>`,
  ];
}

const indentOf = (line: string): string => /^\s*/.exec(line)?.[0] ?? "";

/**
 * Write a vocabulary into a bindings file, starting from `base` (a preset the game ships).
 *
 * The repo owns the keyboard and mouse bindings of every button control the vocabulary
 * names: they are removed and the action's binding put in the first slot that is then
 * free. A slot bound to anything else -- a joystick, a pedal -- is not ours and is left
 * alone; if both are, nothing can be written and this refuses. Every other line of `base`
 * is kept byte for byte. The result is a `Custom` preset 4.1, the one the game reads.
 *
 * The game's presets do not all list the same controls: one made for a gamepad has some a
 * keyboard preset lacks, and the player's own file has ones no preset has. A control the
 * vocabulary names and `base` lacks is added at the end, in the shape the game writes, so
 * the file says what every control does rather than leaving some to the game's defaults.
 */
export function applyBinds(base: string, vocabulary: Record<string, ActionSpec>): EliteWrite {
  const binds = parseBinds(base);
  const lines = [...binds.lines];
  const changes: EliteChange[] = [];
  const edits: { from: number; to: number; replacement: string[] }[] = [];

  const { found, absent } = claims(binds, vocabulary);
  for (const { action, control, wanted } of found) {
    const slots = control.slots.filter(
      (slot): slot is EliteSlot & { slot: "Primary" | "Secondary" } => slot.slot !== "Binding",
    );
    const free = slots.filter(isOurs);
    const target = wanted === null ? undefined : free[0];
    if (wanted !== null && target === undefined) {
      throw new EliteError(
        `${control.tag} has both slots bound to other devices: nothing can be written for ${action}`,
      );
    }
    const unit = indentOf(lines[slots[0]?.line ?? control.line] ?? "").slice(
      indentOf(lines[control.line] ?? "").length,
    );
    for (const slot of slots) {
      const receives = slot === target;
      if (!isKeyboardOrMouse(slot) && !receives) continue;
      const own = isKeyboardOrMouse(slot) ? bindingOf(slot) : "";
      const next = receives ? wanted : null;
      const holdLine =
        lines
          .slice(slot.line, slot.endLine + 1)
          .map((line) => line.trim())
          .find((line) => line.startsWith("<Hold")) ?? null;
      const replacement = renderSlot(
        slot.slot,
        indentOf(lines[slot.line] ?? ""),
        unit === "" ? "\t" : unit,
        next,
        receives ? holdLine : null,
      );
      const existing = lines.slice(slot.line, slot.endLine + 1);
      if (replacement.join("\n") === existing.join("\n")) continue;
      edits.push({ from: slot.line, to: slot.endLine, replacement });
      const to = wantedText(next);
      if (own !== to)
        changes.push({ action, control: control.tag, slot: slot.slot, from: own, to });
    }
  }

  // From the bottom up, so the line numbers of the edits still to be made stay true.
  for (const edit of edits.sort((a, b) => b.from - a.from)) {
    lines.splice(edit.from, edit.to - edit.from + 1, ...edit.replacement);
  }
  const rootAt = lines.findIndex((line) => /^\s*<Root\b/.test(line));
  lines[rootAt] =
    `${indentOf(lines[rootAt] ?? "")}<Root PresetName="Custom" MajorVersion="4" MinorVersion="1">`;
  if (absent.length > 0) {
    const first = binds.controls[0];
    const indent = first === undefined ? "\t" : indentOf(lines[first.line] ?? "") || "\t";
    const slotIndent = `${indent}${indent}`;
    const added = absent.flatMap(({ action, tag, wanted }) => {
      if (wanted !== null) {
        changes.push({ action, control: tag, slot: "Primary", from: "", to: wantedText(wanted) });
      }
      return [
        `${indent}<${tag}>`,
        ...renderSlot("Primary", slotIndent, indent, wanted, null),
        ...renderSlot("Secondary", slotIndent, indent, null, null),
        `${indent}</${tag}>`,
      ];
    });
    const closeAt = lines.findLastIndex((line) => /^\s*<\/Root>/.test(line));
    if (closeAt === -1)
      throw new EliteError("the bindings file has no </Root> to add controls before");
    lines.splice(closeAt, 0, ...added);
  }
  return { text: lines.join(binds.eol), changes };
}

export interface EliteComparison {
  action: string;
  control: string;
  /** What the vocabulary sends, or "" for an action that sends nothing. */
  ours: string;
  /** The keyboard and mouse bindings the file has on the control. */
  theirs: string[];
  /** `missing` is a control the file does not have. */
  status: "agrees" | "differs" | "missing";
}

/** Which controls the vocabulary names have other keyboard or mouse bindings in `binds`. */
export function compareBinds(
  binds: EliteBinds,
  vocabulary: Record<string, ActionSpec>,
): EliteComparison[] {
  const byTag = new Map<string, EliteControl>();
  for (const control of binds.controls)
    if (!byTag.has(control.tag)) byTag.set(control.tag, control);
  const rows: EliteComparison[] = [];
  for (const [action, spec] of Object.entries(vocabulary)) {
    const tag = spec.ingame;
    if (tag === undefined) continue;
    const ours = wantedText(wantedBy(action, spec));
    const control = byTag.get(tag);
    if (control?.kind !== "button") {
      rows.push({ action, control: tag, ours, theirs: [], status: "missing" });
      continue;
    }
    const theirs = control.slots.filter(isKeyboardOrMouse).map(bindingOf);
    const agrees = ours === "" ? theirs.length === 0 : theirs.length === 1 && theirs[0] === ours;
    rows.push({ action, control: tag, ours, theirs, status: agrees ? "agrees" : "differs" });
  }
  return rows;
}
