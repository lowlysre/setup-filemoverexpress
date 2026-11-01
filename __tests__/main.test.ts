import { existsSync } from 'node:fs'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as core from '@actions/core'
import type { Inputs } from '../src/inputs.js'
import type { InstallResult } from '../src/installer.js'
import type { ResolvedRegion } from '../src/aws.js'
import type { TransferProfileOptions } from '../src/config.js'
import { problemMatcherPath, run } from '../src/main.js'
import { makeTempDir, removeDir, snapshotEnv, unsetEnv } from './helpers.js'

const mocks = vi.hoisted(() => ({
  info: vi.fn<(message: string) => void>(),
  warning: vi.fn<(message: string) => void>(),
  addPath: vi.fn<(inputPath: string) => void>(),
  exportVariable: vi.fn<(name: string, value: string) => void>(),
  setOutput: vi.fn<(name: string, value: string) => void>(),
  setFailed: vi.fn<(message: string) => void>(),
  group: vi.fn<<T>(name: string, fn: () => Promise<T>) => Promise<T>>(),
  getInputs: vi.fn<() => Inputs>(),
  install: vi.fn<
    (options: {
      spec: Inputs['spec']
      target: {
        platform: NodeJS.Platform
        arch: Inputs['arch']
        assetName: string
        kind: 'binary' | 'dmg' | 'nsis'
        binaryName: string
      }
      token: string
      checkLatest: boolean
      allowPrerelease: boolean
      verifySignature: boolean
    }) => Promise<InstallResult>
  >(),
  smokeTest: vi.fn<(binPath: string, expectedVersion: string) => Promise<void>>(),
  seedDefaultConfiguration: vi.fn<(binPath: string, configDir: string) => Promise<void>>(),
  resolveRegion: vi.fn<(regionInput: string, awsProfileInput: string) => ResolvedRegion | undefined>(),
  validateRegion: vi.fn<(region: string) => string>(),
  writeTransferProfile: vi.fn<(configDir: string, options: TransferProfileOptions) => Promise<string>>(),
  configFilePath: vi.fn<(configDir: string) => string>(),
  validateCredentials:
    vi.fn<(binPath: string, configDir: string, profile: string, awsProfileInput: string) => Promise<void>>()
}))

vi.mock('@actions/core', () => ({
  info: mocks.info,
  warning: mocks.warning,
  addPath: mocks.addPath,
  exportVariable: mocks.exportVariable,
  setOutput: mocks.setOutput,
  setFailed: mocks.setFailed,
  group: mocks.group
}))
vi.mock('../src/inputs.js', () => ({ getInputs: mocks.getInputs }))
vi.mock('../src/installer.js', () => ({
  install: mocks.install,
  smokeTest: mocks.smokeTest,
  seedDefaultConfiguration: mocks.seedDefaultConfiguration
}))
vi.mock('../src/aws.js', () => ({
  AWS_ENV: {
    region: 'AWS_REGION',
    defaultRegion: 'AWS_DEFAULT_REGION'
  },
  resolveRegion: mocks.resolveRegion
}))
vi.mock('../src/config.js', () => ({
  validateRegion: mocks.validateRegion,
  writeTransferProfile: mocks.writeTransferProfile,
  configFilePath: mocks.configFilePath
}))
vi.mock('../src/validate.js', () => ({ validateCredentials: mocks.validateCredentials }))

const restoreEnv = snapshotEnv()
let tempDir: string | undefined

function inputs(overrides: Partial<Inputs> = {}): Inputs {
  return {
    spec: { kind: 'exact', version: '1.1.1' },
    versionLabel: '1.1.1',
    arch: 'x64',
    checkLatest: false,
    allowPrerelease: false,
    token: '',
    verifySignature: true,
    configDir: path.join(tempDir ?? '', 'fme-config'),
    transferProfile: 'transfer.default',
    bucket: '',
    region: '',
    awsProfile: '',
    endpoint: '',
    storageClass: 'standard',
    checksumAlgorithm: 'none',
    accelerate: false,
    validateCredentials: false,
    ...overrides
  }
}

const installed: InstallResult = {
  version: '1.1.1',
  binPath: 'C:\\tools\\filemoverexpress.exe',
  cacheHit: true
}

beforeEach(async () => {
  restoreEnv()
  tempDir = await makeTempDir('fme-main-test-')
  unsetEnv('AWS_REGION', 'AWS_DEFAULT_REGION', 'FME_CONFIG_DIR')

  mocks.info.mockReset()
  mocks.warning.mockReset()
  mocks.addPath.mockReset()
  mocks.exportVariable.mockReset()
  mocks.setOutput.mockReset()
  mocks.setFailed.mockReset()
  mocks.group.mockReset().mockImplementation(async (_name, fn) => fn())
  mocks.getInputs.mockReset().mockReturnValue(inputs())
  mocks.install.mockReset().mockResolvedValue(installed)
  mocks.smokeTest.mockReset().mockResolvedValue(undefined)
  mocks.seedDefaultConfiguration.mockReset().mockResolvedValue(undefined)
  mocks.resolveRegion.mockReset().mockReturnValue({ region: 'us-west-2', source: 'AWS_REGION' })
  mocks.validateRegion.mockReset().mockImplementation(region => region)
  mocks.writeTransferProfile.mockReset().mockResolvedValue(path.join(tempDir, 'fme-config', 'configuration.yaml'))
  mocks.configFilePath.mockReset().mockImplementation(configDir => path.join(configDir, 'configuration.yaml'))
  mocks.validateCredentials.mockReset().mockResolvedValue(undefined)
})

afterEach(async () => {
  restoreEnv()
  await removeDir(tempDir)
  tempDir = undefined
  vi.resetAllMocks()
})

describe('run', () => {
  it('installs, smoke-tests, exports the config directory and emits outputs without a bucket', async () => {
    await run()

    expect(mocks.install).toHaveBeenCalledOnce()
    expect(mocks.smokeTest).toHaveBeenCalledWith(installed.binPath, installed.version)
    expect(core.addPath).toHaveBeenCalledWith(path.dirname(installed.binPath))
    expect(core.exportVariable).toHaveBeenCalledWith('FME_CONFIG_DIR', inputs().configDir)
    expect(existsSync(inputs().configDir)).toBe(true)
    expect(mocks.writeTransferProfile).not.toHaveBeenCalled()
    expect(mocks.resolveRegion).not.toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith('filemoverexpress-version', '1.1.1')
    expect(core.setOutput).toHaveBeenCalledWith('filemoverexpress-path', installed.binPath)
    expect(core.setOutput).toHaveBeenCalledWith('cache-hit', 'true')
    expect(core.setOutput).toHaveBeenCalledWith('config-dir', inputs().configDir)
    expect(core.setOutput).toHaveBeenCalledWith('config-file', path.join(inputs().configDir, 'configuration.yaml'))
    expect(core.setOutput).toHaveBeenCalledWith('transfer-profile', '')
    expect(core.info).toHaveBeenCalledWith(`::add-matcher::${problemMatcherPath()}`)
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('writes a bucket profile and exports both AWS region variables when neither was set', async () => {
    mocks.getInputs.mockReturnValue(inputs({ bucket: 'media-bucket' }))
    mocks.writeTransferProfile.mockResolvedValue(path.join(tempDir ?? '', 'configuration.yaml'))

    await run()

    expect(mocks.resolveRegion).toHaveBeenCalledWith('', '')
    expect(mocks.seedDefaultConfiguration).toHaveBeenCalledWith(installed.binPath, inputs().configDir)
    expect(mocks.seedDefaultConfiguration.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.writeTransferProfile.mock.invocationCallOrder[0]
    )
    expect(mocks.validateRegion).toHaveBeenCalledWith('us-west-2')
    expect(mocks.writeTransferProfile).toHaveBeenCalledWith(inputs({ bucket: 'media-bucket' }).configDir, {
      name: 'transfer.default',
      bucket: 'media-bucket',
      region: 'us-west-2',
      awsProfile: '',
      endpoint: '',
      storageClass: 'standard',
      checksumAlgorithm: 'none',
      accelerate: false
    })
    expect(core.exportVariable).toHaveBeenCalledWith('AWS_REGION', 'us-west-2')
    expect(core.exportVariable).toHaveBeenCalledWith('AWS_DEFAULT_REGION', 'us-west-2')
    expect(core.setOutput).toHaveBeenCalledWith('transfer-profile', 'transfer.default')
  })

  it('warns that File Mover Express 1.1.1 ignores the accelerated setting, but only for versions that do', async () => {
    mocks.getInputs.mockReturnValue(inputs({ bucket: 'media-bucket', accelerate: true }))
    await run()
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("doesn't apply the 'accelerated' profile setting")
    )

    mocks.warning.mockReset()
    mocks.install.mockResolvedValue({ ...installed, version: '1.2.0' })
    await run()
    expect(core.warning).not.toHaveBeenCalled()
  })

  it.each([['AWS_DEFAULT_REGION', undefined, 'eu-west-1']])(
    'preserves existing AWS region environment when %s is set',
    async (setName, regionValue, defaultValue) => {
      mocks.getInputs.mockReturnValue(inputs({ bucket: 'media-bucket' }))
      if (regionValue) {
        process.env.AWS_REGION = regionValue
      }
      if (defaultValue) {
        process.env.AWS_DEFAULT_REGION = defaultValue
      }

      await run()

      expect(core.exportVariable).not.toHaveBeenCalledWith('AWS_REGION', expect.any(String))
      expect(core.exportVariable).not.toHaveBeenCalledWith('AWS_DEFAULT_REGION', expect.any(String))
      expect(process.env[setName]).toBe(regionValue ?? defaultValue)
    }
  )

  it('validates credentials for the selected profile even when no bucket profile was requested', async () => {
    mocks.getInputs.mockReturnValue(inputs({ validateCredentials: true, transferProfile: 'custom-profile' }))

    await run()

    expect(mocks.validateCredentials).toHaveBeenCalledWith(installed.binPath, inputs().configDir, 'custom-profile', '')
    expect(mocks.writeTransferProfile).not.toHaveBeenCalled()
  })

  it('fails with a clear error when no region is resolvable for a bucket', async () => {
    mocks.getInputs.mockReturnValue(inputs({ bucket: 'media-bucket' }))
    mocks.resolveRegion.mockReturnValue(undefined)

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      'No AWS region found for the transfer profile. Set the region input, or run aws-actions/configure-aws-credentials (which exports AWS_REGION) before this action.'
    )
    expect(mocks.writeTransferProfile).not.toHaveBeenCalled()
    expect(core.setOutput).not.toHaveBeenCalled()
  })

  it('registers failures from installation or configuration through setFailed', async () => {
    mocks.install.mockRejectedValue(new Error('installation failed'))

    await run()

    expect(core.setFailed).toHaveBeenCalledWith('installation failed')
  })

  it('converts non-Error thrown values to a failure message', async () => {
    mocks.install.mockRejectedValue('install failed')

    await run()

    expect(core.setFailed).toHaveBeenCalledWith('install failed')
  })
})
