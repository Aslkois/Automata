# Design system — the Machine Archive

AUTOMATA is presented as an archive of autonomous mechanical life. A drone design is a **specimen**, a program is an **intelligence record**, and a battle produces an **operational report**. Layouts, labels and transitions follow from that metaphor.

## Tokens (`src/ui/theme.ts`, `src/ui/styles.css`)

| Role | Token | Value |
| --- | --- | --- |
| Primary surface | `--parchment` | `#e8e2d4` |
| Records, raised paper | `--ivory` | `#f4f0e6` |
| Secondary surface / hover | `--vellum` | `#ddd5c3` |
| Rules, borders | `--rule` / `--ink` | `#b7ad98` / `#2b2925` |
| Secondary text | `--stone` / `--dust` | `#6b6357` / `#8f8676` |
| Instruments (mast, scope, transcript, ledger) | `--charcoal` / `--graphite` / `--night` | `#1f1e1c` / `#2f2e2b` / `#191816` |
| Text on dark | `--bone` | `#ece6d8` |
| Failure, damage, critical | `--rust` / `--rust-light` | `#9b3b2a` / `#c9735e` |

Other hues appear only where information has to be told apart, and always desaturated:
- **port types**: execution ink, number ochre, boolean sage, contact slate, string plum;
- **teams**: Slate, Bronze, Sage, Plum, with lighter variants for the dark field;
- **programming categories**: muted plates that read with ivory labels.

Hardware kinds are distinguished by **glyph** and **catalogue code** (WPN, SNS, SHD, PWR, PRP, CTL, THM, AMM), never by colour alone.

## Typography

- **Newsreader** (serif) for document titles, specimen and record names, and section headings.
- **IBM Plex Sans** for interface text and labels.
- **IBM Plex Mono** for numbers, coordinates, component ids and catalogue annotations. Numerals are tabular and ligatures are off, so code shows exactly what was typed.

Contrast comes from weight, scale and darkness. Uppercase is limited to short catalogue annotations (eyebrows, stamps, table headers).

## Geometry and ornament

- Square corners (≤ 1 px rounding) and 1 px rules.
- Registration marks (`.marks`), a framed drawing sheet with a fine grid, and calibration ticks on the battlefield.
- **The three-segment motif** (`<Tri>`), proportioned like the rear, middle and front hull sections. It appears in the logo, section headings, the section selector, the title block, and the specimen tags, where each segment is filled to show that section's live integrity.
- **Selection is inversion** (ink ground, ivory text), not a highlight colour.

## Motion

- **Reveal** (a clip-path wipe) for panels and tabs, **slide-in** for side volumes, a single **scan line** when a diagnostic report opens, and **line drawing** of the hull when a specimen opens.
- **Signal breakup** (`.breakup`) and a brief **static** flicker on failed rows only follow genuine hardware destruction.
- Nothing animates continuously apart from the small recording indicator on the camera chip.
- `prefers-reduced-motion` disables all motion.

## Reusable components (`src/ui/common.tsx`)

`Tri`, `Glyph`, `Meter` (calibrated, rust when critical), `SectionTitle`, `Stamp`, `Logo`, `ResizeGrip` + `useResizableWidth`, and `catNo`.
