/**
 * dsh-design — design taste an agent can be held to. Ships a design-system
 * skill that constrains the choices generated UI is built from, and a
 * `design_audit` tool that renders the page and measures whether those
 * constraints actually survived: type scale, WCAG contrast, spacing grid,
 * palette size, tap targets, line length, and the specific tells of a
 * generated-looking page. Named exports preserve loader injection metadata.
 * @module dsh-design
 */

import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'
import { auditPage, renderAudit, type AuditOptions, type PageSample } from './audit.js'
import { COLLECT_SCRIPT } from './collect.js'
import { Renderer } from './renderer.js'

export const name = 'design'
export const inject = ['tools']

/** Hosts reachable without configuration; local work is the core use. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Deployment configuration; every tunable is a cordis.yml field. */
export interface Config {
  /** Run the browser without a visible window. */
  headless: boolean
  /** Browser channels tried in order until one launches. */
  browserChannels: string[]
  /** Viewport width used for measurement. */
  viewportWidth: number
  /** Viewport height used for measurement. */
  viewportHeight: number
  /** Navigation timeout, in milliseconds. */
  navigationTimeoutMs: number
  /** Spacing values must be multiples of this many px. */
  spacingBasePx: number
  /** More distinct text sizes than this fails the type-scale rule. */
  maxTypeSizes: number
  /** More distinct non-neutral colors than this fails the palette rule. */
  maxPaletteColors: number
  /** HSL saturation below which a color counts as neutral. */
  neutralSaturation: number
  /** Interactive elements smaller than this in either axis are flagged. */
  minTapTargetPx: number
  /** Running text wider than this many characters per line is flagged. */
  maxCharsPerLine: number
  /** Extra hostnames the audit may load; local hosts are always allowed. */
  allowedHosts: string[]
  /** Register the bundled `design-system` skill when the skill seam is composed. */
  registerSkill: boolean
}

/** Schemastery schema for {@link Config}. */
export const Config: z<Config> = z.object({
  headless: z.boolean().default(true),
  browserChannels: z.array(z.string()).default(['chrome', 'msedge', 'chromium']),
  viewportWidth: z.number().default(1280),
  viewportHeight: z.number().default(900),
  navigationTimeoutMs: z.number().default(15000),
  spacingBasePx: z.number().default(4),
  maxTypeSizes: z.number().default(6),
  maxPaletteColors: z.number().default(8),
  neutralSaturation: z.number().default(0.15),
  minTapTargetPx: z.number().default(44),
  maxCharsPerLine: z.number().default(75),
  allowedHosts: z.array(z.string()).default([]),
  registerSkill: z.boolean().default(true),
})

/**
 * Whether the policy admits this host.
 * @param hostname - the URL's hostname.
 * @param allowedHosts - extra hostnames permitted beyond local hosts.
 * @returns true when the audit may load it.
 */
export function hostAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
  return LOCAL_HOSTS.has(hostname) || allowedHosts.includes(hostname)
}

/**
 * Resolve a model-supplied target to a loadable URL.
 *
 * A remote URL passes the host policy. A local path is canonicalized and must
 * stay inside the workspace and be an HTML file: the renderer executes what it
 * loads, so an unconstrained path would both run arbitrary local scripts and
 * report whether a given file exists.
 * @param target - http(s) URL, or a path to an HTML file in the workspace.
 * @param allowedHosts - extra hostnames permitted beyond local hosts.
 * @returns the URL to load.
 */
export async function resolveTarget(target: string, allowedHosts: readonly string[]): Promise<string> {
  if (/^https?:\/\//i.test(target)) {
    const url = new URL(target)
    if (!hostAllowed(url.hostname, allowedHosts)) {
      throw new Error(
        `host ${JSON.stringify(url.hostname)} is not allowed. Local hosts work out of the box; `
        + 'ask the user to add the hostname to the dsh-design `allowedHosts` config to audit a remote page.',
      )
    }
    return url.href
  }
  const workspace = await realpath(process.cwd())
  const prefix = workspace.endsWith(sep) ? workspace : workspace + sep
  const requested = /^file:\/\//i.test(target) ? fileURLToPath(target) : target
  const real = await realpath(resolve(workspace, requested)).catch(() => {
    throw new Error(`target ${JSON.stringify(target)} is neither a URL nor an existing file in the workspace`)
  })
  if (!real.startsWith(prefix)) {
    throw new Error(`target ${JSON.stringify(target)} resolves outside the workspace`)
  }
  const info = await stat(real)
  const path = info.isDirectory() ? resolve(real, 'index.html') : real
  if (!['.html', '.htm'].includes(extname(path).toLowerCase())) {
    throw new Error(`target ${JSON.stringify(target)} is not an HTML file; design_audit renders pages, not other file types`)
  }
  await stat(path).catch(() => {
    throw new Error(`target ${JSON.stringify(target)} does not contain an index.html`)
  })
  return pathToFileURL(path).href
}

/**
 * Register the `design_audit` tool and (optionally) the bundled skill.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment configuration.
 */
export function apply(ctx: Context, config: Config): void {
  for (const field of ['viewportWidth', 'viewportHeight', 'navigationTimeoutMs', 'spacingBasePx',
    'maxTypeSizes', 'maxPaletteColors', 'minTapTargetPx', 'maxCharsPerLine'] as const) {
    if (!Number.isSafeInteger(config[field]) || config[field] < 1) {
      throw new Error(`dsh-design config ${field} must be a positive integer, got ${config[field]}`)
    }
  }
  if (!(config.neutralSaturation >= 0 && config.neutralSaturation <= 1)) {
    throw new Error(`dsh-design config neutralSaturation must be between 0 and 1, got ${config.neutralSaturation}`)
  }

  const renderer = new Renderer({
    channels: config.browserChannels,
    headless: config.headless,
    viewportWidth: config.viewportWidth,
    viewportHeight: config.viewportHeight,
  })
  ctx.effect(() => async () => {
    await renderer.dispose()
  })

  if (config.registerSkill) {
    ctx.inject(['skills'], (skillCtx) => {
      skillCtx.skills.registerProvider(() => designSystemProvider)
    })
  }

  const options: AuditOptions = {
    spacingBasePx: config.spacingBasePx,
    maxTypeSizes: config.maxTypeSizes,
    maxPaletteColors: config.maxPaletteColors,
    neutralSaturation: config.neutralSaturation,
    minTapTargetPx: config.minTapTargetPx,
    maxCharsPerLine: config.maxCharsPerLine,
  }

  ctx.tools.register(defineTool({
    name: 'design_audit',
    description:
      'Measure a rendered page against design rules and report what it actually did: how many '
      + 'distinct text sizes and colors it used, which text fails WCAG AA contrast, which spacing '
      + 'values miss the grid, which controls are too small to hit, and the specific tells of a '
      + 'generated-looking page. Takes an http(s) URL or a local HTML file. Run it after building '
      + 'or restyling any interface, and fix what it names — the numbers are measured from the '
      + 'live page, not estimated from source.',
    timeoutMs: config.navigationTimeoutMs + 30000,
    parameters: {
      target: {
        type: 'string',
        required: true,
        description: 'http(s) URL (localhost always allowed) or a path to an HTML file.',
      },
      viewportWidth: {
        type: 'integer',
        description: 'Measure at this width instead of the configured one, e.g. 390 for mobile.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
          viewportWidthPx: { type: 'integer', required: true },
          violations: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                rule: { type: 'string', required: true },
                severity: { type: 'string', required: true, enum: ['high', 'medium', 'low'] },
                message: { type: 'string', required: true },
                elements: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
          summary: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              elementsSampled: { type: 'integer', required: true },
              typeSizes: { type: 'array', required: true, items: { type: 'number' } },
              paletteColors: { type: 'array', required: true, items: { type: 'string' } },
              contrastFailures: { type: 'integer', required: true },
              offGridSpacings: { type: 'array', required: true, items: { type: 'number' } },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.url} at ${value.viewportWidthPx}px\n${renderAudit({ violations: value.violations, summary: value.summary })}`,
      }],
    },
    async execute(args, exec) {
      const url = await resolveTarget(args.target, config.allowedHosts)
      const measured = await renderer.measure({
        url,
        script: COLLECT_SCRIPT,
        timeoutMs: config.navigationTimeoutMs,
        viewportWidth: args.viewportWidth,
        signal: exec.signal,
      })
      // goto follows redirects, so the admitted host is not necessarily the
      // host that answered; re-check before reporting anything about it.
      if (/^https?:$/.test(new URL(measured.finalUrl).protocol)) {
        const finalHost = new URL(measured.finalUrl).hostname
        if (!hostAllowed(finalHost, config.allowedHosts)) {
          throw new Error(
            `the page redirected to ${JSON.stringify(finalHost)}, which is not allowed. `
            + 'Nothing about that page is reported. Ask the user to add the hostname to `allowedHosts` if it is legitimate.',
          )
        }
      }
      const page = measured.value as PageSample
      const result = auditPage(page, options)
      return {
        url: page.url,
        title: page.title,
        viewportWidthPx: page.viewportWidthPx,
        violations: result.violations,
        summary: result.summary,
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: `Audit design of ${args.target}`,
      kind: 'search',
      rawInput: args,
    }),
  }))
}

const SKILL_BODY_URL = new URL('../skills/design-system/SKILL.md', import.meta.url)
const SKILL_RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../skills/design-system/', import.meta.url)),
} as const
const SKILL_INVOCATION = { modelInvocable: true, userInvocable: true } as const
const SKILL_DESCRIPTION =
  'How to build an interface that does not look generated: commit to one direction, fix the '
  + 'palette and type scale before writing components, lead with hierarchy, and audit the '
  + 'rendered result. Use whenever creating or restyling any user interface.'

const SKILL_CANDIDATE: SkillCandidate = {
  name: 'design-system',
  description: SKILL_DESCRIPTION,
  invocation: SKILL_INVOCATION,
  provider: 'dsh-design',
  source: 'bundled',
  resourceBase: SKILL_RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
}

/** Bundled skill provider serving the design-system guidance. */
const designSystemProvider: SkillProvider = {
  name: 'dsh-design',
  list: () => Promise.resolve([SKILL_CANDIDATE]),
  async get(_candidate): Promise<SkillDefinition> {
    return {
      name: SKILL_CANDIDATE.name,
      description: SKILL_CANDIDATE.description,
      invocation: SKILL_CANDIDATE.invocation,
      provider: SKILL_CANDIDATE.provider,
      source: SKILL_CANDIDATE.source,
      resourceBase: SKILL_RESOURCE_BASE,
      content: await readFile(SKILL_BODY_URL, 'utf8'),
    }
  },
}

