# 🤖 smart-commit

> AI-powered git commit message generator — runs **entirely on your machine**, no API keys, no cloud calls.

`smart-commit` analyses your staged diff and uses a locally-hosted LLM ([Qwen2.5-Coder-1.5B](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF)) to generate a [Conventional Commits](https://www.conventionalcommits.org/)-formatted message with an optional bullet-point body. You review it, approve or override it, and the commit is made — all in one command.

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [How It Works](#how-it-works)
- [Model Storage](#model-storage)
- [Configuration](#configuration)
- [Customising the Prompt](#customising-the-prompt)
- [Project Structure](#project-structure)
- [Development](#development)
- [Testing](#testing)
- [Building](#building)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- 🔒 **Fully local** — inference runs on-device via [node-llama-cpp](https://github.com/withcatai/node-llama-cpp). No data ever leaves your machine.
- ⚡ **Zero config** — model is downloaded automatically on first run.
- ✅ **Conventional Commits** — output is validated against the spec before being offered to you.
- 📝 **Head + body** — the model produces a structured subject line *and* optional bullet-point body; git receives them as separate `-m` arguments for a clean `git log`.
- 🛡️ **Shell-injection safe** — all git operations use `execFileSync` with argument arrays, never string interpolation.
- 🧵 **Isolated inference** — the LLM runs in a forked child process, keeping the main process lightweight and responsive to Ctrl+C.
- 🔁 **Degenerate-loop protection** — the response parser caps body bullets at 8 and stops the instant a line repeats. An explicit `<|im_end|>` stop trigger and a mild repeat penalty (`1.15`) further suppress repetition loops at the sampling level.
- 🔬 **Small-diff body suppression** — diffs with ≤ 8 changed lines never get a generated body, preventing hallucinated bullets on trivial changes. Configurable via `SMART_COMMIT_SMALL_DIFF_THRESHOLD`.
- 🔧 **Customisable** — tweak the system prompt, few-shot examples, and inference parameters in a single file.

---

## Requirements

| Requirement | Version |
|---|---|
| Node.js | **≥ 18.0** (native `fetch`, `parseArgs`, ESM) |
| Git | any modern version |
| Disk space | ~1.1 GB (model file, downloaded once) |
| RAM | ~2 GB free during inference |

> **Note:** GPU is not required. Inference runs on CPU. On a modern laptop it typically completes in 10–60 seconds depending on diff size and hardware.

---

## Installation

### Global install (recommended)

```bash
npm install -g smart-commit
# or
pnpm add -g smart-commit
```

After install, the `smart-commit` binary is available system-wide.

### From source

```bash
git clone https://github.com/your-username/smart-commit.git
cd smart-commit
pnpm install
pnpm run build
npm install -g .
```

---

## Usage

```bash
# Stage your changes first
git add src/auth/login.ts

# Run the tool
smart-commit
```

### What happens

```
========================================
           🤖 AI COMMIT CLI
========================================

🧠 Spawning isolated child process and running local AI inference...

👉 Suggested Message:
feat(auth): add loginUser function with credential validation
  - Validates email and password against db
  - Compares password hash using bcrypt
  - Returns JWT token on success

Do you want to use this commit message? (Y/n):
```

- Press **Enter** or type **Y** → commits immediately with the suggested message.
- Type **n** → you are prompted to enter a custom commit head and optional bullet-point body.
- Leave the custom head **empty** and press Enter → commit is cancelled with no changes made.

### Options

```
smart-commit --help      Show help documentation
smart-commit --version   Show the installed version
```

### First run

On first run, `smart-commit` will download the ~1.1 GB model file from Hugging Face. Progress is shown inline:

```
📥 First run detected! Downloading local AI engine...
Downloading: 42.3% completed...
✅ Engine downloaded successfully and initialized!
```

Subsequent runs skip the download entirely and go straight to inference.

---

## How It Works

```
git add ...
    │
    ▼
smart-commit (main process)
    │  1. Verify git repo & staged changes
    │  2. Read staged diff (filtered — no lock files, dist, node_modules)
    │  3. Collect branch name + last 5 commit one-liners as style context
    │  4. Guard: reject diff > 500 KB (too large for meaningful AI analysis)
    │  5. Fork isolated child process
    │
    ├──► AI Worker (child process)
    │       │  6. Download model if missing
    │       │  7. Load model via node-llama-cpp (CPU, gpuLayers: 0)
    │       │  8. Build system prompt + few-shot examples
    │       │  9. Run inference (maxTokens: 200, temperature: 0.2,
    │       │     repeatPenalty: 1.15/64 tokens, stop on <|im_end|>)
    │       │ 10. Parse response → { head, body } via BODY_SENTINEL split
    │       │     • Strips accidental code fences
    │       │     • Caps body at 8 bullets; stops on first repeated bullet
    │       │ 11. Validate head against Conventional Commits regex
    │       │ 12. Count changed diff lines; suppress body if ≤ threshold (8)
    │       └──► IPC: send { type: "success", head, body }
    │
    │ 13. Display suggested message (head + indented body bullets)
    │ 14. Prompt: confirm or override
    │     • Override: collect custom head + body bullets interactively
    │ 15. git commit -m "<head>" [-m "<body>"]
    ▼
Done ✓
```

### Context signals

The model receives three signals to produce more accurate, project-aware messages:

| Signal | Source | Purpose |
|---|---|---|
| `diff` | `git diff --cached` | The actual code changes to describe |
| `branch` | `git rev-parse --abbrev-ref HEAD` | Infer commit type and scope (e.g. `feature/user-auth` → `feat`, scope `auth`) |
| `recentCommits` | `git log --oneline -5` | Match the project's existing scope naming and style |

### Diff filtering

The staged diff automatically excludes noise that would waste the model's context window:

| Excluded | Reason |
|---|---|
| `pnpm-lock.yaml` / `package-lock.json` / `yarn.lock` | Lock files carry no semantic intent |
| `dist/*` | Build artefacts — not authored code |
| `**/node_modules/**` | Third-party code |
| `models/*` | Binary model files |

The diff is also truncated to 10,000 characters inside the prompt builder before being sent to the model, and the full IPC payload is capped at 500 KB before the worker is even spawned.

### Output format

The model is instructed to emit a structured response split by a sentinel line:

```
feat(auth): add loginUser function with credential validation
===BODY===
- Validates email and password against db
- Compares password hash using bcrypt
- Returns JWT token on success
```

The parser (`lib/commit-message.ts`) splits on `===BODY===`, trims both halves, and normalises bullet formatting. `git commit` then receives the head and body as separate `-m` arguments, producing a proper subject/body split in `git log`.

### Body suppression for small diffs

After parsing, the worker counts the number of `+`/`-` lines in the raw diff using `countChangedDiffLines`. If the result is at or below the threshold (default: **8**), the body is discarded and only the head is committed. This prevents the model from padding out a body with hallucinated bullets on trivial one-liner changes — a deterministic safeguard that no prompt instruction alone can provide.

### Output validation

The head line is validated against the Conventional Commits regex before the result is accepted. If it doesn't match, the worker surfaces an error and you are invited to enter a manual message instead.

---

## Model Storage

The model file is stored in a standard OS location — **not** inside the package directory — so it persists correctly across version upgrades and global installs.

| Platform | Default Path |
|---|---|
| Linux (XDG) | `$XDG_DATA_HOME/smart-commit/models/` |
| Linux (fallback) | `~/.local/share/smart-commit/models/` |
| macOS / Windows | `~/.local/share/smart-commit/models/` |

To use a custom location, set `XDG_DATA_HOME` before running:

```bash
XDG_DATA_HOME=/mnt/fast-ssd/.local/share smart-commit
```

---

## Configuration

All configuration is done via environment variables. No config file is required.

| Variable | Default | Description |
|---|---|---|
| `SMART_COMMIT_TIMEOUT_MS` | `0` (disabled) | Inference timeout in milliseconds. Set to a positive number (e.g. `120000`) to limit how long the worker may run. `0` means no timeout. |
| `SMART_COMMIT_SMALL_DIFF_THRESHOLD` | `8` | Changed-line count at or below which the generated body is suppressed. Set to `0` to always include a body, or higher to widen the suppression window. |
| `XDG_DATA_HOME` | *(unset)* | Override the base directory used for model storage. |

### Examples

```bash
# Give the model 2 minutes on a slow machine
SMART_COMMIT_TIMEOUT_MS=120000 smart-commit

# Always generate a body, even for single-line diffs
SMART_COMMIT_SMALL_DIFF_THRESHOLD=0 smart-commit

# Suppress body for diffs with 20 or fewer changed lines
SMART_COMMIT_SMALL_DIFF_THRESHOLD=20 smart-commit

# Store model on a different drive
XDG_DATA_HOME=/mnt/data/.local/share smart-commit
```

---

## Customising the Prompt

All AI behaviour is controlled in a single file: [`src/prompts/commit.ts`](./src/prompts/commit.ts).

### Tuning the system instruction

Edit `SYSTEM_INSTRUCTION` to change the model's persona or output requirements.

### Adding few-shot examples

Add entries to the `EXAMPLES` array to teach the model patterns specific to your codebase. Each entry is a `{ branch, recentCommits, diff, head, bodyBullets }` tuple shown to the model verbatim:

```ts
const EXAMPLES = [
  // ...existing examples...
  {
    branch: "feat/s3-assets",
    recentCommits: ["a1b2c3d chore(infra): add base Terraform layout"],
    diff: `diff --git a/infra/terraform/main.tf b/infra/terraform/main.tf
+resource "aws_s3_bucket" "assets" {}`,
    head: "feat(infra): add S3 assets bucket to Terraform config",
    bodyBullets: [],
  },
];
```

More examples = more consistent output for your specific project structure.

### Tweaking inference parameters

In [`src/workers/ai-worker.ts`](./src/workers/ai-worker.ts), the inference call accepts standard llama.cpp parameters:

```ts
const rawResponse = await session.prompt(getUserPrompt(diff, branch, recentCommits), {
  maxTokens: 200,         // Max output length — includes head + sentinel + body bullets
  temperature: 0.2,       // Lower = more deterministic. Range: 0.0–1.0
  customStopTriggers: ["<|im_end|>"],  // Qwen's real turn-end token; prevents run-to-maxTokens loops
  repeatPenalty: {
    penalty: 1.15,        // Mild penalty to break exact-line repetition without forcing hallucination
    lastTokens: 64,
  },
});
```

After editing any source file, rebuild with `pnpm run build`.

---

## Project Structure

```
smart-commit/
├── src/
│   ├── index.ts                 # CLI entry point — arg parsing, top-level error handler
│   ├── commands/
│   │   └── commit.ts            # Main command orchestration — git checks, user prompts, commit
│   ├── lib/
│   │   ├── ai.ts                # Forks the AI worker, manages IPC, spinner, and timeout
│   │   ├── commit-message.ts    # parseCommitMessage, countChangedDiffLines, buildGitCommitArgs
│   │   ├── git.ts               # Git utilities — repo check, staged diff, commit execution
│   │   └── git.test.ts          # Unit tests for git utilities (vitest)
│   ├── prompts/
│   │   ├── commit.ts            # System prompt, few-shot examples, BODY_SENTINEL, CC_REGEX
│   │   └── commit.test.ts       # Unit tests for prompt builder and CC_REGEX (vitest)
│   ├── types/
│   │   └── index.ts             # WorkerMessage + WorkerInput discriminated unions (IPC contract)
│   └── workers/
│       └── ai-worker.ts         # Child process — model download, LLM inference, response parsing
├── models/                      # (gitignored) local dev model location
├── dist/                        # (gitignored) compiled output
├── package.json
└── tsconfig.json
```

---

## Development

```bash
# Clone and install dependencies
git clone https://github.com/your-username/smart-commit.git
cd smart-commit
pnpm install

# Build (compiles TypeScript to dist/)
pnpm run build

# Run directly from dist after building
node dist/index.js
```

> **Tip:** The tool must be run from inside a git repository with staged changes, or it will exit with a clear error message.

---

## Testing

Tests are written with [vitest](https://vitest.dev/) and use fully hermetic mocks — no real git processes or LLM inference is performed during test runs.

```bash
# Run tests once
pnpm run test

# Run tests in watch mode
pnpm run test:watch
```

### Test coverage areas

| Test file | What's tested |
|---|---|
| `src/lib/git.test.ts` | `isGitRepository`, `hasStagedChanges`, `getStagedDiff`, `executeCommit` — all branches including error paths and head/body arg construction |
| `src/prompts/commit.test.ts` | `CC_REGEX` valid/invalid messages, `getUserPrompt` diff truncation and context injection, `getSystemPrompt` structure and rule content |

---

## Building

```bash
pnpm run build
```

This compiles `src/` to `dist/` using the TypeScript compiler (`tsc`). The `build` step is also run automatically before `pnpm publish` via the `prepublishOnly` hook.

**TypeScript settings of note** (see [`tsconfig.json`](./tsconfig.json)):

- `"module": "nodenext"` + `"moduleResolution": "NodeNext"` — native Node ESM handling
- `"strict": true`, `"noUncheckedIndexedAccess": true` — maximum type safety
- `"verbatimModuleSyntax": true` — ensures `import type` is used correctly

---

## Troubleshooting

### `❌ Error: You are not inside a valid Git repository directory.`
Run `smart-commit` from within a directory that has been initialised with `git init`.

### `❌ No staged changes found. Run 'git add' on your files first.`
You need to stage files before running the tool:
```bash
git add <file>   # or: git add .
```

### `❌ Staged diff is too large (...KB) for AI analysis.`
The staged diff exceeds the 500 KB IPC limit. Stage fewer files at once, or unstage large binary or generated files:
```bash
git restore --staged <large-file>
```

### `❌ AI Generation failed: AI inference timed out after Xs`
The timeout is disabled by default (`SMART_COMMIT_TIMEOUT_MS=0`). If you have enabled it and the model is too slow, increase it:
```bash
SMART_COMMIT_TIMEOUT_MS=300000 smart-commit
```

### `❌ AI Generation failed: Model produced an invalid commit message format`
The model generated a head line that doesn't match Conventional Commits format. This is rare but can happen on very large or unusual diffs. When this occurs you will be invited to enter a commit message manually.

### The generated message has no body even though the diff is substantial
The small-diff body suppression threshold may be set too high. Lower or disable it:
```bash
SMART_COMMIT_SMALL_DIFF_THRESHOLD=0 smart-commit
```

### The model keeps re-downloading
This usually means the model path is resolving differently between runs (e.g. `XDG_DATA_HOME` is set inconsistently). Verify the `.gguf` file exists at the expected path:

```bash
ls ~/.local/share/smart-commit/models/
```

### `[node-llama-cpp] load: control-looking token ... was not control-type`
This is a harmless warning emitted by the underlying C++ library because Qwen's EOS token (`</s>`) is not registered as a control token in its GGUF metadata. The tool works around this by registering `<|im_end|>` as an explicit stop trigger, so generation still halts cleanly at end-of-turn. The warning can be safely ignored.

---

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository and create a feature branch.
2. **Install** dependencies: `pnpm install`
3. **Make changes** — keep them focused and well-commented.
4. **Add/update tests** in `src/lib/*.test.ts` or `src/prompts/*.test.ts`.
5. **Verify** the build and tests pass:
   ```bash
   pnpm run build && pnpm run test
   ```
6. Open a **Pull Request** with a clear description of what changed and why.

### Good places to contribute

- 🎛️ Add a `--dry-run` flag that prints the suggested message without prompting
- 🔁 Add a `--regenerate` flag to ask the model for a second opinion
- 🌐 Add explicit macOS/Windows model storage paths
- 🧪 Add unit tests for `lib/commit-message.ts` (parsing edge cases, `countChangedDiffLines`)

---

## License

ISC — see [LICENSE](./LICENSE) for details.
