import type { StickDirection, StickSector } from "./azeron.js";
import type { DeviceData } from "./profile.js";
import type { ProbeAssignment } from "../lib/probe.js";

export interface ProbePayload {
  generatedAt: string;
  profileName: string;
  /** The assumed maps, used for the diagram and for everything but the pins. */
  devices: Record<string, DeviceData>;
  /** Which device to sweep for each hand. */
  units: { hand: string; device: string }[];
  assignments: ProbeAssignment[];
  /** From the stick-only calibration profile: all eight sectors, 45-degree resolution. */
  stickAssignments: ProbeAssignment[];
}

export interface CapturedUnit {
  pins: Record<string, number>;
  stick: Partial<Record<StickDirection, StickDirection>>;
  /** Physical push -> the sector the firmware reported for it. */
  sectors?: Partial<Record<StickSector, StickSector>>;
}
