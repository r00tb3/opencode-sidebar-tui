import type { Plugin } from "@opencode/plugin";
import { type Todo } from "./todos.js";
/**
 * Plugin storage is authoritative: every `todowrite` writes it synchronously
 * before the call returns, and `todoread` reads it back. That is the "same list
 * the todowrite/todoread tools manage" this command advertises.
 *
 * The message log is a lossy projection of the same data - it is subject to
 * compaction and retention, and its `time` fields can order a write
 * differently. Reading it first lets `/todo` report a stale list whenever the
 * two disagree, which is exactly what happens after a session restart or a
 * compaction boundary.
 *
 * The log is still consulted as a fallback so the command keeps working when
 * storage has no record yet, and so it stays in step with the TUI strip (the
 * strip cannot read plugin storage and relies on the log reader).
 */
export declare function todosFromMessageSources(ctx: Plugin.Context, sessionID: string): Promise<Array<Todo> | undefined>;
/** On-demand report for /todo: counts, current task, full list. */
export declare function renderTodoReport(todos: Array<Todo>): string;
/** Registers the `/todo` command. Returns a `{ dispose }` handle for setup teardown. */
export declare function registerTodoCommand(ctx: Plugin.Context): Promise<{
    dispose: () => Promise<void>;
}>;
