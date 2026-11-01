import { tmpdir } from 'node:os'

/** RUNNER_TEMP is wiped by the runner for every job; fall back to the OS temp dir off-runner. */
export function tempRoot(): string {
  return process.env['RUNNER_TEMP'] || tmpdir()
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** @actions/exec parses its first argument as a command line, so a path containing spaces must be quoted. */
export function quoteExecutable(executable: string): string {
  return `"${executable}"`
}
