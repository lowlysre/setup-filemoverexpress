import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { CONFIG_FILE_NAME } from './constants.js'
import { mergeTransferProfile, type TransferProfileOptions } from './business/config.js'

export {
  buildTransferProfile,
  mergeTransferProfile,
  parseChecksumAlgorithm,
  parseStorageClass,
  validateAwsProfile,
  validateBucket,
  validateEndpoint,
  validateProfileName,
  validateRegion
} from './business/config.js'
export type { TransferProfileOptions } from './business/config.js'

export function configFilePath(configDir: string): string {
  return path.join(configDir, CONFIG_FILE_NAME)
}

/** Persists the updated profile document with restrictive permissions. */
export async function writeTransferProfile(configDir: string, options: TransferProfileOptions): Promise<string> {
  const file = configFilePath(configDir)
  await mkdir(configDir, { recursive: true, mode: 0o700 })
  const existing = existsSync(file) ? await readFile(file, 'utf8') : ''
  const updated = mergeTransferProfile(existing, options, file)
  await writeFile(file, updated, { mode: 0o600 })
  await chmod(file, 0o600).catch(() => undefined)
  return file
}
