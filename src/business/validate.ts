import { hasCredentialHints } from './aws.js'

/** Strips ANSI escape sequences in case the CLI colorizes its log output. */
export function stripAnsi(text: string): string {
  // oxlint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

export function credentialsValidated(output: string, profile: string): boolean {
  const escaped = profile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`Validated credentials for ${escaped}\\s*$`, 'm').test(stripAnsi(output))
}

export function failureDetail(output: string): string {
  const lines = stripAnsi(output)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^(WARNING|ERROR|FATAL)/.test(line))
  return lines.length > 0 ? lines.join('\n') : stripAnsi(output).trim()
}

export interface CredentialValidationOutput {
  stdout: string
  stderr: string
  exitCode: number
}

/** Interprets the CLI result, including warning-only failures that still return exit code zero. */
export function credentialValidationError(
  output: CredentialValidationOutput,
  profile: string,
  awsProfileInput: string,
  env: NodeJS.ProcessEnv
): string | undefined {
  const combined = `${output.stdout}\n${output.stderr}`
  if (output.exitCode === 0 && credentialsValidated(combined, profile)) {
    return undefined
  }
  let message = `File Mover Express couldn't validate credentials for transfer profile '${profile}':\n${failureDetail(combined)}`
  if (!hasCredentialHints(awsProfileInput, env)) {
    message +=
      '\nNo AWS credentials were found in the environment. Run aws-actions/configure-aws-credentials before this action, or set aws-profile.'
  }
  return message
}
