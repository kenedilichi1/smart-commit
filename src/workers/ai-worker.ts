import { getLlama, LlamaChatSession } from "node-llama-cpp";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { getSystemPrompt, getUserPrompt, CC_REGEX } from "../prompts/commit.js";
import type { WorkerMessage } from "../types/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Model storage — XDG-compliant on Linux, ~/.smart-commit on other platforms.
// Using the home directory means the model persists correctly for global installs
// (i.e. `npm install -g smart-commit`) instead of writing into node_modules.
// ---------------------------------------------------------------------------
const MODELS_DIR = resolveModelsDir();

console.log(MODELS_DIR);
function resolveModelsDir(): string {
  const xdgData = process.env["XDG_DATA_HOME"];
  if (xdgData) {
    return path.join(xdgData, "smart-commit", "models");
  }
  return path.join(os.homedir(), "web_workspace", "smart_commit", "models");
}

const MODEL_NAME = "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf";
const MODEL_URL = `https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/${MODEL_NAME}`;
const MODEL_PATH = path.join(MODELS_DIR, MODEL_NAME);

// Helper to send typed IPC messages without redundant casting at every call site.
function send(msg: WorkerMessage): void {
  process.send?.(msg);
}

async function downloadModelIfMissing(): Promise<void> {
  if (fs.existsSync(MODEL_PATH)) return;

  send({ type: "status", event: "download_started" });
  fs.mkdirSync(MODELS_DIR, { recursive: true });

  const response = await fetch(MODEL_URL);

  if (!response.ok) {
    throw new Error(`Failed to download model: HTTP ${response.status}`);
  }

  const totalBytes = Number.parseInt(
    response.headers.get("content-length") ?? "0",
    10,
  );
  let downloadedBytes = 0;

  const fileStream = fs.createWriteStream(MODEL_PATH);

  if (!response.body) {
    throw new Error("Response body is empty");
  }

  const bodyStream = Readable.from(response.body);

  bodyStream.on("data", (chunk: Buffer) => {
    downloadedBytes += chunk.length;
    if (totalBytes > 0) {
      // Send percent as a number — the parent process formats the display string.
      const percent = parseFloat(
        ((downloadedBytes / totalBytes) * 100).toFixed(1),
      );
      send({ type: "progress", percent });
    }
  });

  await finished(bodyStream.pipe(fileStream));
  send({ type: "status", event: "download_finished" });
}

/**
 * Cleans and validates the raw LLM output.
 * - Takes only the first line (guards against multi-line hallucinations)
 * - Returns null if the result doesn't match Conventional Commits format
 */
function parseModelOutput(raw: string): string | null {
  const firstLine = raw.trim().split("\n")[0]?.trim() ?? "";
  if (!CC_REGEX.test(firstLine)) return null;
  return firstLine;
}

// ---------------------------------------------------------------------------
// Listen for the payload from the parent process
// ---------------------------------------------------------------------------
process.on("message", async (message: { diff: string }) => {
  const { diff } = message;
  try {
    await downloadModelIfMissing();

    const llama = await getLlama({ gpu: false });
    const model = await llama.loadModel({
      modelPath: MODEL_PATH,
      gpuLayers: 0,
    });
    const context = await model.createContext({ contextSize: 4096 });
    const session = new LlamaChatSession({
      contextSequence: context.getSequence(),
      systemPrompt: getSystemPrompt(),
    });

    const rawResponse = await session.prompt(getUserPrompt(diff), {
      maxTokens: 80,
      temperature: 0.2,
    });

    const commitMessage = parseModelOutput(rawResponse);

    if (!commitMessage) {
      // Model produced output that doesn't look like a valid commit message.
      // Surface the raw output so the caller can fall back gracefully.
      throw new Error(
        `Model produced an invalid commit message format: "${rawResponse.trim()}"`,
      );
    }

    send({ type: "success", message: commitMessage });
    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    send({ type: "error", error: errorMessage });
    process.exit(1);
  }
});
