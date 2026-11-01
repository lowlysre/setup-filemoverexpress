import semver from 'semver'
import { TOOL_NAME } from './constants.js'
import type { Release } from './releases.js'

export type VersionSpec = { kind: 'latest' } | { kind: 'exact'; version: string } | { kind: 'range'; range: string }

export function parseVersionSpec(input: string): VersionSpec {
  const spec = input.trim()
  if (spec === '' || spec.toLowerCase() === 'latest') {
    return { kind: 'latest' }
  }
  const exact = semver.valid(semver.clean(spec, { loose: false }))
  if (exact && /^v?\d+\.\d+\.\d+/.test(spec)) {
    return { kind: 'exact', version: exact }
  }
  const range = semver.validRange(spec.replace(/^v(?=\d)/, ''))
  if (!range) {
    throw new Error(
      `Invalid filemoverexpress-version '${input}'. Use 'latest', an exact version such as '1.1.1', or a semver range such as '1.x'.`
    )
  }
  return { kind: 'range', range }
}

/**
 * Reads a version from a version file. Accepts either a file whose first meaningful line is the
 * version, or an asdf/mise `.tool-versions` file containing a `filemoverexpress <version>` entry.
 */
export function parseVersionFile(content: string, fileName: string): string {
  const lines = content
    .split(/\r?\n/)
    .map(line => line.replace(/#.*$/, '').trim())
    .filter(line => line !== '')

  for (const line of lines) {
    const [name, version] = line.split(/\s+/)
    if (name === TOOL_NAME && version) {
      return version
    }
  }

  const first = lines[0]
  if (first && !/\s/.test(first)) {
    return first
  }
  throw new Error(`No ${TOOL_NAME} version found in '${fileName}'.`)
}

export interface ResolvedRelease {
  version: string
  release: Release
}

export function selectRelease(releases: Release[], spec: VersionSpec, allowPrerelease: boolean): ResolvedRelease {
  const candidates = new Map<string, Release>()
  for (const release of releases) {
    if (release.draft) {
      continue
    }
    const version = semver.valid(semver.clean(release.tag_name))
    if (!version) {
      continue
    }
    if (!allowPrerelease && (release.prerelease || semver.prerelease(version))) {
      continue
    }
    candidates.set(version, release)
  }
  const versions = [...candidates.keys()]

  let version: string | null
  switch (spec.kind) {
    case 'latest':
      version = semver.rsort([...versions])[0] ?? null
      break
    case 'exact':
      version = candidates.has(spec.version) ? spec.version : null
      break
    case 'range':
      version = semver.maxSatisfying(versions, spec.range, { includePrerelease: allowPrerelease })
      break
  }

  if (!version) {
    const wanted = spec.kind === 'latest' ? 'latest' : spec.kind === 'exact' ? spec.version : spec.range
    const available =
      semver
        .rsort([...versions])
        .slice(0, 10)
        .join(', ') || 'none'
    throw new Error(
      `No File Mover Express release matches '${wanted}'. Available versions: ${available}.` +
        (allowPrerelease ? '' : ' Set allow-prerelease: true to include prereleases.')
    )
  }
  return { version, release: candidates.get(version) ?? missingRelease(version) }
}

function missingRelease(version: string): never {
  throw new Error(`Internal error: release ${version} disappeared during resolution.`)
}

/** Returns the highest cached version satisfying the spec, or undefined. */
export function selectCachedVersion(cached: string[], spec: VersionSpec, allowPrerelease: boolean): string | undefined {
  if (spec.kind === 'latest') {
    return undefined
  }
  if (spec.kind === 'exact') {
    if (!allowPrerelease && semver.prerelease(spec.version)) {
      return undefined
    }
    return cached.find(version => semver.eq(version, spec.version))
  }
  const candidates = allowPrerelease ? cached : cached.filter(version => !semver.prerelease(version))
  return semver.maxSatisfying(candidates, spec.range, { includePrerelease: allowPrerelease }) ?? undefined
}
