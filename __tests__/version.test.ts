import semver from 'semver'
import { describe, expect, it } from 'vitest'
import type { Release } from '../src/releases.js'
import { parseVersionFile, parseVersionSpec, selectCachedVersion, selectRelease } from '../src/version.js'
import { loadReleases } from './helpers.js'

function thrownMessage(action: () => void): string {
  try {
    action()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return ''
}

describe('parseVersionSpec', () => {
  it.each(['', 'latest', 'LATEST', 'Latest', '  latest  ', '   '])('treats %j as latest', input => {
    expect(parseVersionSpec(input)).toEqual({ kind: 'latest' })
  })

  it.each([
    ['1.1.1', '1.1.1'],
    ['v1.1.1', '1.1.1'],
    [' 1.0.0 ', '1.0.0'],
    ['1.2.0-rc.1', '1.2.0-rc.1']
  ])('parses %j as exact %s', (input, version) => {
    expect(parseVersionSpec(input)).toEqual({ kind: 'exact', version })
  })

  it.each([
    ['1.1', ['1.1.0', '1.1.1'], ['1.0.0', '1.2.0']],
    ['1.x', ['1.0.0', '1.1.1'], ['2.0.0']],
    ['v1.x', ['1.0.0', '1.1.1'], ['2.0.0']],
    ['^1.0.0', ['1.0.0', '1.9.9'], ['0.9.0', '2.0.0']],
    ['>=1.0 <2', ['1.0.0', '1.1.1'], ['0.9.9', '2.0.0']],
    ['~1.1.0', ['1.1.0', '1.1.1'], ['1.2.0']]
  ])('parses %j as a range', (input, inside, outside) => {
    const spec = parseVersionSpec(input)
    expect(spec.kind).toBe('range')
    if (spec.kind !== 'range') {
      return
    }
    for (const version of inside) {
      expect(semver.satisfies(version, spec.range), `${version} in ${spec.range}`).toBe(true)
    }
    for (const version of outside) {
      expect(semver.satisfies(version, spec.range), `${version} not in ${spec.range}`).toBe(false)
    }
  })

  it.each(['garbage', 'not-a-version', '1.1.1.1.1', 'latest-ish', '>=banana'])('rejects %j', input => {
    expect(() => parseVersionSpec(input)).toThrow(`Invalid filemoverexpress-version '${input}'`)
  })
})

describe('parseVersionFile', () => {
  it('reads a bare version', () => {
    expect(parseVersionFile('1.1.1\n', '.filemoverexpress-version')).toBe('1.1.1')
  })

  it('skips comments and blank lines', () => {
    expect(parseVersionFile('# pinned for CI\n\n   \n  1.1.0  # trailing comment\n1.0.0\n', 'v.txt')).toBe('1.1.0')
  })

  it('handles CRLF line endings', () => {
    expect(parseVersionFile('# comment\r\n\r\n1.1.1\r\n', 'v.txt')).toBe('1.1.1')
  })

  it('reads .tool-versions with other tools before and after', () => {
    const content = 'nodejs 24.11.0\npython 3.13.1\nfilemoverexpress 1.1.0\nterraform 1.9.8\n'
    expect(parseVersionFile(content, '.tool-versions')).toBe('1.1.0')
  })

  it('reads .tool-versions with CRLF, tabs, and comments', () => {
    const content = '# tools\r\nnodejs\t24.11.0\r\nfilemoverexpress\t1.1.1 # pinned\r\n'
    expect(parseVersionFile(content, '.tool-versions')).toBe('1.1.1')
  })

  it('reads .tool-versions when filemoverexpress is the first entry', () => {
    expect(parseVersionFile('filemoverexpress 1.0.0\nnodejs 24.11.0\n', '.tool-versions')).toBe('1.0.0')
  })

  it('throws when .tool-versions has no filemoverexpress entry', () => {
    expect(() => parseVersionFile('nodejs 24.11.0\npython 3.13.1\n', '.tool-versions')).toThrow(
      "No filemoverexpress version found in '.tool-versions'."
    )
  })

  it.each(['', '\n\n', '# only a comment\n', '   \r\n  '])('throws for empty content %j', content => {
    expect(() => parseVersionFile(content, 'v.txt')).toThrow("No filemoverexpress version found in 'v.txt'.")
  })
})

describe('selectRelease', () => {
  const releases = loadReleases()

  it('picks the highest stable release for latest', () => {
    const resolved = selectRelease(releases, { kind: 'latest' }, false)
    expect(resolved.version).toBe('1.1.1')
    expect(resolved.release.tag_name).toBe('1.1.1')
    expect(resolved.release.assets.length).toBe(6)
  })

  it('ignores the order of releases from the API', () => {
    expect(selectRelease(releases.toReversed(), { kind: 'latest' }, false).version).toBe('1.1.1')
  })

  it('picks an exact version', () => {
    const resolved = selectRelease(releases, parseVersionSpec('1.1.0'), false)
    expect(resolved.version).toBe('1.1.0')
    expect(resolved.release.tag_name).toBe('1.1.0')
  })

  it('accepts a v-prefixed exact version against unprefixed tags', () => {
    expect(selectRelease(releases, parseVersionSpec('v1.0.0'), false).release.tag_name).toBe('1.0.0')
  })

  it.each([
    ['1.x', '1.1.1'],
    ['^1.0.0', '1.1.1'],
    ['1.0', '1.0.0'],
    ['>=1.0 <1.1.1', '1.1.0'],
    ['~1.1.0', '1.1.1']
  ])('resolves range %s to %s', (range, version) => {
    expect(selectRelease(releases, parseVersionSpec(range), false).version).toBe(version)
  })

  it('never selects a draft release', () => {
    expect(() => selectRelease(releases, parseVersionSpec('1.3.0'), true)).toThrow(
      "No File Mover Express release matches '1.3.0'"
    )
  })

  it('excludes prereleases unless allowed', () => {
    expect(() => selectRelease(releases, parseVersionSpec('1.2.0-rc.1'), false)).toThrow(/matches '1\.2\.0-rc\.1'/)
    expect(selectRelease(releases, parseVersionSpec('1.2.0-rc.1'), true).version).toBe('1.2.0-rc.1')
  })

  it('includes prereleases for latest and ranges when allowed', () => {
    expect(selectRelease(releases, { kind: 'latest' }, true).version).toBe('1.2.0-rc.1')
    expect(selectRelease(releases, parseVersionSpec('^1.0.0'), true).version).toBe('1.2.0-rc.1')
  })

  it('excludes semver-prerelease tags even when the release is not flagged as prerelease', () => {
    const unflagged: Release[] = [
      { tag_name: '2.0.0-beta.1', draft: false, prerelease: false, assets: [] },
      { tag_name: '1.0.0', draft: false, prerelease: false, assets: [] }
    ]
    expect(selectRelease(unflagged, { kind: 'latest' }, false).version).toBe('1.0.0')
  })

  it('skips non-semver tags such as nightly', () => {
    const resolved = selectRelease(releases, { kind: 'latest' }, true)
    expect(resolved.release.tag_name).not.toBe('nightly')
  })

  it('includes a prerelease at the lower boundary of a wildcard range when prereleases are allowed', () => {
    expect(selectRelease(releases, parseVersionSpec('1.2.x'), true).version).toBe('1.2.0-rc.1')
    expect(() => selectRelease(releases, parseVersionSpec('1.2.x'), false)).toThrow(/matches '1\.2\.x'/)
  })

  it('lists available versions when nothing matches', () => {
    expect(() => selectRelease(releases, parseVersionSpec('2.x'), false)).toThrow(
      "No File Mover Express release matches '2.x'. Available versions: 1.1.1, 1.1.0, 1.0.0. Set allow-prerelease: true to include prereleases."
    )
  })

  it('omits the prerelease hint when prereleases are already allowed', () => {
    const message = thrownMessage(() => {
      selectRelease(releases, parseVersionSpec('9.9.9'), true)
    })
    expect(message).toBe(
      "No File Mover Express release matches '9.9.9'. Available versions: 1.2.0-rc.1, 1.1.1, 1.1.0, 1.0.0."
    )
  })

  it('reports none when there are no usable releases', () => {
    expect(() => selectRelease([], { kind: 'latest' }, false)).toThrow(
      "No File Mover Express release matches 'latest'. Available versions: none."
    )
  })

  it('caps the list of available versions at 10', () => {
    const many: Release[] = Array.from({ length: 15 }, (_, i) => ({
      tag_name: `1.${i}.0`,
      draft: false,
      prerelease: false,
      assets: []
    }))
    const message = thrownMessage(() => {
      selectRelease(many, parseVersionSpec('3.0.0'), false)
    })
    expect(message).toContain('Available versions: 1.14.0, 1.13.0,')
    expect(message).toContain('1.5.0.')
    expect(message).not.toContain('1.4.0')
  })
})

describe('selectCachedVersion', () => {
  const cached = ['1.0.0', '1.1.0', '1.1.1', '1.2.0-rc.1']

  it('never resolves latest from the cache', () => {
    expect(selectCachedVersion(cached, { kind: 'latest' }, false)).toBeUndefined()
  })

  it('finds an exact version', () => {
    expect(selectCachedVersion(cached, { kind: 'exact', version: '1.1.0' }, false)).toBe('1.1.0')
  })

  it('ignores a cached exact prerelease unless prereleases are allowed', () => {
    const spec = { kind: 'exact', version: '1.2.0-rc.1' } as const
    expect(selectCachedVersion(cached, spec, false)).toBeUndefined()
    expect(selectCachedVersion(cached, spec, true)).toBe('1.2.0-rc.1')
  })

  it('returns undefined for an exact version not in the cache', () => {
    expect(selectCachedVersion(cached, { kind: 'exact', version: '1.0.1' }, false)).toBeUndefined()
  })

  it('picks the highest cached version satisfying a range', () => {
    expect(selectCachedVersion(cached, parseVersionSpec('1.x'), false)).toBe('1.1.1')
    expect(selectCachedVersion(cached, parseVersionSpec('1.0'), false)).toBe('1.0.0')
  })

  it('includes cached prereleases only when allowed', () => {
    expect(selectCachedVersion(cached, parseVersionSpec('^1.0.0'), true)).toBe('1.2.0-rc.1')
  })

  it('ignores a cached prerelease inside a prerelease range unless prereleases are allowed', () => {
    const spec = parseVersionSpec('>=1.2.0-rc.1 <1.2.0')
    expect(selectCachedVersion(['1.2.0-rc.2'], spec, false)).toBeUndefined()
    expect(selectCachedVersion(['1.2.0-rc.2'], spec, true)).toBe('1.2.0-rc.2')
  })

  it('ignores a cached prerelease inside a wildcard range unless prereleases are allowed', () => {
    expect(selectCachedVersion(['1.2.0-rc.1'], parseVersionSpec('1.2.x'), false)).toBeUndefined()
    expect(selectCachedVersion(['1.2.0-rc.1'], parseVersionSpec('1.2.x'), true)).toBe('1.2.0-rc.1')
  })

  it('returns undefined when no cached version satisfies the range', () => {
    expect(selectCachedVersion(cached, parseVersionSpec('2.x'), false)).toBeUndefined()
    expect(selectCachedVersion([], parseVersionSpec('1.x'), false)).toBeUndefined()
  })
})
