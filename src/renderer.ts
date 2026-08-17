/**
 * Minimal headless renderer: launch once, open a page per measurement, run the
 * collector, close the page. Smaller than a general browser plugin's engine
 * because an audit needs exactly one round trip and keeps no page state.
 * @module dsh-design/renderer
 */

import type { Browser, BrowserContext } from 'playwright-core'
import { chromium } from 'playwright-core'
import { withCancellation, type CancellationScope } from './cancellation.js'

/** Launch settings fixed per renderer by plugin config. */
export interface RendererOptions {
  /** Preferred browser channels in order; each is tried until one launches. */
  channels: string[]
  /** Run without a visible window. */
  headless: boolean
  /** Default viewport width in px. */
  viewportWidth: number
  /** Default viewport height in px. */
  viewportHeight: number
}

/** What one measurement produced. */
export interface MeasureResult {
  /** The URL that actually answered, after any redirects. */
  finalUrl: string
  /** Whatever the collector script returned. */
  value: unknown
}

/** One measurement request. */
export interface MeasureRequest {
  /** Absolute URL to load (http(s) or file). */
  url: string
  /** Script evaluated in the page; its return value is the measurement. */
  script: string
  /** Navigation timeout in milliseconds. */
  timeoutMs: number
  /** Override the configured viewport width for this measurement. */
  viewportWidth?: number
  /** Cooperative cancellation from the tool execution. */
  signal: AbortSignal
}

/**
 * Owns the browser process. Disposal is registered as a Cordis effect by the
 * plugin, so unload never leaks a browser.
 */
export class Renderer {
  private browser: Browser | undefined
  private launching: Promise<Browser> | undefined
  private disposed = false

  constructor(private options: RendererOptions) {}

  /**
   * Load a page, run the collector, and return its value.
   * @param request - what to load and evaluate.
   * @returns whatever the script returned.
   */
  async measure(request: MeasureRequest): Promise<MeasureResult> {
    if (this.disposed) throw new Error('renderer is disposed (plugin unloading)')
    return withCancellation(request.signal, scope => this.load(request, scope))
  }

  /**
   * Load and measure one page under an installed cancellation scope.
   * @param request - what to load and evaluate.
   * @param scope - cancellation scope registering the context to close.
   * @returns the final URL and the collector's value.
   */
  private async load(request: MeasureRequest, scope: CancellationScope): Promise<MeasureResult> {
    let context: BrowserContext | undefined
    try {
      const browser = await this.ensureBrowser()
      this.throwIfCancelled(request.signal)
      context = await browser.newContext({
        viewport: {
          width: request.viewportWidth ?? this.options.viewportWidth,
          height: this.options.viewportHeight,
        },
      })
      scope.closeOnAbort(context)
      this.throwIfCancelled(request.signal)
      const page = await context.newPage()
      this.throwIfCancelled(request.signal)
      await page.goto(request.url, { timeout: request.timeoutMs, waitUntil: 'load' })
        .catch(async (err: unknown) => {
          if (request.signal.aborted) throw err instanceof Error ? err : new Error(String(err))
          // A page that never fires `load` is still measurable once the DOM is
          // parsed and styles have applied.
          return page.goto(request.url, { timeout: request.timeoutMs, waitUntil: 'domcontentloaded' })
        })
      this.throwIfCancelled(request.signal)
      // goto follows redirects, so the host the policy admitted is not
      // necessarily the host that answered. The caller re-checks this before
      // reporting anything measured here.
      const finalUrl = page.url()
      // Let webfonts and late layout settle so measurements are not taken
      // against a half-styled first paint.
      await page.waitForLoadState('networkidle', { timeout: request.timeoutMs }).catch(() => {
        // A page with a persistent connection never goes idle; the DOM is
        // already loaded, so measuring now is correct rather than failing.
      })
      this.throwIfCancelled(request.signal)
      return { finalUrl, value: await page.evaluate(request.script) }
    } catch (err) {
      throw request.signal.aborted ? new Error('cancelled while loading the page') : err
    } finally {
      await context?.close().catch(() => { /* already closed by the abort path */ })
    }
  }

  /**
   * Throw when the caller cancelled during one of the awaits above.
   * @param signal - the tool execution's cancellation signal.
   */
  private throwIfCancelled(signal: AbortSignal): void {
    if (this.disposed) throw new Error('renderer is disposed (plugin unloading)')
    if (signal.aborted) throw new Error('cancelled while preparing the page')
  }

  /** Close the browser. Safe to call twice and safe to race a launch. */
  async dispose(): Promise<void> {
    this.disposed = true
    const pending = this.launching
    this.launching = undefined
    if (pending) await pending.catch(() => undefined)
    const browser = this.browser
    this.browser = undefined
    if (browser) await browser.close().catch(() => { /* already exited */ })
  }

  private ensureBrowser(): Promise<Browser> {
    this.launching ??= this.launch().catch((err: unknown) => {
      this.launching = undefined
      throw err
    })
    return this.launching
  }

  private async launch(): Promise<Browser> {
    const errors: string[] = []
    for (const channel of this.options.channels) {
      try {
        const browser = await chromium.launch(
          channel === 'chromium' ? { headless: this.options.headless } : { headless: this.options.headless, channel },
        )
        if (this.disposed) {
          await browser.close().catch(() => { /* dispose raced the launch */ })
          throw new Error('renderer is disposed (plugin unloading)')
        }
        this.browser = browser
        return browser
      } catch (err) {
        if (this.disposed) throw err
        errors.push(`${channel}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
      }
    }
    throw new Error(
      'no launchable browser found. Tried channels: ' + errors.join('; ')
      + '. Install Google Chrome or Microsoft Edge, or run `npx playwright install chromium` '
      + 'and set browserChannels to chromium.',
    )
  }
}
