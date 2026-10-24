/** Server-side settings that control model-context behavior. */
export type TodoSettings = {
    updateReminders: boolean;
};
export declare const DEFAULT_SETTINGS: TodoSettings;
/** Plugin-wide storage key for the server settings record. */
export declare const TODO_SETTINGS_KEY = "settings";
/** Coerces stored settings (which may predate a field or be corrupted) into valid values. */
export declare function normalizeTodoSettings(value: unknown): TodoSettings;
/**
 * RPC surface for the settings the TUI menu edits but the server plugin owns.
 * Both plugins have separate storage, so behavior settings are read and written
 * through this RPC instead of the TUI's local store.
 */
export declare const TodolistRpc: {
    readonly id: "aiev.todolist";
    readonly methods: {
        readonly getSettings: {
            readonly input: {
                readonly type: "object";
                readonly properties: {};
                readonly additionalProperties: false;
            };
            readonly output: {
                readonly type: "object";
                readonly properties: {
                    readonly updateReminders: {
                        readonly type: "boolean";
                    };
                };
                readonly required: readonly ["updateReminders"];
                readonly additionalProperties: false;
            };
        };
        readonly setSettings: {
            readonly input: {
                readonly type: "object";
                readonly properties: {
                    readonly updateReminders: {
                        readonly type: "boolean";
                    };
                };
                readonly required: readonly ["updateReminders"];
                readonly additionalProperties: false;
            };
            readonly output: {
                readonly type: "object";
                readonly properties: {
                    readonly updateReminders: {
                        readonly type: "boolean";
                    };
                };
                readonly required: readonly ["updateReminders"];
                readonly additionalProperties: false;
            };
        };
    };
    readonly events: {};
};
