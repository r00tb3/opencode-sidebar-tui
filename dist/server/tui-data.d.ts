import { type Todo } from "./todos.js";
import type { TodoDisplaySettings } from "./tui-settings.js";
import { type TimingState } from "./timing.js";
/** One completed `todowrite` recovered from the session log, in write order. */
export type TodoWrite = {
    /** Write timestamp in ms, or null when the part carries no time. */
    at: number | null;
    todos: Array<Todo>;
};
/**
 * Replays every completed `todowrite` in the session messages into a
 * chronological timeline. Parts without a timestamp are ordered last, keeping
 * their original order so legacy logs behave like the previous last-wins scan.
 */
export declare function todowritesFromMessages(messages: ReadonlyArray<unknown> | undefined): Array<TodoWrite>;
/**
 * Returns the most recent completed `todowrite` list. The strip relies on this
 * because the TUI cannot read the server plugin storage.
 */
export declare function latestTodosFromMessages(messages: ReadonlyArray<unknown> | undefined): Array<Todo> | undefined;
/**
 * Builds the strip heading: `Todo [done/total] · NN%`, dropping either part
 * according to the display settings and falling back to plain `Todo`.
 */
export declare function headerLabel(todos: ReadonlyArray<Todo>, display: Pick<TodoDisplaySettings, "count" | "percent">): string;
/** Standalone timer label for the right side of the heading, without a separator. */
export declare function headerTimeLabel(state: TimingState, timer: boolean, now: number): string | undefined;
