import { describe, expect, it } from 'vitest'
import { normalizeArch, resolveTarget, type Arch } from '../src/platform.js'

describe('normalizeArch', () => {
  it.each([
    ['x64', 'x64'],
    ['amd64', 'x64'],
    ['x86_64', 'x64'],
    ['X64', 'x64'],
    ['arm64', 'arm64'],
    ['aarch64', 'arm64'],
    ['AARCH64', 'arm64'],
    [' arm64 ', 'arm64']
  ])('maps %j to %s', (input, expected) => {
    expect(normalizeArch(input)).toBe(expected)
  })

  it.each(['ia32', 's390x', 'arm', 'ppc64', ''])('rejects %j', input => {
    expect(() => normalizeArch(input)).toThrow(`Unsupported architecture '${input}'`)
  })

  it('explains which architectures are published', () => {
    expect(() => normalizeArch('ia32')).toThrow('x64 and arm64 only')
  })
})

describe('resolveTarget', () => {
  it.each<[NodeJS.Platform, Arch, string, string, string]>([
    ['linux', 'x64', 'filemoverexpress-linux-amd64', 'binary', 'filemoverexpress'],
    ['linux', 'arm64', 'filemoverexpress-linux-arm64', 'binary', 'filemoverexpress'],
    ['darwin', 'x64', 'filemoverexpress-macos-x64.dmg', 'dmg', 'filemoverexpress'],
    ['darwin', 'arm64', 'filemoverexpress-macos-arm64.dmg', 'dmg', 'filemoverexpress'],
    ['win32', 'x64', 'filemoverexpress-windows-amd64-installer.exe', 'nsis', 'filemoverexpress.exe'],
    ['win32', 'arm64', 'filemoverexpress-windows-arm64-installer.exe', 'nsis', 'filemoverexpress.exe']
  ])('%s/%s → %s', (platform, arch, assetName, kind, binaryName) => {
    expect(resolveTarget(platform, arch)).toEqual({ platform, arch, assetName, kind, binaryName })
  })

  it.each<NodeJS.Platform>(['freebsd', 'aix', 'openbsd', 'sunos'])('rejects platform %s', platform => {
    expect(() => resolveTarget(platform, 'x64')).toThrow(`Unsupported runner platform '${platform}'`)
  })
})
