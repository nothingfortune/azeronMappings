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

  for (let index = rootAt + 1; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").trim();
    if (line === "" || line === "</Root>") continue;

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
      const opening = /^<(\w+)>$/.exec(line);
      if (!opening) throw new EliteError(`line ${String(index + 1)}: not a control: ${line}`);
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
