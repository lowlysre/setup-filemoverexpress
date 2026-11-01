export const TOOL_NAME = 'filemoverexpress'
export const UPSTREAM_OWNER = 'awslabs'
export const UPSTREAM_REPO = 'filemoverexpress'
export const GITHUB_API_URL = 'https://api.github.com'

/** Apple Developer Team ID that signs the upstream macOS builds (AMZN Mobile LLC). */
export const APPLE_TEAM_ID = '94KV3E626L'
/** Organization (`O=`) in the Authenticode signer certificate of the upstream Windows installers. */
export const WINDOWS_SIGNER_ORG = 'Amazon Web Services, Inc.'

export const CONFIG_FILE_NAME = 'configuration.yaml'
export const CONFIG_DIR_ENV = 'FME_CONFIG_DIR'
export const DEFAULT_TRANSFER_PROFILE = 'default'
/** Newest upstream release known to ignore the `accelerated` transfer profile setting when building its S3 client. */
export const LAST_VERSION_IGNORING_ACCELERATION = '1.1.1'
export const AWS_ENV = {
  region: 'AWS_REGION',
  defaultRegion: 'AWS_DEFAULT_REGION',
  profile: 'AWS_PROFILE',
  configFile: 'AWS_CONFIG_FILE',
  accessKeyId: 'AWS_ACCESS_KEY_ID',
  webIdentityTokenFile: 'AWS_WEB_IDENTITY_TOKEN_FILE'
} as const

export const CHECKSUM_ALGORITHMS = ['none', 'md5-hex', 'xxhash', 'xxhash64', 'xxh3'] as const
export type ChecksumAlgorithm = (typeof CHECKSUM_ALGORITHMS)[number]

export const STORAGE_CLASSES = [
  'standard',
  'reduced_redundancy',
  'standard_ia',
  'onezone_ia',
  'intelligent_tiering',
  'glacier',
  'deep_archive',
  'glacier_ir'
] as const
export type StorageClass = (typeof STORAGE_CLASSES)[number]
