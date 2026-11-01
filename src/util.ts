import { tmpdir } from 'node:os'

/** RUNNER_TEMP is wiped by the runner for every job; fall back to the OS temp dir off-runner. */
export function tempRoot(): string {
  return process.env['RUNNER_TEMP'] || tmpdir()
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
