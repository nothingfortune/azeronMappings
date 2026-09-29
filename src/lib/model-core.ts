/**
 * The domain objects, with no filesystem in sight.
 *
 * The browser editor builds these from an embedded payload and runs the very same
 * compiler and linter the CLI runs, so there is one implementation of each rather than
 * one per surface.
 */

import type { StickDirection } from "../types/azeron.js";
import type {
  ActionSetData,
  ActionSpec,
  DeviceData,
  DevicePosition,
  DuplicateKeyAllowance,
  LintConfig,
  PositionSpec,
  ProfileData,
  ProfileMeta,
} from "../types/profile.js";

export class Device {
  readonly name: string;
  readonly hand: string | undefined;
  readonly mirrored: boolean;
  /** False until someone has pressed every key on the real unit. */
  readonly verified: boolean;
  readonly softwareDeviceId: string | undefined;
  readonly stickDirections: Partial<Record<StickDirection, StickDirection>>;
  readonly stickAngle: number | undefined;
  readonly unknownPins: ReadonlySet<number>;
  readonly positions: Record<string, DevicePosition>;
  readonly pinByPosition: Record<string, number>;
  readonly positionByPin: Record<number, string>;

  constructor(
    readonly data: DeviceData,
    readonly path = "",
  ) {
    this.name = data.device;
    this.hand = data.hand;
    this.mirrored = Boolean(data.mirrored);
    this.verified = data.verified === true;
    this.softwareDeviceId = data.software_device_id;
    this.stickDirections = data.stick_directions ?? {};
    this.stickAngle = data.stick_angle;
    this.unknownPins = new Set(data.unknown_pins ?? []);
    this.positions = data.positions;
    this.pinByPosition = Object.fromEntries(
      Object.entries(data.positions).map(([name, pos]) => [name, pos.pin]),
    );
    this.positionByPin = Object.fromEntries(
      Object.entries(data.positions).map(([name, pos]) => [pos.pin, name]),
    );
  }

  isStick(position: string): boolean {
    return this.positions[position]?.kind === "stick";
  }
}

/** The action vocabulary: action id to in-game key, plus role tags. */
export class ActionSet {
  readonly actions: Record<string, ActionSpec>;
  readonly duplicateKeyAllowlist: DuplicateKeyAllowance[];

  constructor(
    data: ActionSetData,
    readonly path = "",
  ) {
    this.actions = data.actions ?? {};
    this.duplicateKeyAllowlist = data.duplicate_key_allowlist ?? [];
  }

  get(id: string): ActionSpec {
    const action = this.actions[id];
    if (!action) throw new Error(`unknown action '${id}' in ${this.path}`);
    return action;
  }

  tags(id: string | undefined): Set<string> {
    if (!id) return new Set();
    return new Set(this.actions[id]?.tags ?? []);
  }

  label(id: string): string {
    return this.actions[id]?.label ?? id;
  }

  /** What this action actually sends, as a comparable string. */
  signature(id: string): string {
    const spec = this.actions[id] ?? {};
    return JSON.stringify([spec.key ?? null, spec.meta ?? null, spec.mouse ?? null]);
  }

  bySignature(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const id of Object.keys(this.actions)) {
      const signature = this.signature(id);
      const list = out.get(signature) ?? [];
      list.push(id);
      out.set(signature, list);
    }
    return out;
  }
}

/** Just enough of a game for the compiler and linter; the CLI's Game satisfies it. */
export interface GameLike {
  slug: string;
  actions: ActionSet;
  lintConfig: LintConfig;
}

export interface ProfileOptions {
  path?: string;
  game?: GameLike | null;
}

export class Profile {
  readonly meta: ProfileMeta;
  readonly positions: Record<string, PositionSpec>;
  readonly path: string;
  readonly game: GameLike | null;
  readonly slug: string;

  constructor(
    readonly data: ProfileData,
    readonly device: Device,
    options: ProfileOptions = {},
  ) {
    this.meta = data.profile;
    this.positions = data.positions;
    this.path = options.path ?? "";
    this.game = options.game ?? null;
    this.slug =
      this.path
        .split("/")
        .pop()
        ?.replace(/\.ya?ml$/, "") ??
      this.meta.name ??
      "profile";
  }

  get id(): string | undefined {
    return this.meta.id;
  }
  get name(): string | undefined {
    return this.meta.name;
  }
  get unit(): string | undefined {
    return this.meta.unit;
  }
  get set(): string | undefined {
    return this.meta.set;
  }
  get template(): string | undefined {
    return this.meta.template;
  }

  get outputName(): string {
    if (this.meta.output) return this.meta.output;
    const slug = this.game?.slug ?? "profile";
    return `${slug}_${this.unit ?? "left"}.json`;
  }
}
