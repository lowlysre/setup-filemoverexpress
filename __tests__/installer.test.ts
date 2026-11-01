import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as tc from '@actions/tool-cache'
import type { Target } from '../src/platform.js'
import type { Release } from '../src/releases.js'
import { install, parseCliVersion, smokeTest, type InstallOptions } from '../src/installer.js'
import { parseVersionSpec } from '../src/version.js'
import { makeTempDir, removeDir, snapshotEnv, unsetEnv } from './helpers.js'

const mocks = vi.hoisted(() => ({
  info: vi.fn<(message: string) => void>(),
  warning: vi.fn<(message: string) => void>(),
  findAllVersions: vi.fn<(toolName: string, arch?: string) => string[]>(),
  find: vi.fn<(toolName: string, versionSpec: string, arch?: string) => string | undefined>(),
  downloadTool: vi.fn<(url: string) => Promise<string>>(),
  cacheDir: vi.fn<(sourceDir: string, tool: string, version: string, arch?: string) => Promise<string>>(),
  listReleases: vi.fn<(token: string) => Promise<Release[]>>(),
  extractCli: vi.fn<(assetPath: string, target: Target, destDir: string) => Promise<string>>(),
  verifyDigest: vi.fn<(filePath: string, digest: string | null | undefined, assetName: string) => Promise<string>>(),
  verifyAuthenticode: vi.fn<(filePath: string, assetName: string) => Promise<void>>(),
  verifyCodesign: vi.fn<(filePath: string, binaryName: string) => Promise<void>>(),
  getExecOutput:
    vi.fn<
      (
        command: string,
        args: string[],
        options?: { env?: NodeJS.ProcessEnv; silent?: boolean }
      ) => Promise<{ stdout: string; stderr: string; exitCode: number }>
    >()
}))

vi.mock('@actions/core', () => ({ info: mocks.info, warning: mocks.warning }))
vi.mock('@actions/exec', () => ({ getExecOutput: mocks.getExecOutput }))
vi.mock('@actions/tool-cache', () => ({
  findAllVersions: mocks.findAllVersions,
  find: mocks.find,
  downloadTool: mocks.downloadTool,
  cacheDir: mocks.cacheDir
}))
vi.mock('../src/releases.js', () => ({ listReleases: mocks.listReleases }))
vi.mock('../src/extract.js', () => ({ extractCli: mocks.extractCli }))
vi.mock('../src/verify.js', () => ({
  verifyDigest: mocks.verifyDigest,
  verifyAuthenticode: mocks.verifyAuthenticode,
  verifyCodesign: mocks.verifyCodesign
}))

const restoreEnv = snapshotEnv()
let tempDir: string | undefined

function releaseFor(target: Target, tag = '1.1.1'): Release {
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: target.assetName,
        browser_download_url: `https://release.example/${target.assetName}`,
        size: 12,
        digest: `sha256:${'a'.repeat(64)}`
      }
    ]
  }
}

function options(target: Target, overrides: Partial<InstallOptions> = {}): InstallOptions {
  return {
    spec: { kind: 'exact', version: '1.1.1' },
    target,
    token: 'api-token',
    checkLatest: false,
    allowPrerelease: false,
    verifySignature: true,
    ...overrides
  }
}

beforeEach(async () => {
  restoreEnv()
  tempDir = await makeTempDir('fme-installer-test-')
  process.env.RUNNER_TEMP = tempDir
  unsetEnv('FME_CONFIG_DIR')
  mocks.info.mockReset()
  mocks.warning.mockReset()
  mocks.findAllVersions.mockReset().mockReturnValue([])
  mocks.find.mockReset().mockReturnValue(undefined)
  mocks.downloadTool.mockReset().mockResolvedValue(path.join(tempDir, 'download.asset'))
  mocks.cacheDir.mockReset().mockResolvedValue(path.join(tempDir, 'cache'))
  mocks.listReleases.mockReset().mockResolvedValue([])
  mocks.extractCli.mockReset().mockImplementation(async (_asset, target) => path.join(tempDir ?? '', target.binaryName))
  mocks.verifyDigest.mockReset().mockResolvedValue('a'.repeat(64))
  mocks.verifyAuthenticode.mockReset().mockResolvedValue(undefined)
  mocks.verifyCodesign.mockReset().mockResolvedValue(undefined)
  mocks.getExecOutput.mockReset().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })
})

afterEach(async () => {
  restoreEnv()
  await removeDir(tempDir)
  tempDir = undefined
  vi.resetAllMocks()
})

describe('install', () => {
  const linux: Target = {
    platform: 'linux',
    arch: 'x64',
    assetName: 'filemoverexpress-linux-amd64',
    kind: 'binary',
    binaryName: 'filemoverexpress'
  }

  it.each([
    [{ kind: 'exact', version: '1.1.1' }, ['1.0.0', '1.1.1']],
    [{ kind: 'range', range: '1.x' }, ['1.0.0', '1.1.1']]
  ] as const)('uses an exact or range cache hit without network access', async (spec, versions) => {
    mocks.findAllVersions.mockReturnValue([...versions])
    mocks.find.mockReturnValue('C:\\toolcache\\fme')

    await expect(install(options(linux, { spec }))).resolves.toEqual({
      version: '1.1.1',
      binPath: path.join('C:\\toolcache\\fme', linux.binaryName),
      cacheHit: true
    })
    expect(tc.findAllVersions).toHaveBeenCalledWith('filemoverexpress', 'x64')
    expect(tc.find).toHaveBeenCalledWith('filemoverexpress', '1.1.1', 'x64')
    expect(mocks.listReleases).not.toHaveBeenCalled()
    expect(tc.downloadTool).not.toHaveBeenCalled()
  })

  it('resolves latest through the releases API and downloads the matching asset', async () => {
    mocks.listReleases.mockResolvedValue([releaseFor(linux)])
    mocks.downloadTool.mockResolvedValue(path.join(tempDir ?? '', 'asset'))
    mocks.cacheDir.mockResolvedValue(path.join(tempDir ?? '', 'cached-tool'))
    mocks.extractCli.mockImplementation(async (_asset, _target, staging) => path.join(staging, linux.binaryName))

    const result = await install(options(linux, { spec: { kind: 'latest' } }))

    expect(mocks.listReleases).toHaveBeenCalledWith('api-token')
    expect(tc.downloadTool).toHaveBeenCalledWith(`https://release.example/${linux.assetName}`)
    expect(mocks.verifyDigest).toHaveBeenCalledWith(
      path.join(tempDir ?? '', 'asset'),
      `sha256:${'a'.repeat(64)}`,
      linux.assetName
    )
    expect(mocks.verifyAuthenticode).not.toHaveBeenCalled()
    expect(mocks.verifyCodesign).not.toHaveBeenCalled()
    expect(mocks.info).toHaveBeenCalledWith(
      'Upstream does not sign Linux builds; integrity is established by the SHA-256 digest.'
    )
    expect(result).toEqual({
      version: '1.1.1',
      binPath: path.join(tempDir ?? '', 'cached-tool', linux.binaryName),
      cacheHit: false
    })
    expect(tc.cacheDir).toHaveBeenCalledWith(expect.any(String), 'filemoverexpress', '1.1.1', 'x64')
    const staging = mocks.extractCli.mock.calls[0][2]
    expect(existsSync(staging)).toBe(false)
  })

  it('checks the API when checkLatest is enabled and returns a post-resolution cache hit', async () => {
    const windows: Target = {
      platform: 'win32',
      arch: 'x64',
      assetName: 'filemoverexpress-windows-amd64-installer.exe',
      kind: 'nsis',
      binaryName: 'filemoverexpress.exe'
    }
    mocks.findAllVersions.mockReturnValue(['1.1.1'])
    mocks.listReleases.mockResolvedValue([releaseFor(windows)])
    mocks.find.mockReturnValue('C:\\toolcache\\latest')

    await expect(install(options(windows, { checkLatest: true }))).resolves.toEqual({
      version: '1.1.1',
      binPath: path.join('C:\\toolcache\\latest', windows.binaryName),
      cacheHit: true
    })
    expect(mocks.listReleases).toHaveBeenCalledOnce()
    expect(tc.findAllVersions).not.toHaveBeenCalled()
    expect(tc.downloadTool).not.toHaveBeenCalled()
  })

  it('skips releases without this platform asset when resolving a range, but names the gap for an exact version', async () => {
    const withAsset = releaseFor(linux)
    const withoutAsset = {
      ...releaseFor(linux, '1.0.0'),
      assets: [{ name: 'FileMoverExpressUI-x64.dmg', browser_download_url: 'https://x', size: 1 }]
    }
    mocks.listReleases.mockResolvedValue([withoutAsset, withAsset])

    const range = await install(options(linux, { spec: parseVersionSpec('1.x') }))
    expect(range.version).toBe('1.1.1')

    await expect(install(options(linux, { spec: parseVersionSpec('1.0.0') }))).rejects.toThrow(
      `Release 1.0.0 has no asset '${linux.assetName}' for linux/x64.`
    )
  })

  it('reports the asset and available names when a resolved release lacks this platform', async () => {
    mocks.listReleases.mockResolvedValue([
      { ...releaseFor(linux), assets: [{ name: 'other-asset', browser_download_url: 'https://x', size: 1 }] }
    ])

    await expect(install(options(linux))).rejects.toThrow(
      `Release 1.1.1 has no asset '${linux.assetName}' for linux/x64. Available assets: other-asset.`
    )
    expect(tc.downloadTool).not.toHaveBeenCalled()
  })

  it('does not pass the API token to the public download host and cleans up after errors', async () => {
    mocks.listReleases.mockResolvedValue([releaseFor(linux)])
    mocks.verifyDigest.mockRejectedValue(new Error('digest rejected'))
    const assetPath = path.join(tempDir ?? '', 'downloaded-file')
    mocks.downloadTool.mockResolvedValue(assetPath)

    await expect(install(options(linux))).rejects.toThrow('digest rejected')

    expect(mocks.listReleases).toHaveBeenCalledWith('api-token')
    expect(tc.downloadTool).toHaveBeenCalledOnce()
    expect(tc.downloadTool).toHaveBeenCalledWith(`https://release.example/${linux.assetName}`)
    expect(mocks.downloadTool.mock.calls[0]).toHaveLength(1)
    expect(existsSync(assetPath)).toBe(false)
    expect((await readdir(tempDir ?? '')).some(entry => entry.startsWith('fme-install-'))).toBe(false)
    expect(mocks.cacheDir).not.toHaveBeenCalled()
  })

  it.each([
    [
      {
        platform: 'win32',
        arch: 'x64',
        assetName: 'filemoverexpress-windows-amd64-installer.exe',
        kind: 'nsis',
        binaryName: 'filemoverexpress.exe'
      } satisfies Target,
      'authenticode'
    ],
    [
      {
        platform: 'darwin',
        arch: 'arm64',
        assetName: 'filemoverexpress-macos-arm64.dmg',
        kind: 'dmg',
        binaryName: 'filemoverexpress'
      } satisfies Target,
      'codesign'
    ]
  ])('verifies %s signatures when enabled', async (target, signatureKind) => {
    mocks.listReleases.mockResolvedValue([releaseFor(target)])

    await install(options(target))

    const verifier = signatureKind === 'authenticode' ? mocks.verifyAuthenticode : mocks.verifyCodesign
    const unusedVerifier = signatureKind === 'authenticode' ? mocks.verifyCodesign : mocks.verifyAuthenticode
    const verifiedName = signatureKind === 'authenticode' ? target.assetName : target.binaryName
    expect(verifier).toHaveBeenCalledWith(expect.any(String), verifiedName)
    expect(unusedVerifier).not.toHaveBeenCalled()
  })

  it.each([
    [
      {
        platform: 'win32',
        arch: 'x64',
        assetName: 'filemoverexpress-windows-amd64-installer.exe',
        kind: 'nsis',
        binaryName: 'filemoverexpress.exe'
      } satisfies Target,
      'Authenticode'
    ],
    [
      {
        platform: 'darwin',
        arch: 'x64',
        assetName: 'filemoverexpress-macos-x64.dmg',
        kind: 'dmg',
        binaryName: 'filemoverexpress'
      } satisfies Target,
      'Apple code signature'
    ]
  ])('warns when %s signature verification is disabled', async (target, signatureDescription) => {
    mocks.listReleases.mockResolvedValue([releaseFor(target)])

    await install(options(target, { verifySignature: false }))

    expect(core.warning).toHaveBeenCalledWith(
      `verify-signature is false; skipping ${signatureDescription === 'Authenticode' ? 'Authenticode verification of the installer.' : 'Apple code signature verification.'}`
    )
    expect(mocks.verifyAuthenticode).not.toHaveBeenCalled()
    expect(mocks.verifyCodesign).not.toHaveBeenCalled()
    expect(mocks.cacheDir).not.toHaveBeenCalled()
  })
})

describe('parseCliVersion', () => {
  it.each([
    ['filemoverexpress version v1.1.1\n', '1.1.1'],
    ['FILEMOVEREXPRESS VERSION 1.2.0', '1.2.0'],
    ['version v1.1.1-rc.1', '1.1.1-rc.1'],
    ['no version here', undefined],
    ['version vnot-semver', undefined]
  ])('parses %j', (output, expected) => {
    expect(parseCliVersion(output)).toBe(expected)
  })
})

describe('smokeTest', () => {
  it('runs the version command with an isolated FME_CONFIG_DIR and accepts a matching version', async () => {
    mocks.getExecOutput.mockImplementation(async (_command, _args, commandOptions) => {
      expect(commandOptions?.env?.FME_CONFIG_DIR).toMatch(/^.*fme-smoke-/)
      expect(existsSync(commandOptions?.env?.FME_CONFIG_DIR ?? '')).toBe(true)
      return { stdout: 'filemoverexpress version v1.1.1\n', stderr: '', exitCode: 0 }
    })

    await expect(smokeTest('C:\\Program Files\\tools\\filemoverexpress.exe', '1.1.1')).resolves.toBeUndefined()

    expect(exec.getExecOutput).toHaveBeenCalledWith(
      '"C:\\Program Files\\tools\\filemoverexpress.exe"',
      ['--version'],
      expect.objectContaining({ silent: true })
    )
    const configDir = mocks.getExecOutput.mock.calls[0][2]?.env?.FME_CONFIG_DIR
    expect(configDir).toBeDefined()
    expect(existsSync(configDir ?? '')).toBe(false)
  })

  it('fails on a mismatched version and still removes its throwaway config directory', async () => {
    mocks.getExecOutput.mockResolvedValue({ stdout: 'filemoverexpress version v1.2.0', stderr: '', exitCode: 0 })

    await expect(smokeTest('fme', '1.1.1')).rejects.toThrow('Installed binary reports version 1.2.0, expected 1.1.1.')
    const configDir = mocks.getExecOutput.mock.calls[0][2]?.env?.FME_CONFIG_DIR
    expect(existsSync(configDir ?? '')).toBe(false)
  })

  it('warns and returns when the CLI output cannot be parsed', async () => {
    mocks.getExecOutput.mockResolvedValue({ stdout: 'unexpected output\n', stderr: '', exitCode: 0 })

    await expect(smokeTest('fme', '1.1.1')).resolves.toBeUndefined()

    expect(core.warning).toHaveBeenCalledWith("Couldn't parse a version from 'unexpected output'.")
  })
})
