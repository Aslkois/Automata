// Configure and the brain: generating the canonical IR from settings, telling whether the brain
// still is that configuration, and keeping a generated brain in step with its hardware.
import { computeStats, type DroneDesign } from '../../sim/design';
import { semanticHash } from '../brain/ir';
import { irFromCode, type Brain, type BrainConfigMeta } from '../brain/model';
import { defaultConfig, type BrainConfig } from './config';
import { analyzeHardware, type HardwareProfile } from './hardware';
import { generateCode, GENERATOR_VERSION } from './generate';

export * from './config';
export { analyzeHardware, type HardwareProfile } from './hardware';
export { generateCode, rangeBand, describeWeapon, plan, type Plan } from './generate';
export { explain, type Explanation } from './explain';

export interface Generated {
  code: string;
  meta: BrainConfigMeta;
}

/** Generate the program for a design and its settings. */
export function generate(design: DroneDesign, data: BrainConfig, hw: HardwareProfile = analyzeHardware(design, computeStats(design))): Generated {
  const code = generateCode(design, data, hw);
  const ir = irFromCode(code);
  return { code, meta: { data, hash: semanticHash(ir), hardware: hw.key, generator: GENERATOR_VERSION } };
}

/**
 * - none: never configured (a hand-written brain)
 * - synced: the brain is exactly what its settings generate for this hardware
 * - hardware: the brain is untouched since generation, but the drone's hardware changed
 * - customized: the brain was edited in Code, Blocks or Nodes since it was generated
 */
export type ConfigStatus = 'none' | 'synced' | 'hardware' | 'customized';

export function configStatus(brain: Brain, design: DroneDesign | undefined): ConfigStatus {
  const cfg = brain.config;
  if (!cfg) return 'none';
  if (semanticHash(brain.ir) !== cfg.hash) return 'customized';
  if (design && analyzeHardware(design).key !== cfg.hardware) return 'hardware';
  return 'synced';
}

/** Replace the brain's program with the one its settings generate (the caller keeps a copy of a customised program). */
export function applyConfig(brain: Brain, design: DroneDesign, data: BrainConfig): Brain {
  const g = generate(design, data);
  return { ...brain, ir: irFromCode(g.code), views: {}, config: g.meta, updatedAt: Date.now() };
}

/** Keep new settings without touching the program (used while the brain is customised). */
export function storeSettings(brain: Brain, data: BrainConfig): Brain {
  return brain.config ? { ...brain, config: { ...brain.config, data } } : brain;
}

/**
 * After the drone's hardware changes, a brain that is still exactly its configuration is
 * regenerated for the new hardware (it refers to mounts by id). A customised or hand-written
 * brain is left alone.
 */
export function refreshForHardware(brain: Brain, design: DroneDesign): Brain {
  return configStatus(brain, design) === 'hardware' ? applyConfig(brain, design, brain.config!.data) : brain;
}

/** A first configuration for a drone that has none, starting from a doctrine. */
export function initialConfig(design: DroneDesign): BrainConfig {
  const hw = analyzeHardware(design);
  const role = hw.primary?.role;
  // a sensible doctrine from the weapons the drone carries; every value stays editable
  const doctrine = role === 'coilgun' || role === 'missiles' ? 'precision' : role === 'shotgun' ? 'aggressive' : hw.pd.length > 0 && hw.hasRadar ? 'interception' : role === 'rockets' ? 'harassment' : 'balanced';
  return defaultConfig(doctrine);
}
