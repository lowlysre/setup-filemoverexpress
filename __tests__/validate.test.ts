import * as exec from '@actions/exec'
import type { getExecOutput } from '@actions/exec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AWS_ENV } from '../src/business/aws.js'
import { CONFIG_DIR_ENV } from '../src/constants.js'
import { credentialValidationError, credentialsValidated, failureDetail, stripAnsi } from '../src/business/validate.js'
import { validateCredentials } from '../src/validate.js'

vi.mock('@actions/exec', () => ({
  getExecOutput: vi.fn<typeof getExecOutput>()
}))

const savedEnv = { ...process.env }

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) {
      delete process.env[key]
    }
  }
  for (const [key, value] of Object.entries(savedEnv)) {
    process.env[key] = value
  }
}

function clearCredentialEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (
      [AWS_ENV.profile, AWS_ENV.accessKeyId, AWS_ENV.webIdentityTokenFile].some(
        name => key.toLowerCase() === name.toLowerCase()
      )
    ) {
      delete process.env[key]
    }
  }
}

beforeEach(() => {
  clearCredentialEnv()
  vi.mocked(exec.getExecOutput).mockReset()
})

afterEach(() => {
  restoreEnv()
  vi.restoreAllMocks()
})

describe('stripAnsi', () => {
  it('removes ANSI color sequences while preserving ordinary text', () => {
    expect(stripAnsi('\u001b[31mERROR\u001b[0m: denied')).toBe('ERROR: denied')
    expect(stripAnsi('ordinary text')).toBe('ordinary text')
  })
})

describe('credentialsValidated', () => {
  it('matches the requested profile after stripping ANSI codes', () => {
    expect(credentialsValidated('\u001b[32mValidated credentials for prod\u001b[0m\n', 'prod')).toBe(true)
  })

  it('treats profile contents as literal regex text and requires the exact profile', () => {
    const profile = 'prod.[a]+(west)'
    expect(credentialsValidated(`Validated credentials for ${profile}`, profile)).toBe(true)
    expect(credentialsValidated('Validated credentials for prodXaaawest', profile)).toBe(false)
    expect(credentialsValidated('Validated credentials for another', profile)).toBe(false)
  })

  it('does not accept a matching profile followed by extra text', () => {
    expect(credentialsValidated('Validated credentials for prod-suffix', 'prod')).toBe(false)
  })
})

describe('failureDetail', () => {
  it('extracts warning/error/fatal lines and removes ANSI formatting', () => {
    expect(
      failureDetail('informational\n\u001b[33mWARNING: unavailable\u001b[0m\n  ERROR: denied\nFATAL: stopped')
    ).toBe('WARNING: unavailable\nERROR: denied\nFATAL: stopped')
  })

  it('returns trimmed output when there are no warning/error/fatal lines', () => {
    expect(failureDetail('\u001b[31mno useful detail\u001b[0m\n  more details  ')).toBe(
      'no useful detail\n  more details'
    )
  })
})

describe('credentialValidationError', () => {
  it('accepts success output only when the exit code is zero and the marker matches', () => {
    expect(
      credentialValidationError(
        { exitCode: 0, stdout: 'Validated credentials for transfer-a', stderr: '' },
        'transfer-a',
        '',
        {}
      )
    ).toBeUndefined()
    expect(
      credentialValidationError(
        { exitCode: 1, stdout: 'Validated credentials for transfer-a', stderr: '' },
        'transfer-a',
        '',
        {}
      )
    ).toContain('No AWS credentials were found')
  })

  it('reports warning-but-exit-0 output as failure because the validation marker is missing', () => {
    expect(
      credentialValidationError(
        { exitCode: 0, stdout: 'WARNING: unable to list bucket', stderr: '' },
        'transfer-a',
        'configured-profile',
        {}
      )
    ).toContain('WARNING: unable to list bucket')
  })

  it('reports errors and adds a credentials hint only when no credential hints are present', () => {
    const output = { exitCode: 1, stdout: '', stderr: '\u001b[31mERROR: expired token\u001b[0m' }
    const failure = credentialValidationError(output, 'transfer-a', '', {})

    expect(failure).toContain('ERROR: expired token')
    expect(failure).toContain('No AWS credentials were found')
    expect(credentialValidationError(output, 'transfer-a', 'known-profile', {})).not.toContain(
      'No AWS credentials were found'
    )
    expect(credentialValidationError(output, 'transfer-a', '', { [AWS_ENV.accessKeyId]: 'test-key' })).not.toContain(
      'No AWS credentials were found'
    )
  })
})

describe('validateCredentials adapter', () => {
  it('runs the CLI with the config directory and accepts explicit success output', async () => {
    vi.mocked(exec.getExecOutput).mockResolvedValue({
      exitCode: 0,
      stdout: 'Validated credentials for transfer-a',
      stderr: ''
    })
    await expect(validateCredentials('fme-bin', 'C:\\config\\dir', 'transfer-a', '')).resolves.toBeUndefined()

    expect(exec.getExecOutput).toHaveBeenCalledWith(
      'fme-bin',
      ['validate-credentials', 'transfer-a'],
      expect.objectContaining({
        env: expect.objectContaining({ [CONFIG_DIR_ENV]: 'C:\\config\\dir' }),
        ignoreReturnCode: true,
        silent: true
      })
    )
  })

  it('converts a failed CLI result into an exception', async () => {
    vi.mocked(exec.getExecOutput).mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'ERROR: expired token'
    })

    await expect(validateCredentials('fme-bin', 'config', 'transfer-a', 'known-profile')).rejects.toThrow(
      /ERROR: expired token/
    )
  })
})
