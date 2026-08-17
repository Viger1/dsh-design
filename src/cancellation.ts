/**
 * Cooperative-cancellation primitives shared by this plugin's browser work.
 *
 * These exist because the same defect appeared independently in three sibling
 * plugins: an `AbortSignal` dispatches `abort` exactly once, so a listener
 * registered after the resource is created never runs, and a cancellation
 * arriving during creation was silently ignored until the operation's own
 * timeout expired. {@link withCancellation} removes the chance to get that
 * order wrong — the listener is installed before the work starts, and the work
 * hands back what to close as soon as it exists.
 * @module dsh-design/cancellation
 */

/**
 * Throw when the signal is already aborted.
 * @param signal - the tool execution's cancellation signal.
 */
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('cancelled before the browser step started')
}

/**
 * Settle `work` or reject as soon as `signal` aborts, whichever happens first.
 * The underlying operation keeps its own playwright timeout as the hard bound;
 * this race is what lets a tool return promptly on cooperative cancellation.
 * @param signal - the tool execution's cancellation signal.
 * @param work - the in-flight browser operation.
 * @returns the settled value of `work`.
 */
export function raceAbort<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('cancelled before the browser step started'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error('cancelled by tool signal'))
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
      (err: unknown) => { signal.removeEventListener('abort', onAbort); reject(err instanceof Error ? err : new Error(String(err))) },
    )
  })
}

/** What a cancellable browser operation is handed to make itself interruptible. */
export interface CancellationScope {
  /**
   * Register a resource to close when the signal aborts. Call it as soon as
   * the resource exists; calling it again replaces the previous one, so a
   * routine that creates a context and then a page can hand over each in turn.
   */
  closeOnAbort(resource: { close(): Promise<unknown> }): void
  /**
   * Throw when the signal has aborted since the last check. Call after every
   * await, because `aborted` flips while a promise is pending.
   */
  throwIfCancelled(): void
}

/**
 * Run `work` with an abort listener already installed.
 *
 * The listener exists before the first await, so a cancellation arriving while
 * the browser is starting — the window that is seconds long on a cold call —
 * closes whatever `work` has registered by then instead of being noticed only
 * after the operation finishes.
 * @param signal - the tool execution's cancellation signal.
 * @param work - the operation, receiving its cancellation scope.
 * @returns the operation's value.
 */
export async function withCancellation<T>(
  signal: AbortSignal,
  work: (scope: CancellationScope) => Promise<T>,
): Promise<T> {
  throwIfAborted(signal)
  let resource: { close(): Promise<unknown> } | undefined
  const onAbort = (): void => {
    void resource?.close().catch(() => { /* already closing; the abort still wins */ })
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await work({
      closeOnAbort: (next) => { resource = next },
      throwIfCancelled: () => {
        if (signal.aborted) throw new Error('cancelled while preparing the browser')
      },
    })
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
