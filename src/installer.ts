import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import * as path from 'node:path'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as tc from '@actions/tool-cache'
import semver from 'semver'
import { CONFIG_DIR_ENV, CONFIG_FILE_NAME, TOOL_NAME } from './constants.js'
import { extractCli } from './extract.js'
import type { Target } from './platform.js'
import { listReleases, type Release } from './releases.js'
import { quoteExecutable, tempRoot } from './util.js'
import { selectCachedVersion, selectRelease, type ResolvedRelease, type VersionSpec } from './version.js'
import { verifyAuthenticode, verifyCodesign, verifyDigest } from './verify.js'

export interface InstallOptions {
  spec: VersionSpec
  target: Target
  token: string
  checkLatest: boolean
  allowPrerelease: boolean
  verifySignature: boolean
}

export interface InstallResult {
  version: string
  binPath: string
  cacheHit: boolean
}

export async function install(options: InstallOptions): Promise<InstallResult> {
  const { spec, target } = options

  if (!options.checkLatest) {
    const cachedVersion = selectCachedVersion(tc.findAllVersions(TOOL_NAME, target.arch), spec, options.allowPrerelease)
    const cached = cachedVersion ? findCached(cachedVersion, target) : undefined
    if (cached) {
      core.info(`Found File Mover Express ${cached.version} in the tool cache`)
      return cached
    }
  }

  core.info('Resolving File Mover Express version from github.com/awslabs/filemoverexpress releases')
  const releases = await listReleases(options.token)
  const { version, release } = resolveRelease(releases, options, target)
  core.info(`Resolved File Mover Express ${version}`)

  const cached = findCached(version, target)
  if (cached) {
    core.info(`Found File Mover Express ${version} in the tool cache`)
    return cached
  }

  const asset = release.assets.find(candidate => candidate.name === target.assetName)
  if (!asset) {
    throw missingAssetError(release, target)
  }

  core.info(`Downloading ${asset.browser_download_url}`)
  // Release downloads are public; the token is deliberately not forwarded to the download host.
  const assetPath = await tc.downloadTool(asset.browser_download_url)
  const staging = await mkdtemp(path.join(tempRoot(), 'fme-install-'))
  let keepStaging = false
  try {
    const sha256 = await verifyDigest(assetPath, asset.digest, asset.name)
    core.info(`Verified SHA-256 ${sha256}`)

    if (target.kind === 'nsis') {
      if (options.verifySignature) {
        await verifyAuthenticode(assetPath, asset.name)
        core.info('Verified Authenticode signature (Amazon Web Services, Inc.)')
      } else {
        core.warning('verify-signature is false; skipping Authenticode verification of the installer.')
      }
    }

    const stagedBin = await extractCli(assetPath, target, staging)

    if (target.kind === 'dmg') {
      if (options.verifySignature) {
        await verifyCodesign(stagedBin, target.binaryName)
        core.info('Verified Apple code signature (Team ID 94KV3E626L)')
      } else {
        core.warning('verify-signature is false; skipping Apple code signature verification.')
      }
    } else if (target.kind === 'binary') {
      core.info('Upstream does not sign Linux builds; integrity is established by the SHA-256 digest.')
    }

    // The tool cache keys only on the version, so entries must be safe for every later request:
    // unverified installs would be trusted by verified runs, and a GitHub-flagged prerelease with a
    // stable-looking tag would be accepted by requests that disallow prereleases.
    const flaggedPrerelease = release.prerelease && !semver.prerelease(version)
    if ((!options.verifySignature && target.kind !== 'binary') || flaggedPrerelease) {
      keepStaging = true
      return { version, binPath: path.join(staging, target.binaryName), cacheHit: false }
    }

    const toolDir = await tc.cacheDir(staging, TOOL_NAME, version, target.arch)
    return { version, binPath: path.join(toolDir, target.binaryName), cacheHit: false }
  } finally {
    if (!keepStaging) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    }
    await rm(assetPath, { force: true }).catch(() => undefined)
  }
}

function missingAssetError(release: Release, target: Target): Error {
  const names = release.assets.map(candidate => candidate.name).join(', ')
  return new Error(
    `Release ${release.tag_name} has no asset '${target.assetName}' for ${target.platform}/${target.arch}. Available assets: ${names}.`
  )
}

/**
 * Some upstream releases ship no CLI build (1.0.0 has only the GUI installers and the MCP server), so ranges
 * and `latest` resolve only among releases that have this platform's asset. An exact version without one
 * still reports the missing asset instead of a generic no-match error.
 */
function resolveRelease(releases: Release[], options: InstallOptions, target: Target): ResolvedRelease {
  const withAsset = releases.filter(release => release.assets.some(asset => asset.name === target.assetName))
  try {
    return selectRelease(withAsset, options.spec, options.allowPrerelease)
  } catch (error) {
    const unfiltered = trySelectRelease(releases, options)
    if (unfiltered) {
      throw missingAssetError(unfiltered.release, target)
    }
    throw error
  }
}

function trySelectRelease(releases: Release[], options: InstallOptions): ResolvedRelease | undefined {
  try {
    return selectRelease(releases, options.spec, options.allowPrerelease)
  } catch {
    return undefined
  }
}

function findCached(version: string, target: Target): InstallResult | undefined {
  const toolDir = tc.find(TOOL_NAME, version, target.arch)
  if (!toolDir) {
    return undefined
  }
  return { version, binPath: path.join(toolDir, target.binaryName), cacheHit: true }
}

/** Parses `filemoverexpress version v1.1.1` into `1.1.1`. */
export function parseCliVersion(output: string): string | undefined {
  const match = /version\s+v?(\S+)/i.exec(output)
  return match ? (semver.valid(semver.clean(match[1])) ?? undefined) : undefined
}

/**
 * Lets the CLI write its default configuration (it does so on first start) before the action adds a transfer
 * profile. A file holding only a profile has no general settings, so uploads warn that
 * `max-active-transfers=0` is invalid.
 */
export async function seedDefaultConfiguration(binPath: string, configDir: string): Promise<void> {
  if (existsSync(path.join(configDir, CONFIG_FILE_NAME))) {
    return
  }
  await exec.getExecOutput(quoteExecutable(binPath), ['--version'], {
    env: { ...process.env, [CONFIG_DIR_ENV]: configDir },
    ignoreReturnCode: true,
    silent: true
  })
}

/**
 * Runs `filemoverexpress --version` with a throwaway config dir (the CLI writes a default config on
 * every start) and checks it reports the version we resolved.
 */
export async function smokeTest(binPath: string, expectedVersion: string): Promise<void> {
  const configDir = await mkdtemp(path.join(tempRoot(), 'fme-smoke-'))
  try {
    const output = await exec.getExecOutput(quoteExecutable(binPath), ['--version'], {
      env: { ...process.env, [CONFIG_DIR_ENV]: configDir },
      silent: true
    })
    const reported = parseCliVersion(output.stdout)
    if (!reported) {
      core.warning(`Couldn't parse a version from '${output.stdout.trim()}'.`)
      return
    }
    if (!semver.eq(reported, expectedVersion)) {
      throw new Error(`Installed binary reports version ${reported}, expected ${expectedVersion}.`)
    }
    core.info(output.stdout.trim())
  } finally {
    await rm(configDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
