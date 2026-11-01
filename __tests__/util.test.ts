import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { errorMessage, tempRoot } from '../src/util.js'
import { snapshotEnv, unsetEnv } from './helpers.js'

const restoreEnv = snapshotEnv()

afterEach(() => {
  restoreEnv()
})

describe('tempRoot', () => {
  it('uses RUNNER_TEMP when it is set', () => {
    process.env.RUNNER_TEMP = 'C:\\runner\\temp'

    expect(tempRoot()).toBe('C:\\runner\\temp')
  })

  it('falls back to the operating system temp directory', () => {
    unsetEnv('RUNNER_TEMP')

    expect(tempRoot()).toBe(tmpdir())
  })
})

describe('errorMessage', () => {
  it('returns an Error message', () => {
    expect(errorMessage(new Error('failure'))).toBe('failure')
  })

  it.each([
    ['string failure', 'string failure'],
    [42, '42'],
    [null, 'null'],
    [undefined, 'undefined']
  ])('stringifies non-Error values', (error, expected) => {
    expect(errorMessage(error)).toBe(expected)
  })
})
