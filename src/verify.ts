import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import * as exec from '@actions/exec'
import { APPLE_TEAM_ID, WINDOWS_SIGNER_ORG } from './constants.js'

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('hex')
}

/**
 * Verifies a file against the GitHub release asset digest (`sha256:<hex>`). Fails closed when the
 * digest is missing or uses an algorithm we can't check.
 */
export async function verifyDigest(
  filePath: string,
  digest: string | null | undefined,
  assetName: string
): Promise<string> {
  if (!digest) {
    throw new Error(
      `Release asset '${assetName}' has no digest in the GitHub Releases API, so its integrity can't be verified.`
    )
  }
  const match = /^sha256:([a-f0-9]{64})$/i.exec(digest.trim())
  if (!match) {
    throw new Error(`Release asset '${assetName}' has an unsupported digest '${digest}'; expected sha256:<hex>.`)
  }
  const expected = match[1].toLowerCase()
  const actual = await sha256File(filePath)
  if (actual !== expected) {
    throw new Error(
      `SHA-256 mismatch for '${assetName}': expected ${expected}, got ${actual}. The download may be corrupt or tampered with.`
    )
  }
  return actual
}

export interface AuthenticodeResult {
  status: string
  subject: string
}

/** Extracts the organization (`O=`) attribute from an X.500 distinguished name. */
export function parseDistinguishedNameOrg(subject: string): string | undefined {
  const match = /(?:^|,)\s*O=("((?:[^"]|"")*)"|[^,]*)/.exec(subject)
  if (!match) {
    return undefined
  }
  return match[2] !== undefined ? match[2].replace(/""/g, '"') : match[1].trim()
}

export function assertAuthenticode(result: AuthenticodeResult, assetName: string): void {
  if (result.status !== 'Valid') {
    throw new Error(`Authenticode signature of '${assetName}' is not valid (status: ${result.status || 'unknown'}).`)
  }
  const org = parseDistinguishedNameOrg(result.subject)
  if (org !== WINDOWS_SIGNER_ORG) {
    throw new Error(`'${assetName}' is signed by '${result.subject}', expected organization "${WINDOWS_SIGNER_ORG}".`)
  }
}

const AUTHENTICODE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$s = Get-AuthenticodeSignature -LiteralPath $env:FME_VERIFY_PATH',
  '$subject = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { "" }',
  '@{ status = [string]$s.Status; subject = $subject } | ConvertTo-Json -Compress'
].join('; ')

export function parseAuthenticodeOutput(stdout: string): AuthenticodeResult | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout.trim())
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || !('status' in parsed) || !('subject' in parsed)) {
    return undefined
  }
  const { status, subject } = parsed
  return { status: typeof status === 'string' ? status : '', subject: typeof subject === 'string' ? subject : '' }
}

export async function verifyAuthenticode(filePath: string, assetName: string): Promise<void> {
  // -EncodedCommand sidesteps Windows argument quoting; the path travels in an env var, never in the script.
  const encoded = Buffer.from(AUTHENTICODE_SCRIPT, 'utf16le').toString('base64')
  // A PSModulePath inherited from PowerShell 7 (the default `pwsh` step shell) makes Windows
  // PowerShell 5.1 load incompatible modules; without it, 5.1 rebuilds its default module path.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'))
  const output = await exec.getExecOutput(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    {
      env: { ...env, FME_VERIFY_PATH: filePath },
      ignoreReturnCode: true,
      silent: true
    }
  )
  const result = output.exitCode === 0 ? parseAuthenticodeOutput(output.stdout) : undefined
  if (!result) {
    throw new Error(
      `Couldn't read the Authenticode signature of '${assetName}': ${output.stderr.trim() || output.stdout.trim()}`
    )
  }
  assertAuthenticode(result, assetName)
}

export interface CodesignDetails {
  teamIdentifier?: string
  authorities: string[]
}

export function parseCodesignDetails(output: string): CodesignDetails {
  const details: CodesignDetails = { authorities: [] }
  for (const line of output.split(/\r?\n/)) {
    const [key, ...rest] = line.split('=')
    const value = rest.join('=').trim()
    if (key === 'TeamIdentifier') {
      details.teamIdentifier = value
    } else if (key === 'Authority') {
      details.authorities.push(value)
    }
  }
  return details
}

export function assertCodesign(details: CodesignDetails, binaryName: string): void {
  if (details.teamIdentifier !== APPLE_TEAM_ID) {
    throw new Error(
      `'${binaryName}' is signed by team '${details.teamIdentifier ?? 'none'}', expected Amazon's Apple team ${APPLE_TEAM_ID}.`
    )
  }
  if (!details.authorities.some(authority => authority.startsWith('Developer ID Application:'))) {
    throw new Error(`'${binaryName}' isn't signed with a Developer ID Application certificate.`)
  }
}

/**
 * Code requirement enforced by `codesign --verify -R`: an Apple-anchored chain (so a self-made certificate
 * can't claim Amazon's Team ID), Amazon's team in the leaf certificate, the Developer ID intermediate
 * (OID 1.2.840.113635.100.6.2.6) and the Developer ID Application leaf extension (OID 1.2.840.113635.100.6.1.13).
 */
export const CODESIGN_REQUIREMENT = [
  'anchor apple generic',
  `certificate leaf[subject.OU] = "${APPLE_TEAM_ID}"`,
  'certificate 1[field.1.2.840.113635.100.6.2.6] exists',
  'certificate leaf[field.1.2.840.113635.100.6.1.13] exists'
].join(' and ')

export async function verifyCodesign(filePath: string, binaryName: string): Promise<void> {
  const check = await exec.getExecOutput(
    'codesign',
    ['--verify', '--strict', '--verbose=2', `-R=${CODESIGN_REQUIREMENT}`, filePath],
    { ignoreReturnCode: true, silent: true }
  )
  if (check.exitCode !== 0) {
    throw new Error(`codesign rejected '${binaryName}': ${check.stderr.trim() || check.stdout.trim()}`)
  }
  // codesign writes the signature details to stderr.
  const display = await exec.getExecOutput('codesign', ['--display', '--verbose=4', filePath], {
    ignoreReturnCode: true,
    silent: true
  })
  assertCodesign(parseCodesignDetails(`${display.stderr}\n${display.stdout}`), binaryName)
}
