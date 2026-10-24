import type { Plugin } from "@opencode/plugin";
import { type Todo, type TodoPriority } from "./todos.js";
/**
 * Config-driven todo injection (opencode-auto-todos parity, serkanalgur).
 *
 * A project opts in with `auto-todos.json` at its root or under
 * `.opencode/`:
 *
 * ```json
 * {
 *   "todos": [{ "content": "Run the test suite", "priority": "high", "order": "first" }],
 *   "deduplicate": true
 * }
 * ```
 *
 * Entry fields: `content` (required), `priority` (optional), `match`
 * (optional: only inject when an existing item contains this string,
 * case-insensitive), `order` (`"first"` or a 0-based index, default append),
 * `always` (default false: inject only when the incoming list is empty).
 *
 * Entries obey the same limits as `todowrite`: content over
 * `MAX_TODO_CONTENT_LENGTH` is dropped and the merged list never grows past
 * `MAX_TODOS`.
 *
 * Best-effort throughout: no config file, an unreadable file, or a lookup
 * failure means the model's list passes through untouched.
 */
export type AutoTodoEntry = {
    content: string;
    priority?: TodoPriority;
    match?: string;
    order?: "first" | number;
    always?: boolean;
};
export type AutoTodosConfig = {
    todos: Array<AutoTodoEntry>;
    deduplicate?: boolean;
};
/** Returns a clean config or undefined when the value is unusable. */
export declare function normalizeAutoTodosConfig(value: unknown): AutoTodosConfig | undefined;
/** Project root first, then `.opencode/`. Never throws. */
export declare function readAutoTodosConfig(directory: string): Promise<AutoTodosConfig | undefined>;
/**
 * Merges config entries into a validated list. Pure: never mutates inputs.
 * Returns the merged list plus how many entries were injected.
 */
export declare function applyAutoTodos(todos: Array<Todo>, config: AutoTodosConfig | undefined): {
    todos: Array<Todo>;
    injected: number;
};
/** The session's working directory via the typed client. Best-effort. */
export declare function resolveSessionDirectory(ctx: Plugin.Context, sessionID: string): Promise<string | undefined>;
/**
 * Full injection pass for the todowrite path. Returns the list to store:
 * the input unchanged when there is nothing to inject or anything fails.
 */
export declare function withAutoTodos(ctx: Plugin.Context, sessionID: string, todos: Array<Todo>): Promise<Array<Todo>>;
