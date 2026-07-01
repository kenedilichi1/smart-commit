import { styleText } from "node:util";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  isGitRepository,
  hasStagedChanges,
  getStagedDiff,
  getBranchName,
  getRecentCommits,
  executeCommit,
} from "../lib/git.js";
import { generateCommitMessage } from "../lib/ai.js";
import { CC_REGEX } from "../prompts/commit.js";
import type { ParsedCommitMessage } from "../lib/commit-message.js";

/**
 * Renders a { head, body } pair the same way whether it came from the model
 * or was typed by hand, so the "suggested" preview and the final "logged"
 * confirmation always look identical.
 */
function formatMessagePreview(parsed: ParsedCommitMessage): string {
  if (parsed.body.length === 0) return parsed.head;
  const indentedBody = parsed.body
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  return `${parsed.head}\n${indentedBody}`;
}

/**
 * Interactively collects a hand-typed head + optional bullet body.
 * Body collection stops on the first blank line. Returns null if the user
 * cancels by leaving the head empty.
 */
async function promptForCustomMessage(
  rl: ReturnType<typeof createInterface>,
  fallbackHead: string,
): Promise<ParsedCommitMessage | null> {
  console.log(
    styleText(
      "dim",
      `\nLeave empty to cancel. Current suggestion: "${fallbackHead}"`,
    ),
  );

  const headAnswer = await rl.question(
    styleText("cyan", "Enter your commit head: \n> "),
  );
  const head = headAnswer.trim();

  if (head === "") return null;

  console.log(
    styleText(
      "dim",
      "\nEnter body bullet points one per line (blank line to finish, or just hit enter to skip):",
    ),
  );

  const bodyLines: string[] = [];
  // Keep reading lines until the user submits an empty one.
  for (;;) {
    const line = await rl.question(styleText("cyan", "> "));
    if (line.trim() === "") break;
    const trimmed = line.trim();
    bodyLines.push(trimmed.startsWith("-") ? trimmed : `- ${trimmed}`);
  }

  return {
    head,
    body: bodyLines.join("\n"),
    headValid: CC_REGEX.test(head),
  };
}

export async function commitCommand() {
  // Precondition checks — throw so the top-level handler in index.ts
  // owns all exit behaviour instead of scattering process.exit() calls.
  if (!isGitRepository()) {
    throw new Error("You are not inside a valid Git repository directory.");
  }

  if (!hasStagedChanges()) {
    throw new Error(
      "No staged changes found. Run 'git add' on your files first.",
    );
  }

  const diff = getStagedDiff();
  const branch = getBranchName();
  const recentCommits = getRecentCommits(5);

  // Guard against accidentally staged large binary files (images, build artefacts, etc.)
  // that would flood IPC memory without adding meaningful signal for the model.
  const MAX_DIFF_BYTES = 500_000; // 500 KB
  if (Buffer.byteLength(diff, "utf8") > MAX_DIFF_BYTES) {
    throw new Error(
      `Staged diff is too large (${(Buffer.byteLength(diff, "utf8") / 1024).toFixed(0)} KB) for AI analysis.\n` +
        `Consider staging fewer files at once, or unstaging large binary/generated files.`,
    );
  }

  console.log(
    styleText(
      "cyan",
      "\n🧠 Spawning isolated child process and running local AI inference...",
    ),
  );

  // Obtain both the result promise and a direct kill handle for the worker.
  const { promise: aiPromise, kill: killWorker } = generateCommitMessage({
    diff,
    branch,
    recentCommits,
  });

  // Ensure Ctrl+C kills the forked LLM worker before exiting.
  // Replace the default SIGINT handler only for the duration of inference.
  const cleanupAndExit = () => {
    killWorker();
    console.log(
      styleText(
        "yellow",
        "\n\n👋 Script aborted. Cleaned up background processes.",
      ),
    );
    process.exit(130); // 130 is the standard exit code for Ctrl+C terminations
  };

  process.removeAllListeners("SIGINT");
  process.removeAllListeners("SIGTERM");
  process.on("SIGINT", cleanupAndExit);
  process.on("SIGTERM", cleanupAndExit);

  // Await the background inference — throws on timeout, crash, or bad output.
  // Resolves to { head, body, headValid }.
  const aiMessage: ParsedCommitMessage = await aiPromise;

  // Display the suggested output cleanly to the user
  const styledMessage = styleText("green", formatMessagePreview(aiMessage));
  console.log(`\n👉 Suggested Message:\n${styledMessage}\n`);

  // Instantiate an async readline interface bound to the terminal IO streams.
  const rl = createInterface({ input, output });

  try {
    const confirmAnswer = await rl.question(
      styleText("cyan", "Do you want to use this commit message? (Y/n): "),
    );

    // Default to confirmed unless the user explicitly types "n" or "no"
    const isApproved =
      confirmAnswer.trim().toLowerCase() !== "n" &&
      confirmAnswer.trim().toLowerCase() !== "no";

    let finalMessage: ParsedCommitMessage = aiMessage;

    if (!isApproved) {
      const custom = await promptForCustomMessage(rl, aiMessage.head);

      if (custom === null) {
        console.log(styleText("yellow", "\n👋 Commit canceled."));
        rl.close();
        return; // Return cleanly — let index.ts exit normally (code 0)
      }

      finalMessage = custom;
    }

    // Release the stdin handle before executing the commit
    rl.close();

    console.log(styleText("cyan", "\nWriting git commit object..."));

    executeCommit(finalMessage);

    console.log(styleText("green", `\n🎉 Commit created successfully!`));
    console.log(`Logged Message:\n${formatMessagePreview(finalMessage)}\n`);
  } catch (err) {
    // Ensure the terminal stream is safely released even on unexpected throws
    rl.close();
    throw err; // Re-throw for the top-level handler in index.ts
  }
}

export default {
  handler: commitCommand,
  description:
    "Generate a deterministic commit message using a sandboxed local AI model via native modules",
};
