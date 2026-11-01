import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { Release } from '../src/releases.js'

export const FIXTURES = path.join(import.meta.dirname, 'fixtures')

export function fixturePath(name: string): string {
  return path.join(FIXTURES, name)
}

export function loadReleases(): Release[] {
  const value: unknown = JSON.parse(readFileSync(fixturePath('releases.json'), 'utf8'))
  if (!Array.isArray(value) || !value.every(isRelease)) {
    throw new Error('The releases fixture has an invalid shape.')
  }
  return value
}

function isRelease(value: unknown): value is Release {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return (
    'tag_name' in value &&
    typeof value.tag_name === 'string' &&
    'draft' in value &&
    typeof value.draft === 'boolean' &&
    'prerelease' in value &&
    typeof value.prerelease === 'boolean' &&
    'assets' in value &&
    Array.isArray(value.assets) &&
    value.assets.every(isReleaseAsset)
  )
}

function isReleaseAsset(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return (
    'name' in value &&
    typeof value.name === 'string' &&
    'browser_download_url' in value &&
    typeof value.browser_download_url === 'string' &&
    'size' in value &&
    typeof value.size === 'number'
  )
}

export async function makeTempDir(prefix = 'fme-test-'): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix))
}

export async function removeDir(dir: string | undefined): Promise<void> {
  if (dir) {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Snapshots process.env and returns a function that restores it exactly. */
export function snapshotEnv(): () => void {
  const saved = { ...process.env }
  return () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) {
        delete process.env[key]
      }
    }
    for (const [key, value] of Object.entries(saved)) {
      process.env[key] = value
    }
  }
}

/** Removes the given variables (case-insensitively, for Windows) from process.env. */
export function unsetEnv(...names: string[]): void {
  const wanted = new Set(names.map(name => name.toLowerCase()))
  for (const key of Object.keys(process.env)) {
    if (wanted.has(key.toLowerCase())) {
      delete process.env[key]
    }
  }
}
