import type {
  GameplayCommand3D,
  GameplayCommit3D,
  GameplayPresentation3D,
  GameplayState3D,
} from '../gameplay-view.js';
import type { StructuralEdit3D } from './structural-world-core.js';
export type StructuralSubmissionTiming3D = {
  submittedAt: number;
  mappedAt?: number;
  queueCompletedAt?: number;
  validatedAt?: number;
};
export type StructuralGameplayLatency3D = {
  startedAt: number;
  preparedAt: number;
  renderStartedAt?: number;
  renderEncodedAt?: number;
  completedAt?: number;
  boundaries: StructuralSubmissionTiming3D[];
};
export type StructuralGameplayCommit3D = Omit<
  GameplayCommit3D,
  'submissions' | 'completionBoundaries'
> & { submissions: number; completionBoundaries: number; latency: StructuralGameplayLatency3D };
export type StructuralGameplayOptions3D = {
  edits?: readonly StructuralEdit3D[];
  presentation?: GameplayPresentation3D;
};
/** The controller is kinematic. It observes terrain but exerts no physical force. */
export interface StructuralResidentGameplay3D {
  /** Legacy controller tools are disabled; use validated M5 structural edits. */
  step(
    command: GameplayCommand3D,
    options?: StructuralGameplayOptions3D,
  ): Promise<StructuralGameplayCommit3D>;
  present(presentation: GameplayPresentation3D): Promise<StructuralGameplayCommit3D>;
  restore(state: GameplayState3D): Promise<void>;
  inspect(): GameplayState3D;
  close(): void;
}
