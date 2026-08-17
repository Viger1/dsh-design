import { describe, expect, it, vi } from 'vitest'
import { raceAbort, throwIfAborted, withCancellation } from '../src/cancellation.js'

describe('throwIfAborted', () => {
  it('passes a live signal through', () => {
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow()
  })

  it('throws on an already-aborted signal', () => {
    const controller = new AbortController()
    controller.abort()
    expect(() => throwIfAborted(controller.signal)).toThrow(/cancelled before/)
  })
})

describe('raceAbort', () => {
  it('resolves with the work value', async () => {
    await expect(raceAbort(new AbortController().signal, Promise.resolve('done'))).resolves.toBe('done')
  })

  it('propagates the work failure', async () => {
    const failure = new Error('playwright timeout')
    await expect(raceAbort(new AbortController().signal, Promise.reject(failure))).rejects.toBe(failure)
  })

  it('normalizes a non-Error rejection', async () => {
    await expect(raceAbort(new AbortController().signal, Promise.reject('string reason')))
      .rejects.toThrow('string reason')
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    // Never settles: only the pre-check can end this call.
    await expect(raceAbort(controller.signal, new Promise(() => {}))).rejects.toThrow(/cancelled before/)
  })

  it('rejects as soon as the signal aborts, without waiting for the work', async () => {
    const controller = new AbortController()
    const raced = raceAbort(controller.signal, new Promise(() => {}))
    controller.abort()
    await expect(raced).rejects.toThrow(/cancelled by tool signal/)
  })

  it('keeps the first settlement when the signal aborts afterwards', async () => {
    const controller = new AbortController()
    const raced = raceAbort(controller.signal, Promise.resolve('first'))
    await expect(raced).resolves.toBe('first')
    // A late abort must not turn a delivered result into a rejection, nor
    // reject an already-settled promise.
    expect(() => controller.abort()).not.toThrow()
  })

  it('removes its abort listener once settled, so a long-lived signal does not accumulate them', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    await raceAbort(controller.signal, Promise.resolve(1))
    await raceAbort(controller.signal, Promise.reject(new Error('x'))).catch(() => undefined)
    expect(remove).toHaveBeenCalledTimes(2)
  })

  it('does not leave an unhandled rejection when the work fails after an abort', async () => {
    const controller = new AbortController()
    let failWork: (err: Error) => void = () => {}
    const work = new Promise<never>((_resolve, reject) => { failWork = reject })
    const raced = raceAbort(controller.signal, work)
    controller.abort()
    await expect(raced).rejects.toThrow(/cancelled by tool signal/)
    failWork(new Error('page closed by the abort'))
    // The late failure is already attached to a handler inside raceAbort; give
    // the microtask queue a turn so an unhandled rejection would surface here.
    await new Promise(resolve => setTimeout(resolve, 0))
  })
})

// The defect this module exists to prevent: an abort arriving while the
// browser is still starting was ignored, because the listener was only
// registered once the page existed and `abort` dispatches exactly once. The
// same mistake was made independently in three sibling plugins, and no test
// covered the registration order in any of them.
describe('withCancellation', () => {
  it('closes a resource registered after the abort listener was installed', async () => {
    const controller = new AbortController()
    let closed = false
    const resource = { close: async () => { closed = true } }
    const raced = withCancellation(controller.signal, async (scope) => {
      // Stands in for the browser launch: seconds long, no resource yet.
      await new Promise(resolve => setTimeout(resolve, 5))
      scope.closeOnAbort(resource)
      await new Promise(resolve => setTimeout(resolve, 20))
      scope.throwIfCancelled()
      return 'never reached'
    })
    // Abort while the work is between registering and its next checkpoint.
    setTimeout(() => controller.abort(), 10)
    await expect(raced).rejects.toThrow(/cancelled while preparing/)
    expect(closed).toBe(true)
  })

  it('honours an abort that lands before any resource exists', async () => {
    const controller = new AbortController()
    let reached = false
    const raced = withCancellation(controller.signal, async (scope) => {
      await new Promise(resolve => setTimeout(resolve, 10))
      scope.throwIfCancelled()
      reached = true
      return 'never reached'
    })
    controller.abort()
    await expect(raced).rejects.toThrow(/cancelled while preparing/)
    expect(reached).toBe(false)
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    let ran = false
    await expect(withCancellation(controller.signal, async () => { ran = true; return 1 }))
      .rejects.toThrow(/cancelled before/)
    expect(ran).toBe(false)
  })

  it('closes only the most recently registered resource', async () => {
    const controller = new AbortController()
    const closed: string[] = []
    const raced = withCancellation(controller.signal, async (scope) => {
      scope.closeOnAbort({ close: async () => { closed.push('context') } })
      scope.closeOnAbort({ close: async () => { closed.push('page') } })
      await new Promise(resolve => setTimeout(resolve, 20))
      scope.throwIfCancelled()
      return 'never reached'
    })
    setTimeout(() => controller.abort(), 5)
    await expect(raced).rejects.toThrow(/cancelled/)
    // Closing the page tears down its context anyway; closing both would race.
    expect(closed).toEqual(['page'])
  })

  it('returns the value and removes its listener on success', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    await expect(withCancellation(controller.signal, async () => 'done')).resolves.toBe('done')
    expect(remove).toHaveBeenCalledTimes(1)
    // A later abort must not reach a handler that is gone.
    expect(() => controller.abort()).not.toThrow()
  })
})
