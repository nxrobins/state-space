/** Public presentation types contain no native GPU handles. */
export type TerrainCamera = { eye: readonly number[]; forward: readonly number[]; right: readonly number[]; up: readonly number[]; target?: number };
export interface TerrainRenderer { render(camera: TerrainCamera): Promise<void>; close(): void }
