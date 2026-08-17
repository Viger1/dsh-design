# dsh-design

English | [中文](README.zh.md)

**Design taste your agent can be held to.**

Every design plugin in this ecosystem is a prompt: a list of rules handed to the model, with nothing checking whether the model followed them. `dsh-design` ships the rules *and* the check — `design_audit` renders the page and measures what it actually did, so "it looks good" becomes a number you can argue with.

## What it measures

| Rule | What it reports |
| --- | --- |
| `contrast` | Every text element failing WCAG AA, with its measured ratio and the ratio it needed. Text alpha is composited against the real backdrop, so faded grey-on-white is caught. |
| `type-scale` | How many distinct text sizes the page actually rendered, and which. More than a handful means the hierarchy was improvised. |
| `spacing-grid` | Padding, margin, and gap values that miss the spacing scale, listed by value and element. |
| `palette` | Distinct non-neutral colors. A grey ramp is free; nine accents is drift. |
| `tap-target` | Interactive elements below the 44px floor, with their measured size. |
| `line-length` | Running text past the comfortable measure, with the longest line found. |
| `default-font` | Whether most text fell back to the browser default, meaning no family was ever chosen. |
| `purple-gradient` | Violet-to-fuchsia gradients, detected by **hue** rather than by string — Tailwind's `violet-500` sits at 258°, so a naive 260° band would miss the most common offender. |
| `emoji-icons` | Emoji standing in for iconography inside controls. |

Findings name the element and the number. `p.muted at 1.62:1 (needs 4.5:1)` is actionable; "improve contrast" is not.

## The other half: the skill

Measuring only catches drift from a system you already decided on. The bundled `design-system` skill is how the agent decides one — and it is written around the actual cause of generated-looking UI, which is not bad taste but **unlimited choice**: a fresh hex per element, a new size whenever something should look bigger, whatever margin the moment suggested.

So the skill front-loads the constraints: commit to one direction, fix the palette and type scale before writing components, lead with hierarchy, space on a scale, then audit. It ends with the concrete tells to avoid, and tells the agent to run `design_audit` before claiming the work is done.

## Install

```sh
dsh plugin --profile web add dsh-design
```

Uses your installed Chrome or Edge; otherwise `npx playwright install chromium` once and set `browserChannels: [chromium]`. Requires Node `^22.19 || >=24`.

## Use

```
design_audit { target: "http://localhost:3000/pricing" }
design_audit { target: "dist/index.html", viewportWidth: 390 }
```

Takes a URL (localhost always allowed) or a local HTML file. Pass `viewportWidth` to measure a breakpoint — mobile is where tap targets and line length usually fail.

## Configuration

```yaml
- id: design
  name: dsh-design
  config:
    headless: true
    browserChannels: [chrome, msedge, chromium]
    viewportWidth: 1280
    viewportHeight: 900
    navigationTimeoutMs: 15000
    spacingBasePx: 4        # spacing must be a multiple of this
    maxTypeSizes: 6         # distinct font sizes before the hierarchy is unplanned
    maxPaletteColors: 8     # distinct non-neutral colors before it is drift
    neutralSaturation: 0.15 # saturation below which a color counts as neutral
    minTapTargetPx: 24     # WCAG 2.2 AA; raise to 44 for a touch-first product
    maxCharsPerLine: 75
    allowedHosts: []        # extra hostnames the audit may load
    registerSkill: true
```

Every threshold is a deployment choice, because a dense operator console and a marketing page do not want the same limits.

## Design notes

- **The browser measures, Node decides.** The in-page collector only gathers computed styles; every rule is a pure function over that snapshot, which is why the thresholds, the WCAG math, and the cliche detection are unit-tested without a browser.
- **Unmodelled color syntax is skipped, not guessed.** A page using `oklch()` loses those elements from the contrast count rather than getting a fabricated ratio.
- **Contrast resolves a real backdrop.** The collector walks ancestors to the first opaque background, because a ratio against `rgba(0,0,0,0)` is meaningless.
- **Neutrals are excluded from the palette count.** A grey ramp is structure; saturated colors are choices, and only choices should be rationed.

### Calibrated against a real application

Auditing dsh's own Web UI — a professionally designed product — was the check that mattered, because every earlier fixture had been written to trigger the rules. Two thresholds passed cleanly on it (4 type sizes against a limit of 6, five non-neutral colors against eight), which is the evidence that those limits are not arbitrary. Two rules were wrong and were fixed:

- **Hairlines are not rhythm.** 1px and 2px values are borders, focus rings, and optical nudges; holding them to the spacing scale was noise. Values below the base are now exempt, and when every off-grid value fits a finer scale the report says so and names it rather than asking a consistent project to abandon its own system.
- **44px is the touch guideline, not the AA bar.** Flagging 28x28 desktop icon buttons applied a mobile standard to a mouse interface. The default is now WCAG 2.2 AA (2.5.8, 24px); touch-first deployments raise it.

On that same UI the report went from three violations to two, and the one that remained — two muted labels at 3.55:1 — is a real accessibility finding.

### What the plugin's own review changed

`dsh-review` audited this source and found six defects, all fixed. The one that mattered: the backdrop walk used to treat a gradient as "nothing painted here" and fall through to white, so **white text on a dark gradient hero — the most common landing-page pattern there is — was reported as a contrast failure that did not exist**. A linter that cries wolf on the commonest layout gets switched off, so this was the difference between a useful tool and a liability. The backdrop now reports "unmeasurable" and those elements are skipped, holding to the same rule the foreground path already followed: measure it or say nothing.

The others: unparsed color syntax in a background is now skipped rather than assumed white; local targets are canonicalized and confined to the workspace and to HTML files, because the renderer executes what it loads; cancellation is observed across the browser launch, not only after it; the host policy is re-checked after redirects; and ancestor `opacity: 0` no longer counts as visible.

## Known limitations

- Measures one viewport per call; run it again at a mobile width rather than assuming.
- Samples the first 400 visible elements, enough for a page and not for an entire app shell.
- Line length is estimated from an average glyph advance, so treat it as a signal rather than a typographic measurement.
- It judges what is measurable. A layout can pass every rule and still be awkward — pair it with [dsh-preview](https://github.com/Viger1/dsh-preview) so the agent can look at the page too.

## Family

| Plugin | What it gives your agent |
| --- | --- |
| [dsh-preview](https://github.com/Viger1/dsh-preview) | 👁 Eyes — verify what it builds: open, read, screenshot, self-check |
| [dsh-pilot](https://github.com/Viger1/dsh-pilot) | ✋ Hands — operate any page by accessibility refs, with a native permission model |
| [dsh-review](https://github.com/Viger1/dsh-review) | 🔍 Judgement — find defects, then try to refute each one before reporting it |
| **dsh-design** (this repo) | 🎨 Taste — constrain the choices, then measure whether the result kept them |

## License

MIT © Viger1
