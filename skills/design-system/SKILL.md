# Designing an interface that does not look generated

Use this whenever you create or restyle a user interface. It is not a style guide — it is the set of decisions to make *before* writing components, and the order to make them in.

## Why generated UI looks generated

Not bad taste: **unlimited choice**. A fresh hex value per element, a new font size whenever something should look bigger, whatever margin the moment suggested. The result is not ugly in any single place; it is incoherent everywhere, which reads as cheap.

Designers work the opposite way. They spend the first decisions removing options, then build inside what is left. Do the same: fix the constraints first, then you cannot produce mush even if you stop thinking.

## 1. Commit to one direction

Name the direction in a sentence before writing CSS: *"dense operator console, near-black surfaces, one signal color"* or *"editorial, generous whitespace, serif headings"*. Then follow it everywhere.

The worst outcome is averaging: some soft shadows here, a neon accent there, a bit of glassmorphism because it looked nice. Averaging every style produces grey Bootstrap. **A committed direction executed imperfectly beats a hedge executed cleanly.**

If the user gave you a product with an existing look, the direction is *that*: read the existing tokens and match them rather than inventing a parallel system.

## 2. Fix the palette before you fix anything else

- **One neutral ramp** — 5–7 steps from background to primary text, all at the same hue. Everything structural is built from this.
- **One accent** — the color that means "act here". Use it for the primary action and almost nothing else. An accent that appears eight times signals nothing.
- **Semantic colors only when needed** — success/warning/danger, added when the product has those states, not by default.

Two rules that catch most damage: never introduce a color that is not in the set, and never use the accent as decoration. If a page needs more than about eight non-neutral colors, the palette has stopped being a system.

Avoid the violet-to-indigo gradient. It has become the visual signature of AI-generated work, so it announces the tool rather than the product.

## 3. Set a type scale, then map everything onto it

Pick 4–6 sizes with a consistent ratio (1.2 or 1.25 works for interfaces; 1.333 for editorial) and **use only those**. When something needs emphasis, move up the scale, change weight, or change color — never invent an in-between size.

- Two families at most: often one, in two weights.
- Body text 15–17px; do not go below 14px for anything a person must read.
- Line height around 1.5 for body, tighter (1.1–1.25) for large headings.
- Line length 45–75 characters. Long measures are the most common readability failure in generated pages, because a full-width `<p>` is the default and nobody constrained it.

## 4. Lead with hierarchy, not decoration

Before styling, decide what the eye should hit first, second, third. Then enforce it with size, weight, color, and — most of all — **space**. If everything on the screen has equal visual weight, no amount of polish will fix it: the viewer has nowhere to start.

Practical test: squint at the result. The intended first thing should still stand out when detail blurs away. If three things compete, two of them are overdressed.

## 5. Space on a scale, and use more of it

Every padding, margin, and gap comes from one scale (4 8 12 16 24 32 48 64). Arbitrary values are the clearest tell that layout was improvised.

Related things sit closer than unrelated things — proximity communicates grouping better than borders do. When a layout feels cluttered, the fix is almost always removing a border or a background, not adding one.

Generated pages are consistently too tight and too centered. Give sections room to breathe, and let content align left where reading starts; center only short, deliberately symmetrical blocks.

## 6. Components: fewer, more consistent

- One border radius across the product (two if you need a large-surface variant).
- One or two elevation levels. Shadows should be soft and low-contrast; a heavy drop shadow on every card is noise.
- One border color from the neutral ramp; prefer a background change over a border where it reads.
- Icons from one set at one weight. **Emoji are not an icon set** — they render differently on every platform and read as a placeholder.
- **A hit area is not a font size.** A 14px link at 1.6 line-height is a 22px target, just under the floor, and nothing about it looks wrong. Give inline links and small icon buttons their own padding instead of enlarging the type — footer and nav links are where this is missed almost every time.

## 7. Do not skip the states

Empty, loading, error, and long-content states are where generated UI collapses, because only the happy path was imagined. A table with no rows should say something useful; a card should survive a title three times longer than the sample.

## 8. Audit before you claim it is done

Run `design_audit` on the rendered page and fix what it names. It measures what the page actually did — how many distinct text sizes and colors appear, which text fails WCAG AA contrast, which spacing values miss the grid, which controls are too small to hit — so it catches the drift between the system you intended and the CSS you wrote.

Treat its output as a checklist, not a score. When a violation is a deliberate exception, say so in your report instead of silently leaving it.

If [dsh-preview](https://github.com/Viger1/dsh-preview) is installed, look at the page too: the audit catches measurable drift, and a screenshot catches the things numbers cannot, like a layout that is technically compliant and still awkward.

## Anti-patterns, concretely

These are the specific things that make work read as machine-made:

- A violet or indigo gradient anywhere, especially as a hero background.
- Everything centered, including body copy and left-aligned data.
- The browser's default font stack, because no family was ever chosen.
- Emoji used as interface icons.
- Every card at the same size, weight, and elevation — a grid with no hierarchy.
- Four different border radii, six shadows, ten greys.
- No empty space: content pushed edge to edge because whitespace felt wasteful.
- A gradient, glow, or animation on something that is not the primary action.
