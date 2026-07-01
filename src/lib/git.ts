import { execSync, execFileSync } from "node:child_process";
import {
  buildGitCommitArgs,
  type ParsedCommitMessage,
} from "./commit-message.js";

/**
 * Plumbing check to ensure the tool is executing inside a live Git repository
 */
export function isGitRepository() {
  try {
    const result = execSync("git rev-parse --is-inside-work-tree", {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    return result.trim() === "true";
  } catch {
    return false;
  }
}

/**
 * Plumbing check to see if there are staged changes ready to commit.
 * Reads the staging index directly. Works on brand new and old repositories alike.
 * @returns {boolean}
 */
export function hasStagedChanges() {
  try {
    const output = execSync("git diff --cached --name-only", {
      encoding: "utf8",
    });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Gets the raw diff of all staged changes, excluding lock files, build
 * artefacts, and generated directories to keep the AI context focused.
 * Uses execFileSync with an args array — no shell involved, no quoting needed.
 * @returns {string}
 */
export function getStagedDiff() {
  try {
    const diff = execFileSync(
      "git",
      [
        "diff",
        "--cached",
        "--",
        ".",
        ":(exclude)pnpm-lock.yaml",
        ":(exclude)package-lock.json",
        ":(exclude)yarn.lock",
        ":(exclude)dist/*",
        ":(exclude)**/node_modules/**",
        ":(exclude)models/*",
      ],
      { encoding: "utf8" },
    );
    return diff.trim();
  } catch {
    throw new Error("Failed to read Git staged index pipeline.");
  }
}

/**
 * Returns the current branch name (e.g. "feature/user-auth").
 * Falls back to "unknown" on detached HEAD or bare repositories.
 */
export function getBranchName(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Returns the last `count` commit messages as one-line strings
 * (hash + subject), e.g. ["a1b2c3 feat(auth): add login"].
 * Gives the model a style reference for the project's existing commit conventions.
 * Returns an empty array if there are no commits yet or git fails.
 */
export function getRecentCommits(count = 5): string[] {
  try {
    const output = execSync(`git log --oneline -${count}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Executes the final commit as:
 *   git commit -m "<head>" -m "<body>"
 * (or just -m "<head>" when there's no body).
 *
 * Takes the already-parsed { head, body } rather than a flat string so the
 * two parts stay as separate -m arguments — that's what gives you a proper
 * subject/body split in `git log` instead of one squashed paragraph.
 * Uses execFileSync with an args array to bypass the shell entirely,
 * preventing any shell-injection via the commit message content.
 */
export function executeCommit(parsed: ParsedCommitMessage) {
  try {
    const args = buildGitCommitArgs(parsed);
    execFileSync("git", args, { stdio: "inherit" });
    return true;
  } catch {
    throw new Error("Failed to finalize Git commit object.");
  }
}
