import type { Plugin } from "@opencode/plugin/tui";
export type TodoDisplaySettings = {
    count: boolean;
    percent: boolean;
    timer: boolean;
    gap: 0 | 1 | 2;
    collapseThreshold: 2 | 3 | 5;
    border: boolean;
};
export declare const DEFAULT_SETTINGS: TodoDisplaySettings;
export declare const SETTINGS_KEY = "aiev.todolist.settings";
/** Coerces stored settings (which may predate a field or be corrupted) into valid values. */
export declare function normalizeSettings(value: unknown): TodoDisplaySettings;
/** Human-readable label for the header separator setting. */
export declare function gapLabel(gap: TodoDisplaySettings["gap"]): string;
/**
 * Native settings menu: each pick applies and persists immediately, then the
 * menu reopens (the host closes the dialog before the next select).
 */
export declare function openSettingsMenu(context: Plugin.Context, settings: TodoDisplaySettings, update: (mutation: (draft: TodoDisplaySettings) => void) => Promise<void>): void;
