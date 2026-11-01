import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import * as path from 'node:path'
import { resolveRegionFromSources } from './business/aws.js'
import { AWS_ENV } from './constants.js'

export { AWS_ENV } from './constants.js'
export {
  effectiveProfile,
  hasCredentialHints,
  parseRegionFromAwsConfig,
  resolveRegionFromSources
} from './business/aws.js'
export type { RegionSource, ResolvedRegion } from './business/aws.js'

type Env = NodeJS.ProcessEnv

export function awsConfigFilePath(env: Env = process.env): string {
  return env[AWS_ENV.configFile] || path.join(homedir(), '.aws', 'config')
}

/** Reads the optional AWS shared config file and delegates region selection to pure business logic. */
export function resolveRegion(
  regionInput: string,
  awsProfileInput: string,
  env: Env = process.env
): ReturnType<typeof resolveRegionFromSources> {
  const resolved = resolveRegionFromSources(regionInput, awsProfileInput, env)
  if (resolved) {
    return resolved
  }
  let configContent: string | undefined
  const configFile = awsConfigFilePath(env)
  if (existsSync(configFile)) {
    configContent = readFileSync(configFile, 'utf8')
  }
  return resolveRegionFromSources(regionInput, awsProfileInput, env, configContent)
}
