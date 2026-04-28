import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SourceRepo } from "../config.ts";

const exec = promisify(execFile);

export type FetchResult = {
  repo: SourceRepo;
  ref: string;
  sha: string;
};

// Disable Git LFS for these clones — we only consume source files, and
// requiring `git-lfs` to be installed locally is needless friction.
// `GIT_LFS_SKIP_SMUDGE=1` alone isn't enough when git-lfs is registered as a
// `filter.lfs.process` in the user's global config (the process filter runs
// unconditionally), so we override the filter via `-c` flags too.
const NO_LFS_FLAGS = [
  "-c",
  "filter.lfs.required=false",
  "-c",
  "filter.lfs.smudge=cat",
  "-c",
  "filter.lfs.clean=cat",
  "-c",
  "filter.lfs.process=",
];

const ENV = { ...process.env, GIT_LFS_SKIP_SMUDGE: "1" };

export async function cloneOrPull(repo: SourceRepo, ref: string): Promise<FetchResult> {
  await fs.mkdir(path.dirname(repo.cacheDir), { recursive: true });

  const exists = await fs
    .stat(path.join(repo.cacheDir, ".git"))
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    await git(undefined, [...NO_LFS_FLAGS, "clone", "--depth", "50", repo.url, repo.cacheDir]);
  }

  await git(repo.cacheDir, ["fetch", "origin", ref]);
  await git(repo.cacheDir, ["checkout", ref]);
  // Fast-forward when on a branch; harmless on detached HEADs.
  try {
    await git(repo.cacheDir, ["pull", "origin", ref, "--ff-only"]);
  } catch {
    // detached HEAD or non-branch ref — ignore
  }
  const { stdout } = await git(repo.cacheDir, ["rev-parse", "HEAD"]);
  return { repo, ref, sha: stdout.trim() };
}

async function git(cwd: string | undefined, args: string[]): Promise<{ stdout: string; stderr: string }> {
  // Always front-load the LFS-disabling flags so even ops on the local clone
  // (checkout, pull) skip LFS smudging.
  const allArgs = args[0] === "clone" ? args : [...NO_LFS_FLAGS, ...args];
  const { stdout, stderr } = await exec("git", allArgs, { cwd, env: ENV, maxBuffer: 32 * 1024 * 1024 });
  return { stdout, stderr };
}
