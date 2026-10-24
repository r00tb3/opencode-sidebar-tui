import { type Todo, type TodoStatus } from "./todos.js";
/** Per-task timing collected while a todo run is active. */
export type TodoItemTiming = {
    content: string;
    status: TodoStatus;
    startedAt?: number;
    completedAt?: number;
};
/**
 * A single pass over a todo list: from the write that first introduced open
 * tasks until the write where nothing is open anymore. `abandoned` marks a run
 * that was replaced by a different list (or cleared) instead of completing.
 */
export type TodoRunTiming = {
    startedAt: number;
    endedAt?: number;
    abandoned?: boolean;
    items: Array<TodoItemTiming>;
};
export type TimingState = {
    current?: TodoRunTiming;
    last?: TodoRunTiming;
};
/**
 * Folds one `todowrite` into the timing state. Pure so the server plugin
 * (persisted incrementally) and the TUI (replayed from the message log) agree.
 */
export declare function applyTodoWrite(state: TimingState | undefined, todos: Array<Todo>, at: number): TimingState;
/** Replays a chronological list of writes into a timing state. */
export declare function buildTiming(writes: ReadonlyArray<{
    at: number | null;
    todos: Array<Todo>;
}>): TimingState;
/** Elapsed time of a run: final duration when closed, live age otherwise. */
export declare function runElapsed(run: TodoRunTiming, now: number): number;
/** Whether a run reached the end with at least one task actually completed. */
export declare function hasCompletedItem(run: TodoRunTiming): boolean;
/** Short label for a task's own time: fixed when completed, live while running. */
export declare function itemTimeLabel(item: TodoItemTiming | undefined, now: number): string | undefined;
export declare function findItem(run: TodoRunTiming | undefined, content: string): TodoItemTiming | undefined;
/** One-line timing summary for tool output, e.g. `running for 4m12s`. */
export declare function timingSummary(state: TimingState | undefined, now: number): string | undefined;
/** `42s`, `4m12s`, `1h03m`; anything unmeasurable collapses to `0s`. */
export declare function formatDuration(ms: number): string;
