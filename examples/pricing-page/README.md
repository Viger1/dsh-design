# Example: one brief, two agents

The A/B in the project README. Everything needed to re-run it is here.

- `BRIEF.md` — the brief, given verbatim to both runs.
- `baseline.html` — what the agent produced with the `design-system` skill switched off.
- `guided.html` — what it produced with the skill active and `design_audit` run until clean.

Both files are self-contained: inline CSS, no images, no icon fonts, no network.

## Re-running it

Run A, with the skill disabled so the agent writes the page the way it normally would:

```sh
printf -- '- id: design\n  name: dsh-design\n  config:\n    registerSkill: false\n' > /tmp/no-skill.yml
dsh --profile web --patch /tmp/no-skill.yml "Build the page described in BRIEF.md as index.html. Write it and stop."
```

Run B, with the skill and the audit loop:

```sh
dsh --profile web "Build the page described in BRIEF.md as index.html. Load and follow the design-system skill first, then audit with design_audit and fix until it is clean."
```

Then measure both with the same ruler:

```sh
dsh --profile web "Audit examples/pricing-page/baseline.html and examples/pricing-page/guided.html with design_audit at 1280px and compare them."
```

## What was measured

At 1280px, `design_audit` defaults:

| | baseline | guided |
| --- | --- | --- |
| Violations | 4 | 0 |
| `type-scale` | 11 sizes | 6 sizes |
| `spacing-grid` | 10 off-grid values | none |
| `tap-target` | 3 elements under 24px | none |
| `purple-gradient` | 1 (logo mark) | none |
| Non-neutral colors | 3 | 5 |
| Elements sampled | 71 | 78 |

A model is not deterministic, so a re-run will not reproduce these pages byte for byte. The numbers are one run of each, kept as an illustration rather than a benchmark — the reproducible part is the method, not the output.
