import * as core from '@actions/core'
import * as exec from '@actions/exec'
import { CONFIG_DIR_ENV } from './constants.js'
import { credentialValidationError } from './business/validate.js'

export { credentialsValidated, failureDetail, stripAnsi, credentialValidationError } from './business/validate.js'

/** Runs File Mover Express validation and interprets its output in business logic. */
export async function validateCredentials(
  binPath: string,
  configDir: string,
  profile: string,
  awsProfileInput: string
): Promise<void> {
  core.info(`Validating AWS credentials for transfer profile '${profile}'`)
  const output = await exec.getExecOutput(binPath, ['validate-credentials', profile], {
    env: { ...process.env, [CONFIG_DIR_ENV]: configDir },
    ignoreReturnCode: true,
    silent: true
  })
  const message = credentialValidationError(output, profile, awsProfileInput, process.env)
  if (message) {
    throw new Error(message)
  }
  core.info(`Validated credentials for '${profile}'`)
}
