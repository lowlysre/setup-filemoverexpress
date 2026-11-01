import { HttpClient, HttpClientError } from '@actions/http-client'
import { describe, expect, it, vi } from 'vitest'
import { createHttpClient, listReleases, type Release, type ReleaseHttpClient } from '../src/releases.js'
import { loadReleases } from './helpers.js'

const BASE = 'https://api.github.com/repos/awslabs/filemoverexpress/releases'

type GetJson = (url: string, headers: Record<string, string>) => Promise<{ result: Release[] | null }>

function fakeClient(...pages: (Release[] | null | Error)[]): {
  client: ReleaseHttpClient
  getJson: ReturnType<typeof vi.fn<GetJson>>
} {
  const getJson = vi.fn<GetJson>()
  for (const page of pages) {
    if (page instanceof Error) {
      getJson.mockRejectedValueOnce(page)
    } else {
      getJson.mockResolvedValueOnce({ result: page })
    }
  }
  return { client: { getJson }, getJson }
}

function releasesOf(count: number, offset = 0): Release[] {
  return Array.from({ length: count }, (_, i) => ({
    tag_name: `0.${offset + i}.0`,
    draft: false,
    prerelease: false,
    assets: []
  }))
}

describe('listReleases', () => {
  it('returns a single page', async () => {
    const fixture = loadReleases()
    const { client, getJson } = fakeClient(fixture)
    await expect(listReleases('', client)).resolves.toEqual(fixture)
    expect(getJson).toHaveBeenCalledTimes(1)
    expect(getJson.mock.calls[0][0]).toBe(`${BASE}?per_page=100&page=1`)
  })

  it('follows pagination until a short page', async () => {
    const { client, getJson } = fakeClient(releasesOf(100), releasesOf(3, 100))
    const releases = await listReleases('', client)
    expect(releases).toHaveLength(103)
    expect(releases[102].tag_name).toBe('0.102.0')
    expect(getJson.mock.calls.map(call => call[0])).toEqual([
      `${BASE}?per_page=100&page=1`,
      `${BASE}?per_page=100&page=2`
    ])
  })

  it('stops when a full page is followed by an empty page', async () => {
    const { client, getJson } = fakeClient(releasesOf(100), [])
    await expect(listReleases('', client)).resolves.toHaveLength(100)
    expect(getJson).toHaveBeenCalledTimes(2)
  })

  it('stops after 10 pages', async () => {
    const getJson = vi.fn<GetJson>().mockImplementation(async () => ({ result: releasesOf(100) }))
    await expect(listReleases('', { getJson })).resolves.toHaveLength(1000)
    expect(getJson).toHaveBeenCalledTimes(10)
  })

  it.each([[[]], [null]])('returns an empty list for %j', async page => {
    const { client } = fakeClient(page)
    await expect(listReleases('', client)).resolves.toEqual([])
  })

  it('sends the API version and Accept headers without Authorization when no token is given', async () => {
    const { client, getJson } = fakeClient([])
    await listReleases('', client)
    const headers = getJson.mock.calls[0][1]
    expect(headers).toEqual({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' })
    expect(headers).not.toHaveProperty('Authorization')
  })

  it('sends the token as a bearer Authorization header on every page', async () => {
    const { client, getJson } = fakeClient(releasesOf(100), [])
    await listReleases('ghs_example', client)
    for (const [, headers] of getJson.mock.calls) {
      expect(headers).toEqual({
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: 'Bearer ghs_example'
      })
    }
  })

  it.each([403, 429])('adds a rate-limit hint for HTTP %i without a token', async status => {
    const error = new HttpClientError('API rate limit exceeded', status)
    const { client } = fakeClient(error)
    const promise = listReleases('', client)
    await expect(promise).rejects.toThrow(
      `Failed to list awslabs/filemoverexpress releases (HTTP ${status}): API rate limit exceeded. The unauthenticated GitHub API rate limit was likely exceeded; pass a token through the \`token\` input.`
    )
    await expect(promise).rejects.toHaveProperty('cause', error)
  })

  it('omits the rate-limit hint for 403 when a token was used', async () => {
    const { client } = fakeClient(new HttpClientError('Forbidden', 403))
    await expect(listReleases('ghs_example', client)).rejects.toThrow(
      'Failed to list awslabs/filemoverexpress releases (HTTP 403): Forbidden.'
    )
  })

  it('adds a GHES hint for 401', async () => {
    const { client } = fakeClient(new HttpClientError('Bad credentials', 401))
    await expect(listReleases('ghs_wrong', client)).rejects.toThrow(
      'Failed to list awslabs/filemoverexpress releases (HTTP 401): Bad credentials. The `token` input was rejected by api.github.com; on GitHub Enterprise Server leave `token` empty.'
    )
  })

  it('maps generic errors without a status', async () => {
    const { client } = fakeClient(new Error('getaddrinfo ENOTFOUND api.github.com'))
    await expect(listReleases('', client)).rejects.toThrow(
      'Failed to list awslabs/filemoverexpress releases (HTTP error): getaddrinfo ENOTFOUND api.github.com.'
    )
  })

  it('maps non-Error rejections', async () => {
    const getJson = vi.fn<GetJson>().mockRejectedValue('socket hang up')
    await expect(listReleases('', { getJson })).rejects.toThrow(
      'Failed to list awslabs/filemoverexpress releases (HTTP error): socket hang up.'
    )
  })

  it('maps other HTTP status codes without a hint', async () => {
    const { client } = fakeClient(new HttpClientError('Server Error', 500))
    await expect(listReleases('', client)).rejects.toThrow(
      'Failed to list awslabs/filemoverexpress releases (HTTP 500): Server Error.'
    )
  })
})

describe('createHttpClient', () => {
  it('creates an HttpClient with a user agent', () => {
    const client = createHttpClient()
    expect(client).toBeInstanceOf(HttpClient)
    expect(client.userAgent).toBe('setup-filemoverexpress')
  })
})
