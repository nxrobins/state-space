/** Host lifecycle utilities. No native work starts on import. */
import type { TacticalCamera3D } from 'state-space-engine/experimental/3d/tactical-renderer';

export function createSlabRuntimeGuard(fetcher: typeof fetch, base: string) {
  const url = new URL('../verification/safety-hold.json', base);
  return async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetcher(url, {cache: 'no-store', signal: controller.signal});
      if (!response.ok) throw Error('Runtime hold could not be read.');
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'blockRecovery') || (value as {blockRecovery: unknown}).blockRecovery !== false) throw Error('Runtime verification is held. This client remains stopped until review clears the hold.');
    } finally {clearTimeout(timer);}
  };
}
export function slabOrbitCamera(yaw: number, pitch: number, radius: number): TacticalCamera3D {
  if (![yaw, pitch, radius].every(Number.isFinite) || Math.abs(pitch) > 1.4 || radius < 4 || radius > 32) throw Error('Invalid orbit camera.');
  const c = Math.cos(pitch), s = Math.sin(pitch), x = Math.sin(yaw), z = Math.cos(yaw);
  return {eye: [4 + radius * c * x, 4 - radius * s, 4 + radius * c * z], forward: [-c * x, s, -c * z], right: [-z, 0, x], up: [-s * x, -c, -s * z], fovY: Math.PI / 3, near: 0.1, far: 100};
}
export {createFramePump as createSlabFramePump} from '../shared/frame-pump.js';
