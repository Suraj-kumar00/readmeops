/**
 * End-to-end test of the BUNDLED action (dist/index.mjs): renders the demo profile
 * and publishes it to a local bare repository, exactly as on a runner.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));

function sh(cwd: string, cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function env(root: string, remote: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "ada-ops/ada-ops",
    GITHUB_REPOSITORY_OWNER: "ada-ops",
    GITHUB_OUTPUT: join(root, "outputs.txt"),
    GITHUB_STEP_SUMMARY: join(root, "summary.md"),
    READMEOPS_REMOTE: remote,
    READMEOPS_DEMO: "1",
    INPUT_LOOK: "terminal",
    INPUT_CARDS: "profile, stats, upstream",
    INPUT_TOKEN: "",
    "INPUT_DRY-RUN": "false",
    ...extra,
  };
}

describe("bundled action", () => {
  it("publishes the cards to the readmeops branch; an unchanged second run pushes nothing", () => {
    const root = mkdtempSync(join(tmpdir(), "readmeops-action-"));
    const remote = join(root, "remote.git");
    sh(root, "git", ["init", "--quiet", "--bare", "-b", "main", remote]);
    writeFileSync(join(root, "outputs.txt"), "");
    writeFileSync(join(root, "summary.md"), "");

    execFileSync(process.execPath, [DIST], { cwd: root, env: env(root, remote), encoding: "utf8" });
    const files = sh(remote, "git", ["ls-tree", "--name-only", "readmeops"]).trim().split("\n").sort();
    assert.deepEqual(files, ["README.md", "profile-dark.svg", "profile-light.svg", "stats-dark.svg", "stats-light.svg", "upstream-dark.svg", "upstream-light.svg"]);
    assert.equal(sh(remote, "git", ["rev-list", "--count", "readmeops"]).trim(), "1");
    const author = sh(remote, "git", ["log", "-1", "--format=%an <%ae>", "readmeops"]).trim();
    assert.equal(author, "github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>");
    assert.match(readFileSync(join(root, "outputs.txt"), "utf8"), /changed<<\S+\ntrue/);
    const summary = readFileSync(join(root, "summary.md"), "utf8");
    assert.match(summary, /raw\.githubusercontent\.com\/ada-ops\/ada-ops\/readmeops\/profile-dark\.svg/);
    const head = sh(remote, "git", ["rev-parse", "readmeops"]).trim();

    writeFileSync(join(root, "outputs.txt"), "");
    execFileSync(process.execPath, [DIST], { cwd: root, env: env(root, remote), encoding: "utf8" });
    assert.equal(sh(remote, "git", ["rev-parse", "readmeops"]).trim(), head, "no push when nothing changed");
    assert.match(readFileSync(join(root, "outputs.txt"), "utf8"), /changed<<\S+\nfalse/);

    // A different look replaces the branch with a single new commit.
    execFileSync(process.execPath, [DIST], { cwd: root, env: env(root, remote, { INPUT_LOOK: "clean" }), encoding: "utf8" });
    assert.notEqual(sh(remote, "git", ["rev-parse", "readmeops"]).trim(), head);
    assert.equal(sh(remote, "git", ["rev-list", "--count", "readmeops"]).trim(), "1", "history never grows");
  });

  it("fails closed when private data is visible, without printing names", () => {
    const root = mkdtempSync(join(tmpdir(), "readmeops-action-"));
    let stdout = "";
    let code = 0;
    try {
      execFileSync(process.execPath, [DIST], { cwd: root, env: env(root, join(root, "none.git"), { READMEOPS_DEMO: "private" }), encoding: "utf8" });
    } catch (err) {
      const e = err as { status: number; stdout: string };
      code = e.status;
      stdout = e.stdout;
    }
    assert.equal(code, 1);
    assert.match(stdout, /::error::Public build refused/);
    assert.ok(!stdout.includes("client-platform"), "private repo names never reach public logs");
  });

  it("rejects unknown looks and cards with a clear message", () => {
    const root = mkdtempSync(join(tmpdir(), "readmeops-action-"));
    for (const [key, value, pattern] of [
      ["INPUT_LOOK", "neon", /Unknown look "neon"/],
      ["INPUT_CARDS", "stats, gists", /Unknown card "gists"/],
    ] as const) {
      let stdout = "";
      try {
        execFileSync(process.execPath, [DIST], { cwd: root, env: env(root, join(root, "none.git"), { [key]: value }), encoding: "utf8" });
      } catch (err) {
        stdout = (err as { stdout: string }).stdout;
      }
      assert.match(stdout, pattern);
    }
  });
});
