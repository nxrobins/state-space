import type {UserConfig} from 'vite';
export type SdkEntry = Readonly<{key: string; source: string; filename: string; target?: string}>;
export const SDK_ROOT: string;
export const SDK_ENTRIES: readonly SdkEntry[];
export type SharedEntry = SdkEntry & Readonly<{resolved: string}>;
export const SHARED_ENTRIES: readonly SharedEntry[];
export function sdkEntries(exports: Record<string, {types: string; import: string}>): readonly SdkEntry[];
export function sdkConfig(key: string): UserConfig;
