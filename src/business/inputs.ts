import * as path from 'node:path'
import {
  parseChecksumAlgorithm,
  parseStorageClass,
  validateAwsProfile,
  validateBucket,
  validateEndpoint,
  validateProfileName
} from './config.js'
import { DEFAULT_TRANSFER_PROFILE, type ChecksumAlgorithm, type StorageClass } from '../constants.js'
import { normalizeArch, type Arch } from '../platform.js'
import { parseVersionFile, parseVersionSpec, type VersionSpec } from '../version.js'

export interface ParsedInputs {
  versionLabel: string
  architecture: string
  checkLatest: boolean
  allowPrerelease: boolean
  token: string
  verifySignature: boolean
  configDir: string
  transferProfile: string
  bucket: string
  region: string
  awsProfile: string
  endpoint: string
  storageClass: string
  checksumAlgorithm: string
  accelerate: boolean
  validateCredentials: boolean
}

export interface Inputs {
  spec: VersionSpec
  versionLabel: string
  arch: Arch
  checkLatest: boolean
  allowPrerelease: boolean
  token: string
  verifySignature: boolean
  configDir: string
  transferProfile: string
  bucket: string
  region: string
  awsProfile: string
  endpoint: string
  storageClass: StorageClass
  checksumAlgorithm: ChecksumAlgorithm
  accelerate: boolean
  validateCredentials: boolean
}

export interface InputRuntime {
  processArch: string
  configDirDefault: string
}

/** Validates and normalizes raw action input values; callers supply runtime-specific defaults. */
export function parseInputs(values: ParsedInputs, runtime: InputRuntime): Inputs {
  const bucket = values.bucket.trim()
  const transferProfile = values.transferProfile.trim() || DEFAULT_TRANSFER_PROFILE
  return {
    spec: parseVersionSpec(values.versionLabel),
    versionLabel: values.versionLabel,
    arch: normalizeArch(values.architecture.trim() || runtime.processArch),
    checkLatest: values.checkLatest,
    allowPrerelease: values.allowPrerelease,
    token: values.token.trim(),
    verifySignature: values.verifySignature,
    configDir: path.resolve(values.configDir.trim() || runtime.configDirDefault),
    transferProfile: validateProfileName(transferProfile),
    bucket: bucket ? validateBucket(bucket) : '',
    region: values.region.trim(),
    awsProfile: validateAwsProfile(values.awsProfile.trim()),
    endpoint: validateEndpoint(values.endpoint.trim()),
    storageClass: parseStorageClass(values.storageClass.trim() || 'standard'),
    checksumAlgorithm: parseChecksumAlgorithm(values.checksumAlgorithm.trim() || 'none'),
    accelerate: values.accelerate,
    validateCredentials: values.validateCredentials
  }
}

/** Resolves version input precedence when an optional version-file has already been read. */
export function chooseVersionInput(versionInput: string, versionFile: string, fileContent?: string): string {
  if (versionInput) {
    return versionInput
  }
  if (versionFile && fileContent !== undefined) {
    return parseVersionFile(fileContent, versionFile)
  }
  if (versionFile) {
    throw new Error(`filemoverexpress-version-file '${versionFile}' doesn't exist.`)
  }
  return 'latest'
}
