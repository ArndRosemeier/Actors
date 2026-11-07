import { readFileSync } from "node:fs";
import type { ShapeOptions } from "../../packages/core/src/index";

/** One golden case (shared with the Rust tests through cases.json). */
export interface Case {
  name: string;
  pack: string;
  weights: Record<string, number>;
  options?: ShapeOptions;
  fit?: string[];
  load?: string[];
  skins?: string[];
  clips?: Record<string, number[]>;
  surfaceDelta?: Record<string, number>;
  merge?: string[];
}

export const CASES: Case[] = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8"));
