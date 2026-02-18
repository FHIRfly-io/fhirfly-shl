// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Lightweight test runner with colored terminal output.
 *
 * Provides section(), test(), skip(), info(), and summary() for
 * structured CLI output without any testing framework dependency.
 */

// ANSI colors
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

export interface TestResult {
  name: string;
  status: "pass" | "fail" | "skip";
  durationMs: number;
  error?: string;
}

export class Runner {
  private results: TestResult[] = [];
  private startTime = 0;
  private currentSection = "";
  private verbose = false;

  constructor(options?: { verbose?: boolean }) {
    this.verbose = options?.verbose ?? false;
  }

  /** Print the exercise header. */
  header(apiBaseUrl: string): void {
    console.log(`\n${BOLD}=== FHIRfly SHL SDK — Live Exercise ===${RESET}`);
    console.log(`${DIM}API: ${apiBaseUrl}${RESET}\n`);
    this.startTime = Date.now();
  }

  /** Start a new test section. */
  section(name: string): void {
    this.currentSection = name;
    console.log(`\n${BOLD}${CYAN}--- ${name} ---${RESET}`);
  }

  /**
   * Run a single test. Catches errors so execution never halts.
   * Returns true if the test passed.
   */
  async test(name: string, fn: () => Promise<void>): Promise<boolean> {
    const start = Date.now();
    try {
      await fn();
      const duration = Date.now() - start;
      this.results.push({ name, status: "pass", durationMs: duration });
      console.log(
        `  ${GREEN}[PASS]${RESET}  ${name}  ${DIM}${duration}ms${RESET}`,
      );
      return true;
    } catch (err) {
      const duration = Date.now() - start;
      const message =
        err instanceof Error ? err.message : String(err);
      this.results.push({
        name,
        status: "fail",
        durationMs: duration,
        error: message,
      });
      console.log(
        `  ${RED}[FAIL]${RESET}  ${name}  ${DIM}${duration}ms${RESET}`,
      );
      console.log(`          ${RED}Error: ${message}${RESET}`);
      if (this.verbose && err instanceof Error && err.stack) {
        console.log(`          ${DIM}${err.stack.split("\n").slice(1, 4).join("\n          ")}${RESET}`);
      }
      return false;
    }
  }

  /** Record a skipped test. */
  skip(name: string, reason: string): void {
    this.results.push({ name, status: "skip", durationMs: 0 });
    console.log(
      `  ${YELLOW}[SKIP]${RESET}  ${name}  ${DIM}— ${reason}${RESET}`,
    );
  }

  /** Print informational output (only in verbose mode, or always if force=true). */
  info(msg: string, force = false): void {
    if (this.verbose || force) {
      console.log(`  ${DIM}${msg}${RESET}`);
    }
  }

  /** Print the final summary and return the exit code. */
  summary(): number {
    const totalTime = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const passed = this.results.filter((r) => r.status === "pass").length;
    const failed = this.results.filter((r) => r.status === "fail").length;
    const skipped = this.results.filter((r) => r.status === "skip").length;
    const total = passed + failed;

    console.log(`\n${BOLD}=== Summary ===${RESET}`);

    const passColor = failed === 0 ? GREEN : "";
    const failColor = failed > 0 ? RED : "";

    console.log(
      `  ${passColor}Passed: ${passed}/${total}${RESET}  |  ` +
        `${failColor}Failed: ${failed}${RESET}  |  ` +
        `${YELLOW}Skipped: ${skipped}${RESET}  |  ` +
        `${DIM}Time: ${totalTime}s${RESET}`,
    );

    if (failed > 0) {
      console.log(`\n${RED}${BOLD}Failed tests:${RESET}`);
      for (const r of this.results.filter((r) => r.status === "fail")) {
        console.log(`  ${RED}• ${r.name}${RESET}`);
        if (r.error) {
          console.log(`    ${DIM}${r.error}${RESET}`);
        }
      }
    }

    console.log("");
    return failed > 0 ? 1 : 0;
  }

  /** Get count of passed tests. */
  get passCount(): number {
    return this.results.filter((r) => r.status === "pass").length;
  }

  /** Get count of failed tests. */
  get failCount(): number {
    return this.results.filter((r) => r.status === "fail").length;
  }
}
