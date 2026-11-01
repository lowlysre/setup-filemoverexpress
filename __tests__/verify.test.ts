import { writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import * as exec from '@actions/exec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertAuthenticode,
  assertCodesign,
  CODESIGN_REQUIREMENT,
  parseAuthenticodeOutput,
  parseCodesignDetails,
  parseDistinguishedNameOrg,
  sha256File,
  verifyAuthenticode,
  verifyCodesign,
  verifyDigest
} from '../src/verify.js'
import { makeTempDir, removeDir, snapshotEnv, unsetEnv } from './helpers.js'

vi.mock('@actions/exec', () => ({
  exec: vi.fn<typeof exec.exec>(),
  getExecOutput: vi.fn<typeof exec.getExecOutput>()
}))

const HELLO_SHA256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

const AWS_SUBJECT =
  'CN="Amazon Web Services, Inc.", OU=AWS MEGS, O="Amazon Web Services, Inc.", L=Seattle, S=Washington, C=US, SERIALNUMBER=4152954, OID.2.5.4.15=Private Organization, OID.1.3.6.1.4.1.311.60.2.1.2=Delaware, OID.1.3.6.1.4.1.311.60.2.1.3=US'

const CODESIGN_DETAILS = [
  'Executable=/private/var/folders/xy/abc/T/fme-install-x1/filemoverexpress',
  'Identifier=filemoverexpress',
  'Format=Mach-O thin (arm64)',
  'CodeDirectory v=20500 size=94253 flags=0x10000(runtime) hashes=2934+7 location=embedded',
  'VersionPlatform=1',
  'VersionMin=720896',
  'VersionSDK=983040',
  'Hash type=sha256 size=32',
  'CandidateCDHash sha256=6d0f2e5c1a8b0f4b0b8a3d6a1f6c8e9d7a2b4c3e',
  'CandidateCDHashFull sha256=6d0f2e5c1a8b0f4b0b8a3d6a1f6c8e9d7a2b4c3e5f6a7b8c9d0e1f2a3b4c5d6e',
  'Hash choices=sha256',
  'CMSDigest=6d0f2e5c1a8b0f4b0b8a3d6a1f6c8e9d7a2b4c3e5f6a7b8c9d0e1f2a3b4c5d6e',
  'CMSDigestType=2',
  'Executable Segment base=0',
  'Executable Segment limit=21086208',
  'Executable Segment flags=0x1',
  'Page size=16384',
  'CDHash=6d0f2e5c1a8b0f4b0b8a3d6a1f6c8e9d7a2b4c3e',
  'Signature size=9056',
  'Authority=Developer ID Application: AMZN Mobile LLC (94KV3E626L)',
  'Authority=Developer ID Certification Authority',
  'Authority=Apple Root CA',
  'Timestamp=Oct 12, 2026 at 10:41:07 AM',
  'Info.plist=not bound',
  'TeamIdentifier=94KV3E626L',
  'Runtime Version=15.0.0',
  'Sealed Resources=none',
  'Internal requirements count=1 size=180',
  ''
].join('\n')

function execResult(exitCode: number, stdout: string, stderr = ''): exec.ExecOutput {
  return { exitCode, stdout, stderr }
}

function lastCall(): { command: string; args: string[]; options: exec.ExecOptions } {
  const [command, args, options] = vi.mocked(exec.getExecOutput).mock.calls[0]
  return { command, args: args ?? [], options: options ?? {} }
}

let dir: string
beforeEach(async () => {
  dir = await makeTempDir()
})
afterEach(async () => {
  await removeDir(dir)
})

describe('sha256File / verifyDigest', () => {
  let file: string
  beforeEach(async () => {
    file = path.join(dir, 'asset.bin')
    await writeFile(file, 'hello')
  })

  it('hashes a file', async () => {
    await expect(sha256File(file)).resolves.toBe(HELLO_SHA256)
  })

  it('accepts a matching digest', async () => {
    await expect(verifyDigest(file, `sha256:${HELLO_SHA256}`, 'asset.bin')).resolves.toBe(HELLO_SHA256)
  })

  it('accepts uppercase hex and surrounding whitespace', async () => {
    await expect(verifyDigest(file, `  sha256:${HELLO_SHA256.toUpperCase()}\n`, 'asset.bin')).resolves.toBe(
      HELLO_SHA256
    )
  })

  it('rejects a mismatched digest', async () => {
    const wrong = 'a'.repeat(64)
    await expect(verifyDigest(file, `sha256:${wrong}`, 'asset.bin')).rejects.toThrow(
      `SHA-256 mismatch for 'asset.bin': expected ${wrong}, got ${HELLO_SHA256}.`
    )
  })

  it.each([null, undefined, ''])('fails closed when the digest is %j', async digest => {
    await expect(verifyDigest(file, digest, 'asset.bin')).rejects.toThrow(
      "Release asset 'asset.bin' has no digest in the GitHub Releases API"
    )
  })

  it.each([
    `sha512:${'a'.repeat(128)}`,
    'sha256:abc',
    `md5:${'a'.repeat(32)}`,
    HELLO_SHA256,
    `sha256:${'g'.repeat(64)}`
  ])('rejects unsupported digest %j', async digest => {
    await expect(verifyDigest(file, digest, 'asset.bin')).rejects.toThrow(
      `Release asset 'asset.bin' has an unsupported digest '${digest}'; expected sha256:<hex>.`
    )
  })
})

describe('parseDistinguishedNameOrg', () => {
  it('reads the quoted organization from the real AWS signer subject', () => {
    expect(parseDistinguishedNameOrg(AWS_SUBJECT)).toBe('Amazon Web Services, Inc.')
  })

  it('reads an unquoted organization', () => {
    expect(parseDistinguishedNameOrg('CN=Example, O=Example Org, C=US')).toBe('Example Org')
  })

  it('reads an organization at the start of the subject', () => {
    expect(parseDistinguishedNameOrg('O=First Org, C=US')).toBe('First Org')
  })

  it('unescapes doubled quotes', () => {
    expect(parseDistinguishedNameOrg('CN=x, O="Foo ""Bar"", Ltd."')).toBe('Foo "Bar", Ltd.')
  })

  it('returns undefined without an O attribute', () => {
    expect(parseDistinguishedNameOrg('CN=Example, L=Seattle, C=US')).toBeUndefined()
    expect(parseDistinguishedNameOrg('')).toBeUndefined()
  })

  it('does not treat OU as O', () => {
    expect(parseDistinguishedNameOrg('CN=Example, OU=Amazon Web Services, C=US')).toBeUndefined()
  })

  it('is not fooled by an O= inside a quoted CN', () => {
    expect(parseDistinguishedNameOrg('CN="Evil, O=""Amazon Web Services, Inc.""", O=Evil Corp')).not.toBe(
      'Amazon Web Services, Inc.'
    )
  })
})

describe('assertAuthenticode', () => {
  it('accepts a valid AWS signature', () => {
    expect(() => assertAuthenticode({ status: 'Valid', subject: AWS_SUBJECT }, 'setup.exe')).not.toThrow()
  })

  it.each(['NotSigned', 'HashMismatch', 'UnknownError', 'NotTrusted'])('rejects status %s', status => {
    expect(() => assertAuthenticode({ status, subject: AWS_SUBJECT }, 'setup.exe')).toThrow(
      `Authenticode signature of 'setup.exe' is not valid (status: ${status}).`
    )
  })

  it('reports an empty status as unknown', () => {
    expect(() => assertAuthenticode({ status: '', subject: '' }, 'setup.exe')).toThrow('(status: unknown)')
  })

  it.each([
    'CN=Evil Corp, O=Evil Corp, C=US',
    'CN="Amazon Web Services, Inc.", OU=AWS MEGS, C=US',
    'CN=x, O=Amazon Web Services',
    ''
  ])('rejects signer %j', subject => {
    expect(() => assertAuthenticode({ status: 'Valid', subject }, 'setup.exe')).toThrow(
      `'setup.exe' is signed by '${subject}', expected organization "Amazon Web Services, Inc.".`
    )
  })
})

describe('parseAuthenticodeOutput', () => {
  it('parses the script output', () => {
    const stdout = `${JSON.stringify({ status: 'Valid', subject: AWS_SUBJECT })}\r\n`
    expect(parseAuthenticodeOutput(stdout)).toEqual({ status: 'Valid', subject: AWS_SUBJECT })
  })

  it.each(['', 'garbage', 'Get-AuthenticodeSignature : Cannot find path', '{"status":', 'null', '"Valid"', '42'])(
    'returns undefined for %j',
    stdout => {
      expect(parseAuthenticodeOutput(stdout)).toBeUndefined()
    }
  )

  it.each(['{}', '{"status":"Valid"}', '{"subject":"CN=x"}'])('returns undefined for missing fields %s', stdout => {
    expect(parseAuthenticodeOutput(stdout)).toBeUndefined()
  })

  it('coerces non-string fields to empty strings', () => {
    expect(parseAuthenticodeOutput('{"status":0,"subject":null}')).toEqual({ status: '', subject: '' })
  })
})

describe('verifyAuthenticode', () => {
  let restoreEnv: () => void
  beforeEach(() => {
    restoreEnv = snapshotEnv()
  })
  afterEach(() => {
    restoreEnv()
  })

  const filePath = String.raw`C:\Users\runner\AppData\Local\Temp\it's $(Remove-Item x)\setup.exe`

  it('runs Windows PowerShell with an encoded script and passes the path through the environment', async () => {
    vi.mocked(exec.getExecOutput).mockResolvedValue(
      execResult(0, JSON.stringify({ status: 'Valid', subject: AWS_SUBJECT }))
    )
    await verifyAuthenticode(filePath, 'setup.exe')

    expect(exec.getExecOutput).toHaveBeenCalledTimes(1)
    const { command, args, options } = lastCall()
    expect(command).toBe('powershell.exe')
    expect(args).toHaveLength(5)
    expect(args.slice(0, 4)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand'])
    expect(args[4]).toMatch(/^[A-Za-z0-9+/]+=*$/)

    const script = Buffer.from(args[4], 'base64').toString('utf16le')
    expect(script).toContain('Get-AuthenticodeSignature -LiteralPath $env:FME_VERIFY_PATH')
    expect(script).toContain('ConvertTo-Json')
    expect(script).not.toContain(filePath)
    expect(script).not.toContain('setup.exe')
    for (const arg of args) {
      expect(arg).not.toContain(filePath)
    }

    expect(options.env?.FME_VERIFY_PATH).toBe(filePath)
    expect(options.ignoreReturnCode).toBe(true)
    expect(options.silent).toBe(true)
  })

  it.each(['PSModulePath', 'PSMODULEPATH', 'psmodulepath'])(
    'drops an inherited %s but keeps the rest of the environment',
    async name => {
      unsetEnv('PSModulePath')
      process.env[name] = String.raw`C:\Users\runner\Documents\PowerShell\Modules;C:\Program Files\PowerShell\7\Modules`
      process.env['FME_TEST_MARKER'] = 'kept'
      vi.mocked(exec.getExecOutput).mockResolvedValue(
        execResult(0, JSON.stringify({ status: 'Valid', subject: AWS_SUBJECT }))
      )
      await verifyAuthenticode(filePath, 'setup.exe')

      const env = lastCall().options.env ?? {}
      expect(Object.keys(env).filter(key => key.toLowerCase() === 'psmodulepath')).toEqual([])
      expect(env.FME_VERIFY_PATH).toBe(filePath)
      expect(env.FME_TEST_MARKER).toBe('kept')
      const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path')
      expect(pathKey).toBeDefined()
      expect(env[pathKey ?? 'PATH']).toBe(process.env[pathKey ?? 'PATH'])
    }
  )

  it('throws with stderr when PowerShell exits non-zero', async () => {
    vi.mocked(exec.getExecOutput).mockResolvedValue(
      execResult(
        1,
        JSON.stringify({ status: 'Valid', subject: AWS_SUBJECT }),
        "Get-AuthenticodeSignature : The term 'Get-AuthenticodeSignature' is not recognized\n"
      )
    )
    await expect(verifyAuthenticode(filePath, 'setup.exe')).rejects.toThrow(
      "Couldn't read the Authenticode signature of 'setup.exe': Get-AuthenticodeSignature : The term 'Get-AuthenticodeSignature' is not recognized"
    )
  })

  it('throws with stdout when the output is not JSON and stderr is empty', async () => {
    vi.mocked(exec.getExecOutput).mockResolvedValue(execResult(0, '  not json  '))
    await expect(verifyAuthenticode(filePath, 'setup.exe')).rejects.toThrow(
      "Couldn't read the Authenticode signature of 'setup.exe': not json"
    )
  })

  it('rejects an unsigned installer', async () => {
    vi.mocked(exec.getExecOutput).mockResolvedValue(execResult(0, '{"status":"NotSigned","subject":""}'))
    await expect(verifyAuthenticode(filePath, 'setup.exe')).rejects.toThrow('(status: NotSigned)')
  })

  it('rejects a valid signature from the wrong organization', async () => {
    vi.mocked(exec.getExecOutput).mockResolvedValue(
      execResult(0, JSON.stringify({ status: 'Valid', subject: 'CN=Evil Corp, O=Evil Corp, C=US' }))
    )
    await expect(verifyAuthenticode(filePath, 'setup.exe')).rejects.toThrow(
      'expected organization "Amazon Web Services, Inc."'
    )
  })
})

describe('parseCodesignDetails / assertCodesign', () => {
  it('parses real codesign -dv output', () => {
    expect(parseCodesignDetails(CODESIGN_DETAILS)).toEqual({
      teamIdentifier: '94KV3E626L',
      authorities: [
        'Developer ID Application: AMZN Mobile LLC (94KV3E626L)',
        'Developer ID Certification Authority',
        'Apple Root CA'
      ]
    })
  })

  it('handles CRLF and values containing =', () => {
    const details = parseCodesignDetails('Authority=Developer ID Application: A=B (X)\r\nTeamIdentifier=94KV3E626L\r\n')
    expect(details).toEqual({ teamIdentifier: '94KV3E626L', authorities: ['Developer ID Application: A=B (X)'] })
  })

  it('accepts the Amazon Developer ID signature', () => {
    expect(() => assertCodesign(parseCodesignDetails(CODESIGN_DETAILS), 'filemoverexpress')).not.toThrow()
  })

  it('rejects another team', () => {
    const output = CODESIGN_DETAILS.replace('TeamIdentifier=94KV3E626L', 'TeamIdentifier=ABCDE12345')
    expect(() => assertCodesign(parseCodesignDetails(output), 'filemoverexpress')).toThrow(
      "'filemoverexpress' is signed by team 'ABCDE12345', expected Amazon's Apple team 94KV3E626L."
    )
  })

  it('rejects ad-hoc signatures (TeamIdentifier=not set)', () => {
    const output = 'Identifier=filemoverexpress\nSignature=adhoc\nTeamIdentifier=not set\n'
    expect(() => assertCodesign(parseCodesignDetails(output), 'filemoverexpress')).toThrow("signed by team 'not set'")
  })

  it('rejects output without a TeamIdentifier', () => {
    expect(() => assertCodesign(parseCodesignDetails('Identifier=filemoverexpress\n'), 'filemoverexpress')).toThrow(
      "signed by team 'none'"
    )
  })

  it('rejects a missing Developer ID Application authority', () => {
    const output = CODESIGN_DETAILS.replace(
      'Authority=Developer ID Application: AMZN Mobile LLC (94KV3E626L)',
      'Authority=Apple Development: someone (94KV3E626L)'
    )
    expect(() => assertCodesign(parseCodesignDetails(output), 'filemoverexpress')).toThrow(
      "'filemoverexpress' isn't signed with a Developer ID Application certificate."
    )
  })
})

describe('CODESIGN_REQUIREMENT', () => {
  it('anchors to Apple and requires Amazon, the Developer ID intermediate and the application leaf', () => {
    expect(CODESIGN_REQUIREMENT).toBe(
      'anchor apple generic and certificate leaf[subject.OU] = "94KV3E626L" and ' +
        'certificate 1[field.1.2.840.113635.100.6.2.6] exists and ' +
        'certificate leaf[field.1.2.840.113635.100.6.1.13] exists'
    )
  })
})

describe('verifyCodesign', () => {
  const binPath = path.join('staging', 'filemoverexpress')

  it('verifies strictly, then checks the team from the display output on stderr', async () => {
    vi.mocked(exec.getExecOutput)
      .mockResolvedValueOnce(
        execResult(0, '', `${binPath}: valid on disk\n${binPath}: satisfies its Designated Requirement\n`)
      )
      .mockResolvedValueOnce(execResult(0, '', CODESIGN_DETAILS))
    await expect(verifyCodesign(binPath, 'filemoverexpress')).resolves.toBeUndefined()

    const calls = vi.mocked(exec.getExecOutput).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0][0]).toBe('codesign')
    expect(calls[0][1]).toEqual(['--verify', '--strict', '--verbose=2', `-R=${CODESIGN_REQUIREMENT}`, binPath])
    expect(calls[0][2]).toMatchObject({ ignoreReturnCode: true, silent: true })
    expect(calls[1][0]).toBe('codesign')
    expect(calls[1][1]).toEqual(['--display', '--verbose=4', binPath])
  })

  it('throws with stderr when codesign --verify fails', async () => {
    vi.mocked(exec.getExecOutput).mockResolvedValueOnce(
      execResult(1, '', `${binPath}: code object is not signed at all\n`)
    )
    await expect(verifyCodesign(binPath, 'filemoverexpress')).rejects.toThrow(
      `codesign rejected 'filemoverexpress': ${binPath}: code object is not signed at all`
    )
    expect(exec.getExecOutput).toHaveBeenCalledTimes(1)
  })

  it('falls back to stdout when codesign --verify fails silently on stderr', async () => {
    vi.mocked(exec.getExecOutput).mockResolvedValueOnce(execResult(3, 'invalid signature\n', ''))
    await expect(verifyCodesign(binPath, 'filemoverexpress')).rejects.toThrow(
      "codesign rejected 'filemoverexpress': invalid signature"
    )
  })

  it('reads the display details from stdout too', async () => {
    vi.mocked(exec.getExecOutput)
      .mockResolvedValueOnce(execResult(0, '', ''))
      .mockResolvedValueOnce(execResult(0, CODESIGN_DETAILS, ''))
    await expect(verifyCodesign(binPath, 'filemoverexpress')).resolves.toBeUndefined()
  })

  it('rejects a validly signed binary from another team', async () => {
    vi.mocked(exec.getExecOutput)
      .mockResolvedValueOnce(execResult(0, '', ''))
      .mockResolvedValueOnce(execResult(0, '', CODESIGN_DETAILS.replaceAll('94KV3E626L', 'ZZZZZZZZZZ')))
    await expect(verifyCodesign(binPath, 'filemoverexpress')).rejects.toThrow("signed by team 'ZZZZZZZZZZ'")
  })
})
