import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as core from '@actions/core'
import { chooseVersionInput, parseInputs, type ParsedInputs } from '../src/business/inputs.js'
import { getInputs, resolveVersionInput } from '../src/inputs.js'
import { makeTempDir, removeDir, snapshotEnv, unsetEnv } from './helpers.js'

const mocks = vi.hoisted(() => ({
  getInput: vi.fn<(name: string) => string>(),
  getBooleanInput: vi.fn<(name: string) => boolean>(),
  warning: vi.fn<(message: string) => void>(),
  info: vi.fn<(message: string) => void>()
}))

vi.mock('@actions/core', () => ({
  getInput: mocks.getInput,
  getBooleanInput: mocks.getBooleanInput,
  warning: mocks.warning,
  info: mocks.info
}))

const restoreEnv = snapshotEnv()
let tempDir: string | undefined

beforeEach(() => {
  restoreEnv()
  unsetEnv('GITHUB_WORKSPACE', 'RUNNER_TEMP')
  mocks.getInput.mockImplementation(() => '')
  mocks.getBooleanInput.mockImplementation(() => false)
  mocks.warning.mockReset()
  mocks.info.mockReset()
})

afterEach(async () => {
  await removeDir(tempDir)
  tempDir = undefined
  restoreEnv()
  vi.resetAllMocks()
})

function parsedInputs(overrides: Partial<ParsedInputs> = {}): ParsedInputs {
  return {
    versionLabel: 'latest',
    architecture: '',
    checkLatest: false,
    allowPrerelease: false,
    token: '',
    verifySignature: true,
    configDir: '',
    transferProfile: '',
    bucket: '',
    region: '',
    awsProfile: '',
    endpoint: '',
    storageClass: '',
    checksumAlgorithm: '',
    accelerate: false,
    validateCredentials: false,
    ...overrides
  }
}

describe('chooseVersionInput', () => {
  it('prefers the explicit version, otherwise parses an available version file', () => {
    expect(chooseVersionInput(' 1.1.1 ', 'versions.txt', 'not a version entry')).toBe(' 1.1.1 ')
    expect(chooseVersionInput('', '.tool-versions', '# comment\nfilemoverexpress 1.2.0\n')).toBe('1.2.0')
  })

  it('defaults to latest and reports a missing version file', () => {
    expect(chooseVersionInput('', '')).toBe('latest')
    expect(() => chooseVersionInput('', 'versions.txt')).toThrow(
      "filemoverexpress-version-file 'versions.txt' doesn't exist."
    )
  })
})

describe('parseInputs', () => {
  it('normalizes and validates raw values using caller-supplied runtime defaults', () => {
    expect(
      parseInputs(
        parsedInputs({
          versionLabel: '^1.0.0',
          architecture: ' AMD64 ',
          token: ' token ',
          configDir: ' config ',
          transferProfile: ' production ',
          bucket: ' my-bucket ',
          region: ' us-east-1 ',
          awsProfile: ' deploy ',
          endpoint: ' https://storage.example.test ',
          storageClass: ' Glacier-IR ',
          checksumAlgorithm: ' XXHASH ',
          accelerate: true,
          validateCredentials: true
        }),
        { processArch: 'arm64', configDirDefault: 'default-config' }
      )
    ).toEqual({
      spec: { kind: 'range', range: '^1.0.0' },
      versionLabel: '^1.0.0',
      arch: 'x64',
      checkLatest: false,
      allowPrerelease: false,
      token: 'token',
      verifySignature: true,
      configDir: path.resolve('config'),
      transferProfile: 'production',
      bucket: 'my-bucket',
      region: 'us-east-1',
      awsProfile: 'deploy',
      endpoint: 'https://storage.example.test',
      storageClass: 'glacier_ir',
      checksumAlgorithm: 'xxhash',
      accelerate: true,
      validateCredentials: true
    })
  })

  it('uses the architecture and config-dir defaults provided by the runtime', () => {
    expect(parseInputs(parsedInputs(), { processArch: 'aarch64', configDirDefault: 'runtime-config' })).toMatchObject({
      arch: 'arm64',
      configDir: path.resolve('runtime-config'),
      transferProfile: 'default',
      storageClass: 'standard',
      checksumAlgorithm: 'none'
    })
  })

  it.each([
    [parsedInputs({ architecture: 'mips64' }), 'Unsupported architecture'],
    [parsedInputs({ versionLabel: 'invalid' }), 'Invalid filemoverexpress-version'],
    [parsedInputs({ transferProfile: '../bad' }), 'Invalid transfer-profile'],
    [parsedInputs({ bucket: 's3://bucket' }), 'Invalid bucket'],
    [parsedInputs({ awsProfile: 'bad/profile' }), 'Invalid aws-profile'],
    [parsedInputs({ endpoint: 'ftp://example.test' }), 'Invalid endpoint'],
    [parsedInputs({ storageClass: 'made-up' }), 'Invalid storage-class'],
    [parsedInputs({ checksumAlgorithm: 'sha256' }), 'Invalid checksum-algorithm']
  ])('rejects invalid raw inputs', (values, message) => {
    expect(() => parseInputs(values, { processArch: 'x64', configDirDefault: 'config' })).toThrow(message)
  })
})

describe('resolveVersionInput', () => {
  it('defaults to latest', () => {
    expect(resolveVersionInput()).toBe('latest')
  })

  it('uses an explicit version and warns when a version file is also set', () => {
    mocks.getInput.mockImplementation(name =>
      name === 'filemoverexpress-version' ? ' 1.1.1 ' : name === 'filemoverexpress-version-file' ? 'versions.txt' : ''
    )

    expect(resolveVersionInput()).toBe('1.1.1')
    expect(core.warning).toHaveBeenCalledWith(
      'Both filemoverexpress-version and filemoverexpress-version-file are set; using filemoverexpress-version.'
    )
  })

  it('reads a relative version file from GITHUB_WORKSPACE', async () => {
    tempDir = await makeTempDir()
    process.env.GITHUB_WORKSPACE = tempDir
    await mkdir(path.join(tempDir, 'config'), { recursive: true })
    await writeFile(path.join(tempDir, 'config', 'versions'), '# pin\n\nfilemoverexpress 1.2.0\n')
    mocks.getInput.mockImplementation(name => (name === 'filemoverexpress-version-file' ? 'config/versions' : ''))

    expect(resolveVersionInput()).toBe('1.2.0')
    expect(core.info).toHaveBeenCalledWith("Read filemoverexpress version '1.2.0' from config/versions")
  })

  it('reports a missing version file using the supplied path', () => {
    tempDir = 'C:\\directory-that-does-not-exist-for-this-test'
    process.env.GITHUB_WORKSPACE = tempDir
    mocks.getInput.mockImplementation(name => (name === 'filemoverexpress-version-file' ? 'missing.txt' : ''))

    expect(() => resolveVersionInput()).toThrow("filemoverexpress-version-file 'missing.txt' doesn't exist.")
  })
})

describe('getInputs', () => {
  it('applies defaults and resolves runner architecture and config directory', () => {
    tempDir = 'C:\\runner-temp'
    process.env.RUNNER_TEMP = tempDir

    expect(getInputs()).toEqual({
      spec: { kind: 'latest' },
      versionLabel: 'latest',
      arch: process.arch === 'arm64' ? 'arm64' : 'x64',
      checkLatest: false,
      allowPrerelease: false,
      token: '',
      verifySignature: true,
      configDir: path.resolve(tempDir, 'filemoverexpress'),
      transferProfile: 'default',
      bucket: '',
      region: '',
      awsProfile: '',
      endpoint: '',
      storageClass: 'standard',
      checksumAlgorithm: 'none',
      accelerate: false,
      validateCredentials: false
    })
  })

  it('parses explicit booleans and normalizes input values', () => {
    const values: Record<string, string> = {
      architecture: ' AARCH64 ',
      'check-latest': 'true',
      'allow-prerelease': 'true',
      'verify-signature': 'false',
      accelerate: 'true',
      'validate-credentials': 'true',
      'transfer-profile': 'release.prod',
      bucket: 'my-bucket-01',
      'aws-profile': 'deploy',
      endpoint: 'https://storage.example.test',
      'storage-class': 'Standard-IA',
      'checksum-algorithm': 'XXHASH64',
      'config-dir': 'custom-config',
      token: 'github-token',
      'filemoverexpress-version': '^1.0.0'
    }
    mocks.getInput.mockImplementation(name => values[name] ?? '')
    mocks.getBooleanInput.mockImplementation(name => values[name] === 'true')

    const result = getInputs()
    expect(result).toMatchObject({
      spec: { kind: 'range', range: '^1.0.0' },
      versionLabel: '^1.0.0',
      arch: 'arm64',
      checkLatest: true,
      allowPrerelease: true,
      token: 'github-token',
      verifySignature: false,
      transferProfile: 'release.prod',
      bucket: 'my-bucket-01',
      awsProfile: 'deploy',
      endpoint: 'https://storage.example.test',
      storageClass: 'standard_ia',
      checksumAlgorithm: 'xxhash64',
      accelerate: true,
      validateCredentials: true
    })
    expect(result.configDir).toBe(path.resolve('custom-config'))
  })

  it.each([
    ['architecture', 'mips64', 'Unsupported architecture'],
    ['filemoverexpress-version', 'invalid', 'Invalid filemoverexpress-version'],
    ['transfer-profile', '../bad', 'Invalid transfer-profile'],
    ['bucket', 's3://bucket', 'Invalid bucket'],
    ['aws-profile', 'bad/profile', 'Invalid aws-profile'],
    ['endpoint', 'ftp://example.test', 'Invalid endpoint'],
    ['storage-class', 'made-up', 'Invalid storage-class'],
    ['checksum-algorithm', 'sha256', 'Invalid checksum-algorithm']
  ])('validates %s', (name, value, message) => {
    mocks.getInput.mockImplementation(inputName => (inputName === name ? value : ''))

    expect(() => getInputs()).toThrow(message)
  })
})
