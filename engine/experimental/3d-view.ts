/** Public presentation types contain no native GPU handles. */
export type TerrainCamera = { eye: readonly number[]; forward: readonly number[]; right: readonly number[]; up: readonly number[]; target?: number };
export interface TerrainRenderer { render(camera: TerrainCamera): Promise<void>; close(): void; inspectMesh?(): Promise<{faces:number[][];rebuilt:number[];meshDispatch?:number[]}> }

export type LatencyRecord = {
  id: number; kind: 'step' | 'render' | 'gameplay'; tick: number;
  cpu: Record<string, number>;
  gpu: { status: 'pending' | 'complete' | 'disabled' | 'unsupported' | 'busy' | 'error'; ms: Record<string, number>; error?: string };
};
export type LatencySnapshot = { enabled: boolean; gpuTimingRequested: boolean; gpuTimestamps: boolean; capacity: number; records: LatencyRecord[] };
