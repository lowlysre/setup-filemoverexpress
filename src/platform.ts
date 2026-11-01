export type Arch = 'x64' | 'arm64'
export type AssetKind = 'binary' | 'dmg' | 'nsis'

export interface Target {
  platform: NodeJS.Platform
  arch: Arch
  /** Upstream release asset that contains the CLI for this platform. */
  assetName: string
  kind: AssetKind
  /** File name of the CLI binary once installed. */
  binaryName: string
}

const ARCH_ALIASES: Record<string, Arch> = {
  x64: 'x64',
  amd64: 'x64',
  x86_64: 'x64',
  arm64: 'arm64',
  aarch64: 'arm64'
}

export function normalizeArch(input: string): Arch {
  const arch = ARCH_ALIASES[input.trim().toLowerCase()]
  if (!arch) {
    throw new Error(`Unsupported architecture '${input}'. File Mover Express publishes builds for x64 and arm64 only.`)
  }
  return arch
}

export function resolveTarget(platform: NodeJS.Platform, arch: Arch): Target {
  switch (platform) {
    case 'linux':
      return {
        platform,
        arch,
        assetName: `filemoverexpress-linux-${arch === 'x64' ? 'amd64' : 'arm64'}`,
        kind: 'binary',
        binaryName: 'filemoverexpress'
      }
    case 'darwin':
      return {
        platform,
        arch,
        assetName: `filemoverexpress-macos-${arch}.dmg`,
        kind: 'dmg',
        binaryName: 'filemoverexpress'
      }
    case 'win32':
      return {
        platform,
        arch,
        assetName: `filemoverexpress-windows-${arch === 'x64' ? 'amd64' : 'arm64'}-installer.exe`,
        kind: 'nsis',
        binaryName: 'filemoverexpress.exe'
      }
    default:
      throw new Error(
        `Unsupported runner platform '${platform}'. File Mover Express supports Linux, macOS, and Windows.`
      )
  }
}
