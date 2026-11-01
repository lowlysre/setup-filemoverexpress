import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import { configFilePath } from './config.js'
import { CONFIG_DIR_ENV, CONFIG_FILE_NAME } from './constants.js'
import { quoteExecutable, tempRoot } from './util.js'
import { credentialValidationError } from './business/validate.js'
import { withInfoLogging } from './business/config.js'

export { credentialsValidated, failureDetail, stripAnsi, credentialValidationError } from './business/validate.js'

/**
 * Runs File Mover Express validation and interprets its output in business logic. Validation runs against a
 * throwaway copy of the configuration with INFO logging, because the CLI prints its success line at INFO and
 * a `warn` or `error` severity would hide it. The real configuration is left untouched.
 */
export async function validateCredentials(
  binPath: string,
  configDir: string,
  profile: string,
  awsProfileInput: string
): Promise<void> {
  core.info(`Validating AWS credentials for transfer profile '${profile}'`)
  const isolatedDir = await mkdtemp(path.join(tempRoot(), 'fme-validate-'))
  try {
    const file = configFilePath(configDir)
    const existing = existsSync(file) ? await readFile(file, 'utf8') : ''
    await writeFile(path.join(isolatedDir, CONFIG_FILE_NAME), withInfoLogging(existing), { mode: 0o600 })
    const output = await exec.getExecOutput(quoteExecutable(binPath), ['validate-credentials', profile], {
      env: { ...process.env, [CONFIG_DIR_ENV]: isolatedDir },
      ignoreReturnCode: true,
      silent: true
    })
    const message = credentialValidationError(output, profile, awsProfileInput, process.env)
    if (message) {
      throw new Error(message)
    }
  } finally {
    await rm(isolatedDir, { recursive: true, force: true }).catch(() => undefined)
  }
  core.info(`Validated credentials for '${profile}'`)
}
