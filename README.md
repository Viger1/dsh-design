# dsh-design

English | [中文](README.zh.md)

**The only thing in this ecosystem that measures design rules on a rendered page.**

Design tooling here splits into two buckets, and both leave the same hole. Generators produce a design and stop. Prompt-only skills hand the model a list of rules with nothing checking whether it followed them. Static analyzers parse CSS files, which cannot see what the browser actually painted: alpha composited over the real backdrop, utility classes after they resolve, a runtime theme switch, or the tap-target box as laid out.

`dsh-design` renders the page and **measures** it. "It looks good" becomes a number you can argue with — including the specific tells of a generated-looking page, which no other plugin checks at all: violet gradients caught by **hue angle** rather than a string match, emoji standing in for iconography, and type that fell back to the browser default because no family was ever chosen.

## Same brief, two agents

One brief — a pricing page for a small API-monitoring product, Chinese UI, single self-contained `index.html`. Two runs on the same model and the same harness. The only difference is whether this plugin was doing anything.

| Without the plugin | With the skill + audit loop |
| --- | --- |
| ![Baseline: centered blue SaaS pricing page](docs/demo-baseline.png) | ![Guided: warm off-white editorial pricing page](docs/demo-guided.png) |

| Measured at 1280px | Without | With |
| --- | --- | --- |
| Violations | **4** | **0** |
| Distinct type sizes | 11 — `12 13 14 15 16 17 19 20 30 44 46` | 6 — `14 16 20 24 32 40` |
| Off-grid spacing values | 10 — `5 6 10 13 14 15 18 26 30 226` | 0 |
| Tap targets under 24px | 3 | 0 |
| Generated-design tells | 1 — a violet gradient on the logo mark | 0 |
| Non-neutral colors | 1 — `rgb(37, 99, 235)` | 1 — `rgb(15, 92, 68)` |
| Elements sampled | 71 | 78 |

The baseline is not bad work. It is competent, and that is the point: it is the centered-blue-SaaS page you have already seen several hundred times, and it reached for a violet gradient **unprompted** — the exact tell the `purple-gradient` rule exists to catch. Underneath the competence it is improvising, with eleven type sizes and ten spacing values that belong to no scale.

The guided run committed first — one warm neutral ramp, a single deep green used only for the primary action and the recommended tier, six sizes, spacing on 4px — then audited. Round one found one violation (footer links at 22.4px tall); round two came back clean across 78 elements. Both pages spend exactly one accent, which is the palette rule reporting that neither page's problem was color.

Reproduce it yourself: the brief and both outputs are in [`examples/pricing-page/`](examples/pricing-page/). One run of each, so treat this as an illustration of the difference rather than a benchmark. The baseline was also told to write the page and stop, so it never got a revision pass — an unguided run allowed to iterate is the arm this comparison does not have.

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

Measuring the rendered page is what makes several of these possible at all. Contrast is computed after compositing the text color over the backdrop the collector actually resolved, so faded grey-on-white is caught and white-on-dark-gradient is correctly left alone — neither is visible to a CSS parser. Tap targets are read as laid-out boxes, not declared sizes.

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
    neutralChroma: 0.18       # chroma below which a color is neutral, not palette
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
- **Neutrals are excluded from the palette count, and "neutral" is measured as chroma.** A ramp is structure; accents are choices, and only choices should be rationed. Chroma rather than HSL saturation, because saturation's denominator collapses at the extremes of lightness — it scores `#FAF8F2` at 0.44, and paper is not an accent.

### Calibrated against a real application

Auditing dsh's own Web UI — a professionally designed product — was the check that mattered, because every earlier fixture had been written to trigger the rules. Two thresholds passed cleanly on it (4 type sizes against a limit of 6, two non-neutral colors against eight), which is the evidence that those limits are not arbitrary. Three rules were wrong and were fixed:

- **Hairlines are not rhythm.** 1px and 2px values are borders, focus rings, and optical nudges; holding them to the spacing scale was noise. Values below the base are now exempt, and when every off-grid value fits a finer scale the report says so and names it rather than asking a consistent project to abandon its own system.
- **44px is the touch guideline, not the AA bar.** Flagging 28x28 desktop icon buttons applied a mobile standard to a mouse interface. The default is now WCAG 2.2 AA (2.5.8, 24px); touch-first deployments raise it.
- **A neutral is a low-chroma color, not a low-saturation one.** The palette rule tested HSL saturation, whose denominator collapses toward zero at the extremes of lightness — so a barely-tinted near-white or near-black scored as intensely saturated. Every step of a tinted ramp was charged to the palette budget: a Tailwind `slate` ramp alone consumed all eight slots before a single accent, and this page's own off-white and near-black counted as accents. That is the rule contradicting the bundled skill, which tells the agent to build exactly such a ramp. Neutrality is now absolute chroma, which does not move with lightness.

On that same UI the report went from three violations to two, and the one that remained — two muted labels at 3.55:1 — is a real accessibility finding. The palette count on it fell from five colors to two, both of them the product's blue.

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
