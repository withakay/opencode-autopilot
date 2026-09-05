import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtendedState } from "../types/index.ts";
import { recordVerification } from "./checkpoints.ts";

const VERIFY_TIMEOUT_MS = 120_000;
const execFileAsync = promisify(execFile);

export type VerificationResult =
  | { status: "passed" }
  | { status: "failed"; message: string }
  | { status: "blocked"; message: string };

export function tokenizeCommand(input: string): string[] | undefined {
  const result: string[] = [];
  const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match = regex.exec(input);
  while (match) {
    const token = (match[1] ?? match[2] ?? match[3] ?? "").replace(/\\(["'])/g, "$1");
    if (/[`$|&;<>]/.test(token)) return undefined;
    result.push(token);
    match = regex.exec(input);
  }
  return result.length > 0 ? result : undefined;
}

export async function runVerification(
  state: ExtendedState,
  permissionMode: "allow-all" | "limited" | undefined,
  cwd: string,
): Promise<VerificationResult> {
  const command = state.verify_with?.trim();
  if (!command) {
    recordVerification(state, {
      status: "passed",
      summary: "No verification command configured.",
    });
    return { status: "passed" };
  }

  if (permissionMode !== "allow-all") {
    const message = `Verification command requires allow-all permission mode: ${command}`;
    recordVerification(state, { command, status: "blocked", summary: message });
    return { status: "blocked", message };
  }

  const tokens = tokenizeCommand(command);
  if (!tokens) {
    const message = `Verification command must be a simple command with arguments, not shell syntax: ${command}`;
    recordVerification(state, { command, status: "blocked", summary: message });
    return { status: "blocked", message };
  }

  const [file, ...args] = tokens;
  if (!file) {
    recordVerification(state, {
      command,
      status: "blocked",
      summary: "Verification command is empty.",
    });
    return { status: "blocked", message: "Verification command is empty." };
  }

  try {
    await execFileAsync(file, args, {
      cwd,
      timeout: VERIFY_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    recordVerification(state, {
      command,
      status: "passed",
      summary: `Verification command passed: ${command}`,
    });
    return { status: "passed" };
  } catch (error) {
    const err = error as {
      stderr?: string;
      stdout?: string;
      message?: string;
    };
    const output = (
      err.stderr ||
      err.stdout ||
      err.message ||
      "verification command failed"
    ).trim();
    const firstLine = output.split(/\r?\n/).find(Boolean) ?? output;
    const message = `Verification command failed (${command}): ${firstLine}`;
    recordVerification(state, { command, status: "failed", summary: message });
    return { status: "failed", message };
  }
}
