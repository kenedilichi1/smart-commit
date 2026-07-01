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
  const aiMessage = await aiPromise;

  // Display the suggested output cleanly to the user
  const styledMessage = styleText("green", `"${aiMessage}"`);
  console.log(`\n👉 Suggested Message: ${styledMessage}\n`);

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

    let finalMessage = aiMessage;

    if (!isApproved) {
      console.log(
        styleText(
          "dim",
          `\nLeave empty to cancel. Current default placeholder: "${aiMessage}"`,
        ),
      );
      const textAnswer = await rl.question(
        styleText("cyan", "Enter your custom commit message: \n> "),
      );

      finalMessage = textAnswer.trim();

      if (finalMessage === "") {
        console.log(styleText("yellow", "\n👋 Commit canceled."));
        rl.close();
        return; // Return cleanly — let index.ts exit normally (code 0)
      }
    }

    // Release the stdin handle before executing the commit
    rl.close();

    console.log(styleText("cyan", "\nWriting git commit object..."));

    executeCommit(finalMessage);

    console.log(styleText("green", `\n🎉 Commit created successfully!`));
    console.log(`Logged Message: "${finalMessage}"\n`);
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
