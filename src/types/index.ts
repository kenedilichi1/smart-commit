/**
 * Strictly-typed IPC message contract between the main process and the AI worker.
 * Each variant carries only the fields relevant to that message kind, giving the
 * type system full narrowing power on both ends of the channel.
 */
export type WorkerMessage =
  | { type: "status"; event: "download_started" | "download_finished" }
  | { type: "progress"; percent: number }
  | { type: "success"; message: string }
  | { type: "error"; error: string };
