import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import type * as Fs from 'node:fs'
import type * as Fsp from 'node:fs/promises'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as io from '@actions/io'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractCli, find7z } from '../src/extract.js'
import { resolveTarget } from '../src/platform.js'
import { makeTempDir, removeDir, snapshotEnv } from './helpers.js'

vi.mock('@actions/core', () => ({ info: vi.fn<typeof core.info>(), warning: vi.fn<typeof core.warning>() }))
vi.mock('@actions/exec', () => ({
  exec: vi.fn<typeof exec.exec>(),
  getExecOutput: vi.fn<typeof exec.getExecOutput>()
}))
vi.mock('@actions/io', () => ({ which: vi.fn<typeof io.which>() }))
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof Fs>()
  return { ...actual, existsSync: vi.fn<typeof actual.existsSync>(actual.existsSync) }
})
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof Fsp>()
  return { ...actual, chmod: vi.fn<typeof actual.chmod>(actual.chmod) }
})

const actualFs = await vi.importActual<typeof Fs>('node:fs')
const actualFsp = await vi.importActual<typeof Fsp>('node:fs/promises')

let dir: string
let restoreEnv: () => void

function mountPointOf(args: readonly string[] | undefined): string {
  const list = args ?? []
  return list[list.indexOf('-mountpoint') + 1]
}

/** Fakes `hdiutil attach` by creating the given entries under the mount point. */
function fakeHdiutil(layout: (mountPoint: string) => Promise<void>, detachCode = 0): void {
  vi.mocked(exec.exec).mockImplementation(async (_tool, args) => {
    if (args?.[0] === 'attach') {
      await layout(mountPointOf(args))
      return 0
    }
    return detachCode
  })
}

async function appBinary(mountPoint: string, content = 'MACHO'): Promise<void> {
  const macos = path.join(mountPoint, 'File Mover Express.app', 'Contents', 'MacOS')
  await mkdir(macos, { recursive: true })
  await writeFile(path.join(macos, 'filemoverexpress'), content)
}

function hdiutilCalls(): string[][] {
  return vi.mocked(exec.exec).mock.calls.map(([tool, args]) => [tool].concat(args ?? []))
}

beforeEach(async () => {
  restoreEnv = snapshotEnv()
  dir = await makeTempDir()
  process.env['RUNNER_TEMP'] = dir
  vi.mocked(fs.existsSync).mockImplementation(actualFs.existsSync)
  vi.mocked(fsp.chmod).mockImplementation(actualFsp.chmod)
  vi.mocked(exec.exec).mockResolvedValue(0)
  vi.mocked(io.which).mockResolvedValue('')
})

afterEach(async () => {
  restoreEnv()
  await removeDir(dir)
})

describe('extractCli: binary', () => {
  it.each(['x64', 'arm64'] as const)('copies the linux/%s binary and makes it executable', async arch => {
    const asset = path.join(dir, `filemoverexpress-linux-${arch}`)
    await writeFile(asset, 'ELF-binary')
    const dest = path.join(dir, 'out', 'nested')

    const binPath = await extractCli(asset, resolveTarget('linux', arch), dest)

    expect(binPath).toBe(path.join(dest, 'filemoverexpress'))
    await expect(readFile(binPath, 'utf8')).resolves.toBe('ELF-binary')
    expect(fsp.chmod).toHaveBeenCalledWith(binPath, 0o755)
    expect(exec.exec).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')('sets mode 0755 on the copied binary', async () => {
    const asset = path.join(dir, 'filemoverexpress-linux-amd64')
    await writeFile(asset, 'ELF-binary', { mode: 0o600 })
    const binPath = await extractCli(asset, resolveTarget('linux', 'x64'), path.join(dir, 'out'))
    expect((await stat(binPath)).mode & 0o777).toBe(0o755)
  })
})

describe('extractCli: nsis', () => {
  const target = resolveTarget('win32', 'x64')

  it('extracts only filemoverexpress.exe from the installer with 7-Zip on PATH', async () => {
    const installer = path.join(dir, target.assetName)
    await writeFile(installer, 'MZ-installer')
    const dest = path.join(dir, 'out')
    const sevenZip = path.join(dir, 'bin', '7z')
    vi.mocked(io.which).mockResolvedValue(sevenZip)
    vi.mocked(exec.exec).mockImplementation(async (_tool, args) => {
      const out = (args ?? []).find(arg => arg.startsWith('-o'))?.slice(2) ?? ''
      await writeFile(path.join(out, 'filemoverexpress.exe'), 'MZ-cli')
      return 0
    })

    const binPath = await extractCli(installer, target, dest)

    expect(binPath).toBe(path.join(dest, 'filemoverexpress.exe'))
    await expect(readFile(binPath, 'utf8')).resolves.toBe('MZ-cli')
    expect(io.which).toHaveBeenCalledWith('7z', false)
    expect(exec.exec).toHaveBeenCalledTimes(1)
    expect(exec.exec).toHaveBeenCalledWith(
      sevenZip,
      ['e', '-y', '-bso0', '-bsp0', `-o${dest}`, installer, 'filemoverexpress.exe'],
      { silent: true }
    )
    expect(fsp.chmod).not.toHaveBeenCalled()
  })

  it('throws when the installer does not contain the CLI', async () => {
    vi.mocked(io.which).mockResolvedValue('7z')
    await expect(extractCli(path.join(dir, 'setup.exe'), target, path.join(dir, 'out'))).rejects.toThrow(
      "'filemoverexpress.exe' wasn't found in release asset 'filemoverexpress-windows-amd64-installer.exe'."
    )
  })
})

describe('find7z', () => {
  it('prefers 7z on PATH', async () => {
    vi.mocked(io.which).mockResolvedValue('/usr/bin/7z')
    await expect(find7z()).resolves.toBe('/usr/bin/7z')
  })

  it('falls back to 7-Zip under ProgramFiles', async () => {
    const programFiles = path.join(dir, 'Program Files')
    const sevenZip = path.join(programFiles, '7-Zip', '7z.exe')
    await mkdir(path.dirname(sevenZip), { recursive: true })
    await writeFile(sevenZip, '')
    process.env['ProgramFiles'] = programFiles
    await expect(find7z()).resolves.toBe(sevenZip)
  })

  it('falls back to 7-Zip under ProgramW6432', async () => {
    const programW6432 = path.join(dir, 'PF64')
    const sevenZip = path.join(programW6432, '7-Zip', '7z.exe')
    await mkdir(path.dirname(sevenZip), { recursive: true })
    await writeFile(sevenZip, '')
    process.env['ProgramFiles'] = path.join(dir, 'empty')
    process.env['ProgramW6432'] = programW6432
    await expect(find7z()).resolves.toBe(sevenZip)
  })

  it('throws a helpful error when 7-Zip is missing', async () => {
    delete process.env['ProgramFiles']
    delete process.env['ProgramW6432']
    vi.mocked(fs.existsSync).mockImplementation(candidate =>
      String(candidate).endsWith('7z.exe') ? false : actualFs.existsSync(candidate)
    )
    await expect(find7z()).rejects.toThrow('7-Zip is required to unpack the File Mover Express installer')
    expect(vi.mocked(fs.existsSync).mock.calls.map(call => String(call[0]))).toContain(
      path.join('C:\\Program Files', '7-Zip', '7z.exe')
    )
  })
})

describe('extractCli: dmg', () => {
  const target = resolveTarget('darwin', 'arm64')

  it('mounts read-only, copies the CLI out of the app bundle, and detaches', async () => {
    const dmg = path.join(dir, target.assetName)
    const dest = path.join(dir, 'out')
    fakeHdiutil(async mountPoint => {
      await mkdir(path.join(mountPoint, '.background'), { recursive: true })
      await fsp.symlink('/Applications', path.join(mountPoint, 'Applications')).catch(() => undefined)
      await appBinary(mountPoint)
    })

    const binPath = await extractCli(dmg, target, dest)

    expect(binPath).toBe(path.join(dest, 'filemoverexpress'))
    await expect(readFile(binPath, 'utf8')).resolves.toBe('MACHO')
    const calls = hdiutilCalls()
    expect(calls).toHaveLength(2)
    const mountPoint = calls[0][6]
    expect(path.dirname(mountPoint)).toBe(dir)
    expect(path.basename(mountPoint)).toMatch(/^fme-dmg-/)
    expect(calls[0]).toEqual([
      'hdiutil',
      'attach',
      '-readonly',
      '-nobrowse',
      '-noautoopen',
      '-mountpoint',
      mountPoint,
      dmg
    ])
    expect(calls[1]).toEqual(['hdiutil', 'detach', mountPoint, '-force'])
    expect(vi.mocked(exec.exec).mock.calls[1][2]).toMatchObject({ ignoreReturnCode: true })
    expect(fsp.chmod).toHaveBeenCalledWith(binPath, 0o755)
    expect(actualFs.existsSync(mountPoint)).toBe(false)
    expect(core.warning).not.toHaveBeenCalled()
  })

  it('detaches even when the binary is missing from the app bundle', async () => {
    fakeHdiutil(async mountPoint => {
      await mkdir(path.join(mountPoint, 'File Mover Express.app', 'Contents', 'MacOS'), { recursive: true })
    })
    await expect(extractCli(path.join(dir, target.assetName), target, path.join(dir, 'out'))).rejects.toThrow(
      "'File Mover Express.app/Contents/MacOS/filemoverexpress' not found in 'filemoverexpress-macos-arm64.dmg'."
    )
    const calls = hdiutilCalls()
    expect(calls.map(call => call[1])).toEqual(['attach', 'detach'])
    expect(actualFs.existsSync(calls[1][2])).toBe(false)
  })

  it('detaches and fails when the image has no .app bundle', async () => {
    fakeHdiutil(async mountPoint => {
      await writeFile(path.join(mountPoint, 'README.txt'), 'hi')
    })
    await expect(extractCli(path.join(dir, target.assetName), target, path.join(dir, 'out'))).rejects.toThrow(
      "No .app bundle found in 'filemoverexpress-macos-arm64.dmg'."
    )
    expect(hdiutilCalls().map(call => call[1])).toEqual(['attach', 'detach'])
  })

  it('warns when hdiutil detach fails but still returns the binary', async () => {
    fakeHdiutil(appBinary, 16)
    const binPath = await extractCli(path.join(dir, target.assetName), target, path.join(dir, 'out'))
    await expect(readFile(binPath, 'utf8')).resolves.toBe('MACHO')
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringMatching(/^Couldn't detach .*fme-dmg-.* \(hdiutil exit code 16\)\.$/)
    )
  })

  it('does not leave mount points behind in RUNNER_TEMP', async () => {
    fakeHdiutil(appBinary)
    await extractCli(path.join(dir, target.assetName), target, path.join(dir, 'out'))
    expect((await readdir(dir)).filter(entry => entry.startsWith('fme-dmg-'))).toEqual([])
  })
})
