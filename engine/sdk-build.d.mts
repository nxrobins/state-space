import type {UserConfig} from 'vite';
export type SdkEntry = Readonly<{key: string; source: string; filename: string; target?: string}>;
export const SDK_ROOT: string;
export const SDK_ENTRIES: readonly SdkEntry[];
export function sdkExports(entries?: readonly SdkEntry[]): Record<string, {types: string; import: string}>;
export function validateSdkMetadata(packageData: {exports: unknown}, declarations: {include: string[]}, entries?: readonly SdkEntry[]): void;
export function sdkConfig(key: string): UserConfig;
