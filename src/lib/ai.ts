import { fork } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { styleText } from "node:util";
import type { WorkerMessage, WorkerInput } from "../types/index.js";
import type { ParsedCommitMessage } from "../lib/commit-message.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Inference timeout in milliseconds.
 * Defaults to 2 minutes. Override via SMART_COMMIT_TIMEOUT_MS env var.
 * Set to 0 to disable the timeout entirely (not recommended in production).
 */
const INFERENCE_TIMEOUT_MS = Number(
  process.env["SMART_COMMIT_TIMEOUT_MS"] ?? 0,
);

export interface CommitMessageHandle {
  promise: Promise<ParsedCommitMessage>;
  kill: () => void;
}

/**
 * Forks an isolated child process to run local LLM inference.
 * Returns both the result promise and a kill() handle so callers
 * can terminate the worker on SIGINT/SIGTERM without leaking the process.
 */
export function generateCommitMessage(input: WorkerInput): CommitMessageHandle {
  let child: ChildProcess | null = null;
  let timeoutId: NodeJS.Timeout | null = null;
  let spinnerId: NodeJS.Timeout | null = null;

  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frameIndex = 0;

  const stopSpinner = () => {
    if (spinnerId) {
      clearInterval(spinnerId);
      process.stdout.write("\r\x1b[K"); // Clear the line
      spinnerId = null;
    }
  };

  const promise = new Promise<ParsedCommitMessage>((resolve, reject) => {
    const workerPath = path.join(__dirname, "../workers/ai-worker.js");
    child = fork(workerPath);

    // Guard against infinite hangs on slow hardware.
    // Skipped when timeout is explicitly disabled via env.
    if (INFERENCE_TIMEOUT_MS > 0) {
      timeoutId = setTimeout(() => {
        child?.kill("SIGKILL");
        reject(
          new Error(
            `AI inference timed out after ${INFERENCE_TIMEOUT_MS / 1000}s. ` +
              `Set SMART_COMMIT_TIMEOUT_MS to a higher value or 0 to disable.`,
          ),
        );
      }, INFERENCE_TIMEOUT_MS);
    }

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      stopSpinner();
    };

    // Pass the full context payload into the child process memory space.
    child.send(input);

    // Listen to incoming IPC communications from the worker.
    // The switch is exhaustive over the WorkerMessage union.
    child.on("message", (message: WorkerMessage) => {
      switch (message.type) {
        case "status":
          if (message.event === "download_started") {
            console.log(
              styleText(
                "cyan",
                `\n📥 First run detected! Downloading local AI engine...`,
              ),
            );
          } else if (message.event === "download_finished") {
            console.log(
              styleText(
                "green",
                "\n✅ Engine downloaded successfully and initialized!\n",
              ),
            );
          } else if (message.event === "inference_started") {
            spinnerId = setInterval(() => {
              process.stdout.write(
                styleText(
                  "cyan",
                  `\r${frames[frameIndex]} Generating commit message...`,
                ),
              );
              frameIndex = (frameIndex + 1) % frames.length;
            }, 80);
          }
          break;

        case "progress":
          // Write progress in-place without appending newlines.
          process.stdout.write(
            styleText(
              "yellow",
              `\rDownloading: ${message.percent}% completed...`,
            ),
          );
          break;

        case "success":
          cleanup();
          // The worker already validated message.head against CC_REGEX
          // before sending "success", so headValid is always true here.
          resolve({
            head: message.head,
            body: message.body,
            headValid: true,
          });
          break;

        case "error":
          cleanup();
          reject(new Error(message.error));
          break;
      }
    });

    // Gracefully catch sudden crashes (e.g. C++ segmentation faults from llama.cpp)
    child.on("exit", (code) => {
      cleanup();
      if (code !== 0) {
        reject(
          new Error(
            `AI subprocess crashed or exited unexpectedly (code: ${code})`,
          ),
        );
      }
    });

    child.on("error", (err) => {
      cleanup();
      reject(err);
    });
  });

  return {
    promise,
    kill: () => {
      if (timeoutId) clearTimeout(timeoutId);
      child?.kill("SIGKILL");
    },
  };
}
