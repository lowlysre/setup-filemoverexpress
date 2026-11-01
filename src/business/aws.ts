import { AWS_ENV } from '../constants.js'

export { AWS_ENV } from '../constants.js'

type Env = NodeJS.ProcessEnv

export type RegionSource = 'input' | 'AWS_REGION' | 'AWS_DEFAULT_REGION' | 'aws-config-file'

export interface ResolvedRegion {
  region: string
  source: RegionSource
}

/** The profile the AWS SDK would use: explicit input, then `AWS_PROFILE`, then `default`. */
export function effectiveProfile(awsProfileInput: string, env: Env = process.env): string {
  return awsProfileInput || env[AWS_ENV.profile] || 'default'
}

/** Reads `region` for a profile from an AWS shared config file (`[default]` / `[profile name]`). */
export function parseRegionFromAwsConfig(content: string, profile: string): string | undefined {
  const wanted = profile === 'default' ? ['default', 'profile default'] : [`profile ${profile}`]
  let inSection = false
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/[#;].*$/, '').trim()
    if (line === '') {
      continue
    }
    const section = /^\[\s*(.+?)\s*\]$/.exec(line)
    if (section) {
      inSection = wanted.includes(section[1].replace(/\s+/g, ' '))
      continue
    }
    if (inSection) {
      const kv = /^region\s*=\s*(\S+)$/.exec(line)
      if (kv) {
        return kv[1]
      }
    }
  }
  return undefined
}

/** Resolves the region from action inputs, credential-action environment variables, and parsed config. */
export function resolveRegionFromSources(
  regionInput: string,
  awsProfileInput: string,
  env: Env = process.env,
  configContent?: string
): ResolvedRegion | undefined {
  if (regionInput) {
    return { region: regionInput, source: 'input' }
  }
  const envRegion = env[AWS_ENV.region]
  if (envRegion) {
    return { region: envRegion, source: 'AWS_REGION' }
  }
  const envDefaultRegion = env[AWS_ENV.defaultRegion]
  if (envDefaultRegion) {
    return { region: envDefaultRegion, source: 'AWS_DEFAULT_REGION' }
  }
  if (configContent !== undefined) {
    const region = parseRegionFromAwsConfig(configContent, effectiveProfile(awsProfileInput, env))
    if (region) {
      return { region, source: 'aws-config-file' }
    }
  }
  return undefined
}

/** True when the environment looks like it carries AWS credentials the SDK can find. */
export function hasCredentialHints(awsProfileInput: string, env: Env = process.env): boolean {
  return Boolean(
    awsProfileInput || env[AWS_ENV.accessKeyId] || env[AWS_ENV.profile] || env[AWS_ENV.webIdentityTokenFile]
  )
}
