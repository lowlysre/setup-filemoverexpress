import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import * as path from 'node:path'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as io from '@actions/io'
import type { Target } from './platform.js'
import { tempRoot } from './util.js'

/**
 * Places the CLI binary from a downloaded release asset into `destDir` and returns its path.
 * Nothing is installed system-wide: the DMG is mounted read-only and the NSIS installer is
 * unpacked with 7-Zip instead of being executed.
 */
export async function extractCli(assetPath: string, target: Target, destDir: string): Promise<string> {
  await mkdir(destDir, { recursive: true })
  const binPath = path.join(destDir, target.binaryName)
  switch (target.kind) {
    case 'binary':
      await copyFile(assetPath, binPath)
      break
    case 'dmg':
      await extractFromDmg(assetPath, target.binaryName, binPath)
      break
    case 'nsis':
      await extractFromNsis(assetPath, target.binaryName, destDir)
      break
  }
  if (!existsSync(binPath)) {
    throw new Error(`'${target.binaryName}' wasn't found in release asset '${target.assetName}'.`)
  }
  if (target.platform !== 'win32') {
    await chmod(binPath, 0o755)
  }
  return binPath
}

export async function extractFromDmg(dmgPath: string, binaryName: string, binPath: string): Promise<void> {
  const mountPoint = await mkdtemp(path.join(tempRoot(), 'fme-dmg-'))
  await exec.exec('hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mountPoint, dmgPath], {
    silent: true
  })
  try {
    const app = (await readdir(mountPoint)).find(entry => entry.endsWith('.app'))
    if (!app) {
      throw new Error(`No .app bundle found in '${path.basename(dmgPath)}'.`)
    }
    const source = path.join(mountPoint, app, 'Contents', 'MacOS', binaryName)
    if (!existsSync(source)) {
      throw new Error(`'${app}/Contents/MacOS/${binaryName}' not found in '${path.basename(dmgPath)}'.`)
    }
    await copyFile(source, binPath)
  } finally {
    const code = await exec.exec('hdiutil', ['detach', mountPoint, '-force'], { ignoreReturnCode: true, silent: true })
    if (code !== 0) {
      core.warning(`Couldn't detach ${mountPoint} (hdiutil exit code ${code}).`)
    }
    await rm(mountPoint, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function find7z(): Promise<string> {
  const onPath = await io.which('7z', false)
  if (onPath) {
    return onPath
  }
  const programFiles = [process.env['ProgramFiles'], process.env['ProgramW6432'], 'C:\\Program Files']
  for (const dir of programFiles) {
    if (dir) {
      const candidate = path.join(dir, '7-Zip', '7z.exe')
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }
  throw new Error(
    "7-Zip is required to unpack the File Mover Express installer on Windows but wasn't found. GitHub-hosted Windows runners include it; on self-hosted runners install 7-Zip and add it to PATH."
  )
}

export async function extractFromNsis(installerPath: string, binaryName: string, destDir: string): Promise<void> {
  const sevenZip = await find7z()
  // `e` extracts without paths; listing the file name limits extraction to the CLI binary.
  await exec.exec(sevenZip, ['e', '-y', '-bso0', '-bsp0', `-o${destDir}`, installerPath, binaryName], {
    silent: true
  })
}
