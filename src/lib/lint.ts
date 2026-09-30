/**
 * Lint profiles against the constraints that were paid for in play sessions.
 *
 * Every rule here exists because something went wrong in game. See CLAUDE.md for the
 * numbered constraints each one enforces.
 */

import { DEFAULT_FEATURE_DELAY, SLOTS, STICK_MODE_CODES, TYPE_MOUSE } from "../types/azeron.js";
import { resolveSlot } from "./binding.js";
import * as keys from "./keys.js";
import type { Slot } from "../types/azeron.js";
import type {
  Acknowledgement,
  ActionSpec,
  KeySlotSpec,
  LintConfig,
  RawSlotSpec,
  SlotSpec,
} from "../types/profile.js";
import type { ActionSet, Profile } from "./model-core.js";
import type { Game, Genre } from "./model.js";

export const ERROR = "error";
export const WARNING = "warning";
export const NOTE = "note";
export type Level = typeof ERROR | typeof WARNING | typeof NOTE;

export const ROLE_TAGS = ["combat", "movement", "travel", "menu", "utility"] as const;

export interface Finding {
  level: Level;
  rule: string;
  message: string;
  profile?: string;
  position?: string;
  key?: string;
}

export function formatFinding(finding: Finding): string {
  let where = finding.profile ?? "-";
  if (finding.position) where += `:${finding.position}`;
  else if (finding.key) where += `:${finding.key}`;
  return `${finding.level.padEnd(7)} ${finding.rule.padEnd(22)} ${where.padEnd(28)} ${finding.message}`;
}

interface Binding {
  position: string;
  slot: string;
  action: string | null;
  raw: RawSlotSpec | KeySlotSpec | null;
}

/** Every binding across a profile, slots and stick directions alike. */
export function* iterBindings(profile: Profile): Generator<Binding> {
  for (const [position, spec] of Object.entries(profile.positions)) {
    if (profile.device.isStick(position)) {
      for (const [direction, value] of Object.entries(spec.directions ?? {})) {
        yield typeof value === "string"
          ? { position, slot: `stick_${direction}`, action: value, raw: null }
          : { position, slot: `stick_${direction}`, action: null, raw: value };
      }
      continue;
    }
    for (const slot of SLOTS) {
      const value = spec[slot];
      if (value === null || value === undefined) continue;
      yield typeof value === "string"
        ? { position, slot, action: value, raw: null }
        : { position, slot, action: null, raw: value };
    }
  }
}

/**
 * What a binding actually sends, canonicalised.
 *
 * The export holds the same key in more than one encoding -- Shift is "16" in an older
 * profile and "ShiftLeft" in one edited by 2.0.2 -- so raw tokens are resolved to their
 * canonical name before comparison. Otherwise the same physical key read from two
 * profiles compares unequal.
 */
export function emittedKey(
  actions: ActionSet,
  action: string | null,
  raw: RawSlotSpec | KeySlotSpec | null,
): string | null {
  const spec: ActionSpec | RawSlotSpec | KeySlotSpec = action
    ? (actions.actions[action] ?? {})
    : (raw ?? {});

  const mouse = "mouse" in spec ? spec.mouse : undefined;
  if (mouse) return `mouse:${mouse}`;

  // A mouse button the app wrote with a code this repo cannot name comes back as
  // `{type_raw: "15", key_raw: "4"}`. Read as a key it was "4" -- a phantom that could
  // collide with a real key, or be reported as a key nothing declares.
  const typeRaw = "type_raw" in spec ? spec.type_raw : undefined;
  if (typeRaw === TYPE_MOUSE) {
    const code = "key_raw" in spec ? spec.key_raw : undefined;
    return code === undefined ? null : `mouse:${keys.mouseToName(code) ?? code}`;
  }

  const named = "key" in spec ? (spec.key ?? null) : null;
  const namedMeta = "meta" in spec ? (spec.meta ?? null) : null;
  const rawKey = "key_raw" in spec ? (spec.key_raw ?? null) : null;
  const rawMeta = "meta_raw" in spec ? (spec.meta_raw ?? null) : null;

  const key = named ?? keys.keyToName(rawKey);
  const meta = namedMeta ?? keys.metaToName(rawMeta);
  if (key === null && meta === null) return null;
  return [meta, key].filter((part): part is string => Boolean(part)).join("+");
}

/**
 * Every action indexed by the key it emits, so a slot that holds a raw key can be traced
 * back to the action that declares it.
 */
export function actionsByEmittedKey(actions: ActionSet): Map<string, string> {
  const byKey = new Map<string, string>();
  for (const id of Object.keys(actions.actions)) {
    const key = emittedKey(actions, id, null);
    if (key !== null && !byKey.has(key)) byKey.set(key, id);
  }
  return byKey;
}

/** Rules that live in actions.yaml itself. */
export function checkActions(actions: ActionSet): Finding[] {
  const findings: Finding[] = [];
  const allow = new Set(actions.duplicateKeyAllowlist.map((entry) => entry.key));
  for (const [signature, ids] of actions.bySignature()) {
    const parsed = JSON.parse(signature) as [string | null, string | null, string | null];
    const [key, meta, mouse] = parsed;
    if (ids.length < 2) continue;
    if (key === null && meta === null && mouse === null) continue;
    if (key !== null && allow.has(key)) continue;
    const culprit = key ?? meta ?? mouse;
    findings.push({
      level: ERROR,
      rule: "key-collision",
      ...(culprit === null ? {} : { key: culprit }),
      message:
        `${culprit ?? "?"} is sent by ${String(ids.length)} different actions ` +
        `(${[...ids].sort().join(", ")}); if that is deliberate add it to duplicate_key_allowlist`,
    });
  }
  return findings;
}

/** action id for a slot, whether it names an action or carries raw tokens. */
function actionForSlot(
  actions: ActionSet,
  byKey: Map<string, string>,
  value: SlotSpec | undefined,
): string | undefined {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return undefined;
  const key = emittedKey(actions, null, value);
  return key === null ? undefined : byKey.get(key);
}

/** Actions whose timing a fight depends on: anything that shoots, and anything that flies. */
function isTimeCritical(tags: ReadonlySet<string>): boolean {
  return tags.has("combat") || tags.has("movement");
}

export function checkProfile(profile: Profile, actions: ActionSet, config: LintConfig): Finding[] {
  const findings: Finding[] = [];
  const name = profile.slug;
  const device = profile.device;
  const allowKeys = new Set(actions.duplicateKeyAllowlist.map((entry) => entry.key));
  const keySources = new Map<string, { position: string; slot: string; action: string | null }[]>();
  const actionByKey = actionsByEmittedKey(actions);

  for (const { position, slot, action, raw } of iterBindings(profile)) {
    if (!(position in device.positions)) {
      findings.push({
        level: ERROR,
        rule: "unknown-position",
        profile: name,
        position,
        message: `no such position on device ${device.name}`,
      });
      continue;
    }

    if (action && !(action in actions.actions)) {
      findings.push({
        level: ERROR,
        rule: "unknown-action",
        profile: name,
        position,
        message: `${slot} -> unknown action '${action}'`,
      });
      continue;
    }

    // Any inline binding, a mouse button included. Gating on `key` let an undeclared mouse
    // button through while the binding sheet listed it as undeclared -- two surfaces, two
    // verdicts on the same slot.
    if (raw) {
      const emitted = emittedKey(actions, null, raw);
      if (emitted && !actionByKey.has(emitted)) {
        findings.push({
          level: ERROR,
          rule: "unbound-key",
          profile: name,
          position,
          message: `${slot} sends ${emitted}, which no action in actions.yaml declares`,
        });
      }
    }

    const emitted = emittedKey(actions, action, raw);
    if (emitted) {
      const list = keySources.get(emitted) ?? [];
      list.push({ position, slot, action });
      keySources.set(emitted, list);
    }
  }

  // A mirrored unit does not report the same pins or directions as the left-handed
  // layout. A profile built on an unverified map compiles cleanly but binds the wrong
  // physical keys.
  if (!device.verified) {
    findings.push({
      level: WARNING,
      rule: "unverified-device",
      profile: name,
      message:
        `device ${device.name} has not been press-tested (verified: false), so every ` +
        "position in this profile is a guess. Run `azeron probe` and export the real map.",
    });
  }

  // stick_angle rotates the stick in firmware; stick_directions compensates at compile
  // time for a stick that was never rotated. Both at once corrects twice and lands back
  // where it started.
  if (device.stickAngle !== undefined && Object.keys(device.stickDirections).length > 0) {
    findings.push({
      level: ERROR,
      rule: "stick-double-correction",
      profile: name,
      message:
        `device ${device.name} sets both stick_angle and stick_directions. They are two ` +
        "ways to fix the same rotation; applying both cancels out. Keep one.",
    });
  }

  // Constraint 1: a stick in gamepad mode stutters Everspace 2.
  if (config.require_keyboard_stick) {
    for (const [position, spec] of Object.entries(profile.positions)) {
      if (!device.isStick(position)) continue;
      const mode = spec.mode;
      if (mode === undefined || !(mode in STICK_MODE_CODES)) {
        findings.push({
          level: ERROR,
          rule: "stick-not-keyboard",
          profile: name,
          position,
          message:
            `stick mode is '${String(mode)}'; only keyboard mode is allowed (gamepad mode made ` +
            "the game flip between input devices and stutter)",
        });
      }
    }
  }

  for (const [position, spec] of Object.entries(profile.positions)) {
    if (!(position in device.positions)) continue;

    const tagsBySlot = new Map<Slot, Set<string>>();
    for (const slot of SLOTS) {
      const id = actionForSlot(actions, actionByKey, spec[slot]);
      if (id !== undefined) tagsBySlot.set(slot, actions.tags(id));
    }

    // A stick holds directions and a key holds slots. The other kind validates, is dropped
    // by the compiler, and never reaches the unit -- an authoring mistake nothing reported.
    const stickHere = device.isStick(position);
    const slotsHere = SLOTS.filter((slot) => spec[slot] !== undefined && spec[slot] !== null);
    if (stickHere && slotsHere.length > 0) {
      findings.push({
        level: ERROR,
        rule: "misplaced-binding",
        profile: name,
        position,
        message: `a stick sends directions, so its ${slotsHere.join("/")} is ignored`,
      });
    }
    if (!stickHere && spec.directions !== undefined && Object.keys(spec.directions).length > 0) {
      findings.push({
        level: ERROR,
        rule: "misplaced-binding",
        profile: name,
        position,
        message: "only a stick has directions, so these are ignored",
      });
    }

    // `raw.types` preserves type codes nobody understands -- v5's "6" on the thumb pad --
    // and the compiler writes it after the bindings. On a slot that is bound, a code that
    // disagrees with the binding wins: the key compiles, lints clean, and does nothing in
    // game. Rebinding the double tap on v5's pad would do exactly that.
    if (!device.isStick(position)) {
      const rawTypes = spec.raw?.types ?? [];
      SLOTS.forEach((slot, index) => {
        const bound = spec[slot];
        const kept = rawTypes[index];
        if (bound === undefined || bound === null || kept === undefined) return;
        let derived: string;
        try {
          derived = resolveSlot(bound, actions.actions)[0];
        } catch {
          return; // An unencodable binding is its own error, reported by the compiler.
        }
        if (kept !== derived) {
          findings.push({
            level: ERROR,
            rule: "raw-types-stale",
            profile: name,
            position,
            message:
              `${slot} is bound, but raw.types keeps type '${kept}' for it and the binding ` +
              `needs '${derived}' -- the compiler would write '${kept}', and the key would ` +
              "do nothing. Drop that entry from raw.types.",
          });
        }
      });
    }

    // Constraint 4: a long or double action delays the tap on the same key. Flight counts
    // as much as combat -- the constraint names boost, which is a movement action, and a
    // pitch that waits half a second is a missed shot all the same.
    const tapTags = tagsBySlot.get("tap") ?? new Set<string>();
    if (isTimeCritical(tapTags) && (spec.long ?? spec.double)) {
      findings.push({
        level: WARNING,
        rule: "combat-tap-delayed",
        profile: name,
        position,
        message:
          `tap is a ${tapTags.has("combat") ? "combat" : "flight"} action but the key also ` +
          "has a long/double action, so the tap waits " +
          `${String(spec.feature_delay ?? DEFAULT_FEATURE_DELAY)} ms`,
      });
    }

    // Constraint 5: a menu on a key used in a fight. A combat key gets mashed; a flight key
    // gets held, which is worse -- hold it past the long-press window and the menu opens.
    const allTags = new Set<string>();
    for (const tags of tagsBySlot.values()) for (const tag of tags) allTags.add(tag);
    if (allTags.has("menu") && isTimeCritical(allTags)) {
      findings.push({
        level: WARNING,
        rule: "menu-with-combat",
        profile: name,
        position,
        message: `the same key carries a menu action and a ${
          allTags.has("combat") ? "combat" : "flight"
        } action`,
      });
    }

    // Constraint 6: isHold latches until pressed again.
    for (const slot of SLOTS) {
      const field = slot === "tap" ? "hold" : (`hold_${slot}` as const);
      if (spec[field] && (tagsBySlot.get(slot) ?? new Set()).has("movement")) {
        findings.push({
          level: WARNING,
          rule: "hold-on-movement",
          profile: name,
          position,
          message: `${slot} latches a movement action; it will stay on until pressed again`,
        });
      }
    }
  }

  for (const [emitted, sources] of keySources) {
    if (sources.length < 2) continue;
    const parts = emitted.split("+");
    const bare = parts[parts.length - 1] ?? emitted;
    if (allowKeys.has(bare) || allowKeys.has(emitted)) continue;
    const ids = new Set(sources.map((source) => source.action));
    const detail =
      ids.size === 1
        ? "the same action is bound twice"
        : `different actions: ${[...ids].map(String).sort().join(", ")}`;
    findings.push({
      level: WARNING,
      rule: "duplicate-output-key",
      profile: name,
      key: bare,
      message: `${emitted} is sent from ${sources
        .map((source) => `${source.position}.${source.slot}`)
        .join(", ")} (${detail})`,
    });
  }

  return findings;
}

/** Cross-unit rules: required coverage, and mirrored roles on akimbo pairs. */
export function checkSet(profiles: readonly Profile[], actions: ActionSet): Finding[] {
  const findings: Finding[] = [];
  const first = profiles[0];
  if (!first) return findings;
  const setName = first.set ?? first.slug;

  const bound = new Set<string>();
  // A binding left as raw tokens still sends its key, so coverage is measured by what
  // reaches the game as well as by which action a position names.
  const sent = new Set<string>();
  for (const profile of profiles) {
    for (const binding of iterBindings(profile)) {
      if (binding.action) bound.add(binding.action);
      const key = emittedKey(actions, binding.action, binding.raw);
      if (key !== null) sent.add(key);
    }
  }

  for (const [id, spec] of Object.entries(actions.actions)) {
    const tags = new Set(spec.tags ?? []);
    if (!tags.has("required") || spec.provided_by) continue;
    const key = emittedKey(actions, id, null);
    if (!bound.has(id) && (key === null || !sent.has(key))) {
      findings.push({
        level: ERROR,
        rule: "missing-required",
        profile: setName,
        message:
          `required action '${id}' is not bound on any unit in set '${setName}', so it ` +
          "cannot be reached without another input device",
      });
    }
  }

  if (profiles.length === 2) {
    const [left, right] = profiles as [Profile, Profile];
    for (const position of Object.keys(left.positions)) {
      if (!(position in right.positions)) continue;
      const roles = [left, right].map((profile) => {
        const tap = profile.positions[position]?.tap;
        const tags = typeof tap === "string" ? actions.tags(tap) : new Set<string>();
        return ROLE_TAGS.find((tag) => tags.has(tag)) ?? null;
      });
      const [leftRole, rightRole] = roles;
      if (leftRole && rightRole && leftRole !== rightRole) {
        findings.push({
          level: WARNING,
          rule: "akimbo-role-mismatch",
          profile: setName,
          position,
          message:
            `mirrored position does ${leftRole} on ${String(left.unit)} but ${rightRole} on ` +
            `${String(right.unit)}, so the same finger learns two unrelated jobs`,
        });
      }
    }
  }
  return findings;
}

function matches(ack: Acknowledgement, finding: Finding): boolean {
  if (ack.rule !== finding.rule) return false;
  if (ack.profile && ack.profile !== finding.profile) return false;
  if (ack.position && ack.position !== finding.position) return false;
  if (ack.key && ack.key !== finding.key) return false;
  return true;
}

export interface LintResult {
  live: Finding[];
  acknowledged: { finding: Finding; ack: Acknowledgement }[];
}

/** Split findings into live and acknowledged, and flag acknowledgements gone stale. */
export function applyAcknowledgements(
  findings: readonly Finding[],
  acknowledgements: readonly Acknowledgement[],
): LintResult {
  const live: Finding[] = [];
  const acknowledged: { finding: Finding; ack: Acknowledgement }[] = [];
  const used = new Set<number>();

  for (const finding of findings) {
    const index = acknowledgements.findIndex((ack) => matches(ack, finding));
    const ack = index === -1 ? undefined : acknowledgements[index];
    if (ack) {
      used.add(index);
      acknowledged.push({ finding, ack });
    } else {
      live.push(finding);
    }
  }

  acknowledgements.forEach((ack, index) => {
    if (used.has(index)) return;
    live.push({
      level: NOTE,
      rule: "stale-acknowledgement",
      ...(ack.profile ? { profile: ack.profile } : {}),
      ...(ack.position ? { position: ack.position } : {}),
      ...(ack.key ? { key: ack.key } : {}),
      message: `acknowledgement '${String(ack.rule)}' no longer matches any finding -- delete it`,
    });
  });

  return { live, acknowledged };
}

export function lintProfiles(
  actions: ActionSet,
  profiles: readonly Profile[],
  config: LintConfig,
): LintResult {
  let findings = checkActions(actions);
  for (const profile of profiles)
    findings = findings.concat(checkProfile(profile, actions, config));

  const bySet = new Map<string, Profile[]>();
  for (const profile of profiles) {
    const key = profile.set ?? profile.slug;
    const list = bySet.get(key) ?? [];
    list.push(profile);
    bySet.set(key, list);
  }
  for (const key of [...bySet.keys()].sort()) {
    findings = findings.concat(checkSet(bySet.get(key) ?? [], actions));
  }

  return applyAcknowledgements(findings, config.acknowledged ?? []);
}

export function lintGame(game: Game, profiles?: readonly Profile[]): LintResult {
  return lintProfiles(game.actions, profiles ?? game.loadedProfiles(), game.lintConfig);
}

/**
 * A genre default carries no keys, so only the ergonomic rules apply. A default that
 * violates a constraint propagates that violation to every game that inherits it.
 */
export function lintGenre(genre: Genre): LintResult {
  return lintProfiles(genre.actions, [genre.defaultProfile()], genre.lintConfig);
}
