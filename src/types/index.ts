/**
 * Strictly-typed IPC message contract between the main process and the AI worker.
 * Each variant carries only the fields relevant to that message kind, giving the
 * type system full narrowing power on both ends of the channel.
 */
export type WorkerMessage =
  | { type: "status"; event: "download_started" | "download_finished" | "inference_started" }
  | { type: "progress"; percent: number }
  | { type: "success"; message: string }
  | { type: "error"; error: string };

/**
 * The full context payload sent from the main process to the AI worker via IPC.
 * Richer context produces more accurate, project-aware commit messages.
 */
export interface WorkerInput {
  /** Raw staged diff (may be truncated by the prompt builder). */
  diff: string;
  /** Current branch name, e.g. "feature/user-auth". Used to infer scope/type. */
  branch: string;
  /** Last N commit one-liners, e.g. ["a1b2c3 feat(auth): add login"]. Style reference. */
  recentCommits: string[];
}
