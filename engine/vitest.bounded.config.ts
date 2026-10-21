import cpu from './vitest.cpu.config.js';
import { boundedTests } from './vitest.shared.js';

// Use a CLI file filter for focused CPU/mock checks. Native and held cases stay excluded.
export default { ...cpu, test: { ...cpu.test, ...boundedTests } };
