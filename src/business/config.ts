import { isMap, parseDocument } from 'yaml'
import {
  CHECKSUM_ALGORITHMS,
  CONFIG_FILE_NAME,
  STORAGE_CLASSES,
  type ChecksumAlgorithm,
  type StorageClass
} from '../constants.js'

export interface TransferProfileOptions {
  name: string
  bucket: string
  region: string
  awsProfile: string
  endpoint: string
  storageClass: StorageClass
  checksumAlgorithm: ChecksumAlgorithm
  accelerate: boolean
}

const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
const REGION = /^[a-z0-9][a-z0-9-]{0,49}$/
const AWS_PROFILE = /^[^\s[\]/\\]+$/

export function validateProfileName(name: string): string {
  if (!PROFILE_NAME.test(name)) {
    throw new Error(
      `Invalid transfer-profile '${name}'. Use 1-64 letters, digits, '.', '_' or '-', starting with a letter or digit.`
    )
  }
  return name
}

export function validateBucket(bucket: string): string {
  if (!BUCKET_NAME.test(bucket) || bucket.includes('..') || /^\d+\.\d+\.\d+\.\d+$/.test(bucket)) {
    throw new Error(`Invalid bucket '${bucket}'. Pass the bucket name only (no s3:// prefix or key path).`)
  }
  return bucket
}

export function validateRegion(region: string): string {
  if (!REGION.test(region)) {
    throw new Error(`Invalid region '${region}', expected a region code such as us-east-1.`)
  }
  return region
}

export function validateAwsProfile(profile: string): string {
  if (profile && !AWS_PROFILE.test(profile)) {
    throw new Error(`Invalid aws-profile '${profile}'. It can't contain whitespace, square brackets, or slashes.`)
  }
  return profile
}

export function validateEndpoint(endpoint: string): string {
  if (!endpoint) {
    return endpoint
  }
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error(`Invalid endpoint '${endpoint}', expected an http(s) URL.`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Invalid endpoint '${endpoint}', expected an http(s) URL.`)
  }
  if (url.username || url.password) {
    throw new Error('The endpoint input must not contain credentials.')
  }
  return endpoint
}

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return values.some(candidate => candidate === value)
}

export function parseChecksumAlgorithm(value: string): ChecksumAlgorithm {
  const normalized = value.trim().toLowerCase()
  if (!isOneOf(CHECKSUM_ALGORITHMS, normalized)) {
    throw new Error(`Invalid checksum-algorithm '${value}'. Supported: ${CHECKSUM_ALGORITHMS.join(', ')}.`)
  }
  return normalized
}

export function parseStorageClass(value: string): StorageClass {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  if (!isOneOf(STORAGE_CLASSES, normalized)) {
    throw new Error(`Invalid storage-class '${value}'. Supported: ${STORAGE_CLASSES.join(', ')}.`)
  }
  return normalized
}

export function buildTransferProfile(options: TransferProfileOptions): Record<string, unknown> {
  if (options.accelerate && options.endpoint) {
    throw new Error('accelerate and endpoint are mutually exclusive: Transfer Acceleration only works with Amazon S3.')
  }
  if (options.accelerate && options.bucket.includes('.')) {
    throw new Error(`Transfer Acceleration can't be used with bucket '${options.bucket}': the name contains a dot.`)
  }
  const profile: Record<string, unknown> = {
    bucket: options.bucket,
    region: options.region,
    storageClass: options.storageClass,
    accelerated: options.accelerate,
    checksums: {
      enabled: options.checksumAlgorithm !== 'none',
      algorithm: options.checksumAlgorithm
    }
  }
  if (options.awsProfile) {
    profile.profile = options.awsProfile
  }
  if (options.endpoint) {
    profile.endpoint = options.endpoint
  }
  return profile
}

/** Produces the updated YAML document without performing filesystem I/O. */
export function mergeTransferProfile(
  existingYaml: string,
  options: TransferProfileOptions,
  fileLabel = CONFIG_FILE_NAME
): string {
  const doc = parseDocument(existingYaml)
  if (doc.errors.length > 0) {
    throw new Error(`Couldn't parse existing ${fileLabel}: ${doc.errors[0].message}`)
  }
  if (doc.contents !== null && !isMap(doc.contents)) {
    throw new Error(`Existing ${fileLabel} isn't a YAML mapping.`)
  }
  doc.setIn(['protocols', 's3', 'transferProfiles', options.name], doc.createNode(buildTransferProfile(options)))
  return doc.toString()
}
