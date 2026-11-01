import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { parse } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildTransferProfile,
  mergeTransferProfile,
  parseChecksumAlgorithm,
  parseStorageClass,
  validateAwsProfile,
  validateBucket,
  validateEndpoint,
  validateProfileName,
  validateRegion,
  type TransferProfileOptions
} from '../src/business/config.js'
import { configFilePath, writeTransferProfile } from '../src/config.js'
import { CONFIG_FILE_NAME } from '../src/constants.js'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fme-config-test-'))
  tempDirs.push(dir)
  return dir
}

function options(overrides: Partial<TransferProfileOptions> = {}): TransferProfileOptions {
  return {
    name: 'nightly',
    bucket: 'artifact-bucket',
    region: 'us-east-1',
    awsProfile: '',
    endpoint: '',
    storageClass: 'standard',
    checksumAlgorithm: 'xxhash64',
    accelerate: false,
    ...overrides
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('validateProfileName', () => {
  it('accepts names of 1-64 allowed characters beginning with a letter or digit', () => {
    expect(validateProfileName('1')).toBe('1')
    expect(validateProfileName('Profile_name-2.v1')).toBe('Profile_name-2.v1')
    expect(validateProfileName(`a${'b'.repeat(63)}`)).toHaveLength(64)
  })

  it.each(['', '_profile', '-profile', '.profile', 'has space', 'slash/name', `a${'b'.repeat(64)}`])(
    'rejects invalid profile name %j',
    name => {
      expect(() => validateProfileName(name)).toThrow(/Invalid transfer-profile/)
    }
  )
})

describe('validateBucket', () => {
  it.each(['abc', 'a-b', 'a.b', 'a'.repeat(63)])('accepts valid bucket %j', bucket => {
    expect(validateBucket(bucket)).toBe(bucket)
  })

  it.each(['', 'ab', 'Abc', 'abc-', '-abc', 'a..b', '192.168.0.1', 's3://bucket', 'bucket/key', 'a'.repeat(64)])(
    'rejects invalid bucket %j',
    bucket => {
      expect(() => validateBucket(bucket)).toThrow(/Invalid bucket/)
    }
  )
})

describe('validateRegion', () => {
  it.each(['us-east-1', 'auto', 'garage-1', 'a', `a${'b'.repeat(49)}`])('accepts region %j', region => {
    expect(validateRegion(region)).toBe(region)
  })

  it.each(['', 'US-EAST-1', '-west-1', 'region_1', `a${'b'.repeat(50)}`])('rejects region %j', region => {
    expect(() => validateRegion(region)).toThrow(/Invalid region/)
  })
})

describe('validateAwsProfile', () => {
  it.each(['', 'default', 'team.prod-1', 'name@domain'])('accepts profile %j', profile => {
    expect(validateAwsProfile(profile)).toBe(profile)
  })

  it.each(['with space', 'with\ttab', 'a[b]', 'a/b', 'a\\b'])('rejects profile %j', profile => {
    expect(() => validateAwsProfile(profile)).toThrow(/Invalid aws-profile/)
  })
})

describe('validateEndpoint', () => {
  it('allows an omitted endpoint and HTTP(S) URLs without embedded credentials', () => {
    expect(validateEndpoint('')).toBe('')
    expect(validateEndpoint('https://s3.example.test:9000/path')).toBe('https://s3.example.test:9000/path')
    expect(validateEndpoint('http://localhost:9000')).toBe('http://localhost:9000')
  })

  it.each(['not a URL', 'ftp://s3.example.test', 'file:///tmp/bucket'])('rejects invalid endpoint %j', endpoint => {
    expect(() => validateEndpoint(endpoint)).toThrow(/expected an http\(s\) URL/)
  })

  it.each(['https://user:pass@s3.example.test', 'http://user@s3.example.test'])(
    'rejects credentials in endpoint %j',
    endpoint => {
      expect(() => validateEndpoint(endpoint)).toThrow(/must not contain credentials/)
    }
  )
})

describe('parseChecksumAlgorithm', () => {
  it.each(['none', 'md5-hex', 'xxhash', 'xxhash64', 'xxh3'])('accepts checksum algorithm %s', value => {
    expect(parseChecksumAlgorithm(value)).toBe(value)
  })

  it('normalizes case and surrounding whitespace', () => {
    expect(parseChecksumAlgorithm('  XXHASH64  ')).toBe('xxhash64')
  })

  it('rejects unsupported algorithms', () => {
    expect(() => parseChecksumAlgorithm('sha256')).toThrow(/Invalid checksum-algorithm/)
  })
})

describe('parseStorageClass', () => {
  it.each([
    'standard',
    'reduced_redundancy',
    'standard_ia',
    'onezone_ia',
    'intelligent_tiering',
    'glacier',
    'deep_archive',
    'glacier_ir'
  ])('accepts storage class %s', value => {
    expect(parseStorageClass(value)).toBe(value)
  })

  it('normalizes case, whitespace, and hyphens', () => {
    expect(parseStorageClass('  STANDARD-IA ')).toBe('standard_ia')
    expect(parseStorageClass('Deep Archive')).toBe('deep_archive')
  })

  it('rejects unsupported storage classes', () => {
    expect(() => parseStorageClass('premium')).toThrow(/Invalid storage-class/)
  })
})

describe('buildTransferProfile', () => {
  it('builds the base profile including checksum settings when checksum is enabled', () => {
    expect(buildTransferProfile(options())).toEqual({
      bucket: 'artifact-bucket',
      region: 'us-east-1',
      storageClass: 'standard',
      accelerated: false,
      checksums: { enabled: true, algorithm: 'xxhash64' }
    })
  })

  it('includes optional AWS profile and endpoint settings', () => {
    expect(buildTransferProfile(options({ awsProfile: 'production', endpoint: 'https://s3.example.test' }))).toEqual({
      bucket: 'artifact-bucket',
      region: 'us-east-1',
      storageClass: 'standard',
      accelerated: false,
      checksums: { enabled: true, algorithm: 'xxhash64' },
      profile: 'production',
      endpoint: 'https://s3.example.test'
    })
  })

  it('represents no checksum and acceleration when selected', () => {
    expect(buildTransferProfile(options({ checksumAlgorithm: 'none', accelerate: true }))).toEqual({
      bucket: 'artifact-bucket',
      region: 'us-east-1',
      storageClass: 'standard',
      accelerated: true,
      checksums: { enabled: false, algorithm: 'none' }
    })
  })

  it('rejects acceleration with a custom endpoint', () => {
    expect(() => buildTransferProfile(options({ accelerate: true, endpoint: 'https://s3.example.test' }))).toThrow(
      /mutually exclusive/
    )
  })

  it('rejects acceleration with a dotted bucket name', () => {
    expect(() => buildTransferProfile(options({ accelerate: true, bucket: 'my.bucket' }))).toThrow(/contains a dot/)
  })
})

describe('configuration file operations', () => {
  it('resolves configuration.yaml inside the supplied directory', async () => {
    const dir = await makeTempDir()
    expect(configFilePath(dir)).toBe(path.join(dir, CONFIG_FILE_NAME))
  })

  it('creates a profile in a new directory and persists the requested settings', async () => {
    const dir = path.join(await makeTempDir(), 'nested', 'config')
    const file = await writeTransferProfile(dir, options({ awsProfile: 'work', endpoint: 'https://s3.example.test' }))

    expect(file).toBe(path.join(dir, CONFIG_FILE_NAME))
    expect(parse(await readFile(file, 'utf8'))).toEqual({
      protocols: {
        s3: {
          transferProfiles: {
            nightly: {
              bucket: 'artifact-bucket',
              region: 'us-east-1',
              storageClass: 'standard',
              accelerated: false,
              checksums: { enabled: true, algorithm: 'xxhash64' },
              profile: 'work',
              endpoint: 'https://s3.example.test'
            }
          }
        }
      }
    })
  })

  it('merges a profile while preserving unrelated existing YAML', () => {
    const original =
      'custom: keep-me\nprotocols:\n  ftp:\n    enabled: true\n  s3:\n    transferProfiles:\n      earlier:\n        bucket: earlier-bucket\n'
    expect(parse(mergeTransferProfile(original, options()))).toEqual({
      custom: 'keep-me',
      protocols: {
        ftp: { enabled: true },
        s3: {
          transferProfiles: {
            earlier: { bucket: 'earlier-bucket' },
            nightly: {
              bucket: 'artifact-bucket',
              region: 'us-east-1',
              storageClass: 'standard',
              accelerated: false,
              checksums: { enabled: true, algorithm: 'xxhash64' }
            }
          }
        }
      }
    })
  })

  it('replaces only the matching profile on repeated writes', async () => {
    const dir = await makeTempDir()
    const file = path.join(dir, CONFIG_FILE_NAME)
    await writeTransferProfile(dir, options())
    await writeTransferProfile(dir, options({ bucket: 'replacement-bucket', storageClass: 'glacier' }))

    const parsed: unknown = parse(await readFile(file, 'utf8'))
    expect(parsed).toMatchObject({
      protocols: { s3: { transferProfiles: { nightly: { bucket: 'replacement-bucket', storageClass: 'glacier' } } } }
    })
  })

  it.each(['not: [valid', '- list-item', 'null'])('rejects malformed or non-mapping YAML %j', content => {
    expect(() => mergeTransferProfile(content, options())).toThrow(/parse existing|isn't a YAML mapping/)
  })

  it('writes restrictive file permissions on non-Windows platforms', async () => {
    if (process.platform === 'win32') {
      return
    }
    const dir = await makeTempDir()
    const file = await writeTransferProfile(dir, options())
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it('replaces only the matching profile when writing an updated document', async () => {
    const dir = await makeTempDir()
    const file = path.join(dir, CONFIG_FILE_NAME)
    await writeFile(file, 'unrelated: retained\n', 'utf8')

    await writeTransferProfile(dir, options())
    await writeTransferProfile(dir, options({ bucket: 'replacement-bucket' }))

    expect(parse(await readFile(file, 'utf8'))).toMatchObject({
      unrelated: 'retained',
      protocols: { s3: { transferProfiles: { nightly: { bucket: 'replacement-bucket' } } } }
    })
  })
})
