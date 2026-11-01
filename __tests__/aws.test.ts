import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { awsConfigFilePath, resolveRegion } from '../src/aws.js'
import {
  AWS_ENV,
  effectiveProfile,
  hasCredentialHints,
  parseRegionFromAwsConfig,
  resolveRegionFromSources
} from '../src/business/aws.js'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fme-aws-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('effectiveProfile', () => {
  it('prefers the explicit profile input, then AWS_PROFILE, then default', () => {
    expect(effectiveProfile('input-profile', { [AWS_ENV.profile]: 'env-profile' })).toBe('input-profile')
    expect(effectiveProfile('', { [AWS_ENV.profile]: 'env-profile' })).toBe('env-profile')
    expect(effectiveProfile('', {})).toBe('default')
  })
})

describe('awsConfigFilePath', () => {
  it('uses AWS_CONFIG_FILE when set and otherwise resolves the home config path', () => {
    expect(awsConfigFilePath({ [AWS_ENV.configFile]: 'C:\\aws\\custom-config' })).toBe('C:\\aws\\custom-config')
    expect(awsConfigFilePath({})).toBe(path.join(homedir(), '.aws', 'config'))
  })
})

describe('parseRegionFromAwsConfig', () => {
  it('parses default and named profile sections, comments, whitespace, and CRLF input', () => {
    const config = [
      '[default]',
      'output = json',
      'region = us-east-1 # inline comment',
      '',
      '[profile build-agent]',
      '; ignored comment',
      'region = eu-west-1'
    ].join('\r\n')

    expect(parseRegionFromAwsConfig(config, 'default')).toBe('us-east-1')
    expect(parseRegionFromAwsConfig(config, 'build-agent')).toBe('eu-west-1')
  })

  it('accepts [profile default] and ignores regions from unrelated sections', () => {
    expect(parseRegionFromAwsConfig('[profile default]\nregion = us-west-2', 'default')).toBe('us-west-2')
    expect(parseRegionFromAwsConfig('[profile other]\nregion = us-west-2', 'default')).toBeUndefined()
    expect(parseRegionFromAwsConfig('[default]\nregion =\n[profile empty]', 'default')).toBeUndefined()
  })
})

describe('resolveRegion', () => {
  it('follows input, AWS_REGION, AWS_DEFAULT_REGION, then shared config precedence', () => {
    const config = '[profile selected]\nregion = ap-southeast-2\n'
    const env = {
      [AWS_ENV.profile]: 'selected',
      [AWS_ENV.region]: 'ca-central-1',
      [AWS_ENV.defaultRegion]: 'eu-central-1'
    }

    expect(resolveRegionFromSources('sa-east-1', 'explicit', env, config)).toEqual({
      region: 'sa-east-1',
      source: 'input'
    })
    expect(resolveRegionFromSources('', 'explicit', env, config)).toEqual({
      region: 'ca-central-1',
      source: 'AWS_REGION'
    })
    expect(resolveRegionFromSources('', 'explicit', { ...env, [AWS_ENV.region]: '' }, config)).toEqual({
      region: 'eu-central-1',
      source: 'AWS_DEFAULT_REGION'
    })
    expect(
      resolveRegionFromSources('', '', { ...env, [AWS_ENV.region]: '', [AWS_ENV.defaultRegion]: '' }, config)
    ).toEqual({
      region: 'ap-southeast-2',
      source: 'aws-config-file'
    })
  })

  it('uses the explicit and environment profile when reading an overridden config file', async () => {
    const dir = await makeTempDir()
    const configPath = path.join(dir, 'custom-config')
    await writeFile(
      configPath,
      '[profile from-input]\nregion = us-west-1\n[profile from-env]\nregion = us-west-2\n',
      'utf8'
    )
    const env = { [AWS_ENV.configFile]: configPath, [AWS_ENV.profile]: 'from-env' }

    expect(resolveRegion('', 'from-input', env)).toEqual({ region: 'us-west-1', source: 'aws-config-file' })
    expect(resolveRegion('', '', env)).toEqual({ region: 'us-west-2', source: 'aws-config-file' })
  })

  it('returns undefined if neither environment nor an existing config file provides a region', () => {
    expect(resolveRegionFromSources('', '', {}, '')).toBeUndefined()
    expect(resolveRegion('', '', { [AWS_ENV.configFile]: path.join('missing', 'config') })).toBeUndefined()
  })
})

describe('hasCredentialHints', () => {
  it('recognizes explicit/profile credentials, access keys, and web identity tokens', () => {
    expect(hasCredentialHints('input-profile', {})).toBe(true)
    expect(hasCredentialHints('', { [AWS_ENV.profile]: 'env-profile' })).toBe(true)
    expect(hasCredentialHints('', { [AWS_ENV.accessKeyId]: 'key-id' })).toBe(true)
    expect(hasCredentialHints('', { [AWS_ENV.webIdentityTokenFile]: 'token-file' })).toBe(true)
  })

  it('returns false when no supported credential hints are present', () => {
    expect(hasCredentialHints('', {})).toBe(false)
  })
})
