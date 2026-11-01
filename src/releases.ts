import { HttpClient, HttpClientError } from '@actions/http-client'
import { GITHUB_API_URL, UPSTREAM_OWNER, UPSTREAM_REPO } from './constants.js'

export interface ReleaseAsset {
  name: string
  browser_download_url: string
  size: number
  /** GitHub-computed digest of the uploaded asset, e.g. `sha256:<hex>`. */
  digest?: string | null
}

export interface Release {
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: ReleaseAsset[]
}

const PER_PAGE = 100
const MAX_PAGES = 10

export interface ReleaseHttpClient {
  getJson(url: string, headers: Record<string, string>): Promise<{ result: Release[] | null | undefined }>
}

export function createHttpClient(): HttpClient {
  return new HttpClient('setup-filemoverexpress', [], {
    allowRetries: true,
    maxRetries: 3
  })
}

export async function listReleases(token: string, client?: ReleaseHttpClient): Promise<Release[]> {
  const releaseClient = client ?? createReleaseHttpClient()
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const releases: Release[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${GITHUB_API_URL}/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/releases?per_page=${PER_PAGE}&page=${page}`
    let result: Release[] | null
    try {
      // Pages are fetched sequentially because each response decides whether another page exists.
      // oxlint-disable-next-line no-await-in-loop
      const response = await releaseClient.getJson(url, headers)
      result = response.result ?? null
    } catch (error) {
      throw new Error(describeApiError(error, token), { cause: error })
    }
    if (!result || result.length === 0) {
      break
    }
    releases.push(...result)
    if (result.length < PER_PAGE) {
      break
    }
  }
  return releases
}

function createReleaseHttpClient(): ReleaseHttpClient {
  const client = createHttpClient()
  return {
    getJson: async (url, headers) => {
      const response = await client.getJson<Release[]>(url, headers)
      return { result: response.result ?? null }
    }
  }
}

function describeApiError(error: unknown, token: string): string {
  const message = error instanceof Error ? error.message : String(error)
  const status = error instanceof HttpClientError ? error.statusCode : undefined
  let hint = ''
  if ((status === 403 || status === 429) && !token) {
    hint = ' The unauthenticated GitHub API rate limit was likely exceeded; pass a token through the `token` input.'
  } else if (status === 401) {
    hint = ' The `token` input was rejected by api.github.com; on GitHub Enterprise Server leave `token` empty.'
  }
  return `Failed to list ${UPSTREAM_OWNER}/${UPSTREAM_REPO} releases (HTTP ${status ?? 'error'}): ${message}.${hint}`
}
