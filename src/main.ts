import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as core from '@actions/core'
import { AWS_ENV, resolveRegion } from './aws.js'
import { validateRegion, writeTransferProfile, configFilePath } from './config.js'
import { CONFIG_DIR_ENV } from './constants.js'
import { getInputs, type Inputs } from './inputs.js'
import { install, smokeTest } from './installer.js'
import { resolveTarget } from './platform.js'
import { errorMessage } from './util.js'
import { validateCredentials } from './validate.js'

export async function run(): Promise<void> {
  try {
    const inputs = getInputs()
    const target = resolveTarget(process.platform, inputs.arch)

    const installed = await core.group(`Installing File Mover Express (${inputs.versionLabel})`, () =>
      install({
        spec: inputs.spec,
        target,
        token: inputs.token,
        checkLatest: inputs.checkLatest,
        allowPrerelease: inputs.allowPrerelease,
        verifySignature: inputs.verifySignature
      })
    )
    await smokeTest(installed.binPath, installed.version)
    core.addPath(path.dirname(installed.binPath))

    await mkdir(inputs.configDir, { recursive: true, mode: 0o700 })
    core.exportVariable(CONFIG_DIR_ENV, inputs.configDir)

    let transferProfile = ''
    if (inputs.bucket) {
      transferProfile = await configureTransferProfile(inputs)
    }

    if (inputs.validateCredentials) {
      await validateCredentials(installed.binPath, inputs.configDir, inputs.transferProfile, inputs.awsProfile)
    }

    registerProblemMatcher()

    core.setOutput('filemoverexpress-version', installed.version)
    core.setOutput('filemoverexpress-path', installed.binPath)
    core.setOutput('cache-hit', String(installed.cacheHit))
    core.setOutput('config-dir', inputs.configDir)
    core.setOutput('config-file', configFilePath(inputs.configDir))
    core.setOutput('transfer-profile', transferProfile)
    core.info(`File Mover Express ${installed.version} is ready at ${installed.binPath}`)
  } catch (error) {
    core.setFailed(errorMessage(error))
  }
}

async function configureTransferProfile(inputs: Inputs): Promise<string> {
  const resolved = resolveRegion(inputs.region, inputs.awsProfile)
  if (!resolved) {
    throw new Error(
      'No AWS region found for the transfer profile. Set the region input, or run aws-actions/configure-aws-credentials (which exports AWS_REGION) before this action.'
    )
  }
  const region = validateRegion(resolved.region)
  core.info(`Using region ${region} (from ${resolved.source})`)

  const file = await writeTransferProfile(inputs.configDir, {
    name: inputs.transferProfile,
    bucket: inputs.bucket,
    region,
    awsProfile: inputs.awsProfile,
    endpoint: inputs.endpoint,
    storageClass: inputs.storageClass,
    checksumAlgorithm: inputs.checksumAlgorithm,
    accelerate: inputs.accelerate
  })
  core.info(`Wrote transfer profile '${inputs.transferProfile}' (s3://${inputs.bucket}) to ${file}`)

  // Mirror configure-aws-credentials, which exports both names, but never override existing values.
  if (!process.env[AWS_ENV.region] && !process.env[AWS_ENV.defaultRegion]) {
    core.exportVariable(AWS_ENV.region, region)
    core.exportVariable(AWS_ENV.defaultRegion, region)
  }
  return inputs.transferProfile
}

export function problemMatcherPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.github', 'filemoverexpress-matcher.json')
}

function registerProblemMatcher(): void {
  core.info(`::add-matcher::${problemMatcherPath()}`)
}
