import { existsSync, readFileSync } from 'node:fs'
import * as path from 'node:path'
import * as core from '@actions/core'
import { chooseVersionInput, parseInputs, type Inputs, type ParsedInputs } from './business/inputs.js'
import { TOOL_NAME } from './constants.js'
import { tempRoot } from './util.js'

export type { Inputs } from './business/inputs.js'

function input(name: string): string {
  return core.getInput(name).trim()
}

function booleanInput(name: string, defaultValue: boolean): boolean {
  return input(name) === '' ? defaultValue : core.getBooleanInput(name)
}

export function resolveVersionInput(): string {
  const version = input('filemoverexpress-version')
  const versionFile = input('filemoverexpress-version-file')
  if (version) {
    if (versionFile) {
      core.warning(
        'Both filemoverexpress-version and filemoverexpress-version-file are set; using filemoverexpress-version.'
      )
    }
    return chooseVersionInput(version, versionFile)
  }
  if (versionFile) {
    const workspace = process.env['GITHUB_WORKSPACE'] || process.cwd()
    const file = path.resolve(workspace, versionFile)
    if (!existsSync(file)) {
      return chooseVersionInput('', versionFile)
    }
    const content = readFileSync(file, 'utf8')
    const fromFile = chooseVersionInput('', versionFile, content)
    core.info(`Read ${TOOL_NAME} version '${fromFile}' from ${versionFile}`)
    return fromFile
  }
  return chooseVersionInput('', '')
}

export function getInputs(): Inputs {
  const versionLabel = resolveVersionInput()
  const raw: ParsedInputs = {
    versionLabel,
    architecture: input('architecture'),
    checkLatest: booleanInput('check-latest', false),
    allowPrerelease: booleanInput('allow-prerelease', false),
    token: input('token'),
    verifySignature: booleanInput('verify-signature', true),
    configDir: input('config-dir'),
    transferProfile: input('transfer-profile'),
    bucket: input('bucket'),
    region: input('region'),
    awsProfile: input('aws-profile'),
    endpoint: input('endpoint'),
    storageClass: input('storage-class'),
    checksumAlgorithm: input('checksum-algorithm'),
    accelerate: booleanInput('accelerate', false),
    validateCredentials: booleanInput('validate-credentials', false)
  }
  return parseInputs(raw, {
    processArch: process.arch,
    configDirDefault: path.join(tempRoot(), TOOL_NAME)
  })
}
