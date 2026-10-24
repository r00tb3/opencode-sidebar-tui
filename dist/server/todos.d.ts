import type { TimingState } from "./timing.js";
export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type TodoPriority = "high" | "medium" | "low";
export type Todo = {
    content: string;
    status: TodoStatus;
    priority?: TodoPriority;
};
export type TodoRecord = {
    todos: Array<Todo>;
    updatedAt: number;
    timing?: TimingState;
};
export declare const TODO_STATUSES: ReadonlyArray<TodoStatus>;
export declare const TODO_PRIORITIES: ReadonlyArray<TodoPriority>;
export declare const STORAGE_PREFIX = "todos/";
/** Hard caps so a runaway or adversarial list can't blow up the request. */
export declare const MAX_TODOS = 100;
export declare const MAX_TODO_CONTENT_LENGTH = 500;
export declare const STATUS_MARK: Record<TodoStatus, string>;
export declare function storageKey(sessionID: string): string;
/**
 * Validates a `todowrite` payload. Throws a descriptive error on malformed
 * input so the model can correct itself.
 */
export declare function normalizeTodos(input: unknown): Array<Todo>;
/**
 * Renders a todo list as plain text for tool output and context injection.
 * An optional `suffix` appends per-task detail such as a measured duration.
 */
export declare function renderTodos(todos: Array<Todo>, suffix?: (todo: Todo) => string | undefined): string;
/** Reads a stored record defensively; returns undefined when the value is unusable. */
export declare function parseTodoRecord(value: unknown): TodoRecord | undefined;
/** Reads a stored timing state defensively; returns undefined when unusable. */
export declare function parseTimingState(value: unknown): TimingState | undefined;
export declare function hasOpenTodos(todos: Array<Todo>): boolean;
