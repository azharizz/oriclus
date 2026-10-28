---
name: Oriclus
description: A desktop workspace for release rehearsals, following the Nebius Token Factory visual reference.
colors:
  primary: "#6057f7"
  primary-hover: "#6b67ff"
  background: "#121215"
  surface: "#1e1e21"
  header: "#232429"
  text: "#f3f3f4"
  muted: "#a9a9b0"
  line: "#303035"
  control-line: "#46464c"
  link: "#aaa4ff"
  lime: "#b7ecaa"
  error: "#ffaca6"
typography:
  heading:
    fontFamily: "Inter Variable, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  section:
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter Variable, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  status: "4px"
  navigation: "6px"
  input: "8px"
  panel: "12px"
  button: "9999px"
spacing:
  small: "8px"
  medium: "16px"
  large: "24px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.button}"
    padding: "9px 18px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.input}"
    padding: "9px 12px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "24px"
---

# Design System: Oriclus

## Overview

The user selected [Nebius Token Factory](https://tokenfactory.nebius.com/) as the visual reference. Its live home and model catalog were inspected on 2026-09-20. This system reproduces the reference's compact desktop console language for Oriclus: dark surfaces, Inter, purple actions, a fixed header and a restrained sidebar. The logo is original Oriclus geometry, not the Nebius logo.

The implementation lives in `web/src/style.css`. The interface prioritizes a repository and optional change field, then reviewable evidence. Screen content and actions describe real Oriclus capabilities.

## Colors

Purple identifies actions. Lavender identifies links and keyboard focus. Charcoal surfaces and subtle borders divide work areas without shadows. Lime and mint are brand accents; result colors carry separate meaning: green for passing tests, red for failures, amber for review or incomplete evidence. A passing repair does not turn an originally failing candidate into a green result.

Secondary text uses the muted token; input placeholders use `#a0a0a9`. Error messages use a dark red surface with pale red text. Status labels include text, so color is never the only signal.

## Typography

Inter Variable is bundled through `@fontsource-variable/inter`, with no remote font request. Page headings use the heading role; section titles use the section role. Smaller headings are 15px at weight 600. Labels use weight 550; entered values use weight 400. Paragraphs have a 75ch maximum and line-height 1.6.

Code, commands, patches and refs use `ui-monospace, SFMono-Regular, Menlo, monospace`. Logs are 12px with line-height 1.65. Dates and counts use tabular numerals. Uppercase belongs to the small outlined brand lockup, not to ordinary interface copy.

## Layout

The sidebar runs the full window height, holds the brand, a ⌘K jump button, navigation and service status, and is 276px wide (236px below 1100px). Collapsing it leaves a 72px icon rail with hover labels; below 600px it becomes an overlay drawer. Pages render inside a rounded workspace sheet inset 10px from the window; the sheet is the scroll container. A 60px top bar is sticky inside the sheet with breadcrumbs, a command palette trigger, connection status and documentation, and gains a hairline as content scrolls. Main content has 26px top and 36px horizontal padding.

The Time machine heading includes a three-step progress stepper (choose project, explore and resolve, test). The source panel is one command row: a GitHub/local segmented control, the location field and the action. The release inspector splits into Overview, Resolve and Test tabs.

The entry screen uses a setup panel up to 760px wide beside a 240px to 320px workflow guide, separated by 32px. Manual setup has an 840px maximum. Results and history use the available workspace width. Repeated content is paginated, not stacked into an unlimited page. Narrow fallback rules remain, but the current visual review is desktop only.

## Elevation & Depth

Tonal surfaces and one-pixel borders still divide work areas. Panels carry a faint inner top highlight; raised panels (source, timeline, results) add a soft drop shadow. The header and sidebar are translucent with a backdrop blur, and the page has a faint dot grid and two low-opacity purple and mint glows. Gradients are limited to these glows, primary-button sheen, heading text and progress fills.

## Shapes

Panels and result containers use 12px corners; controls use 8px; navigation uses 6px. Primary and secondary buttons are compact pills. Lucide outline icons use a consistent 1.7 stroke. The original SVG mark combines an angular cycle with an origin square in lime and mint. It is shared by the header and favicon.

## Components

- **Top bar:** breadcrumbs, a command palette trigger, live API status and a real documentation link. No account, credit or project-switching controls without those capabilities.
- **Command palette:** ⌘K / Ctrl+K opens a native `<dialog>` listing pages and recent experiments, with arrow-key navigation.
- **Navigation:** icon tiles and text; the selected tile turns purple and a highlight springs between rows. `aria-current` and an accessible collapse button.
- **Forms:** visible labels, 40px repository input, optional fields disclosed as needed. The automatic path has one required field. Manual, imported and reused setups share the same editor.
- **Actions:** purple primary action, quiet text alternatives, explicit disabled state. Focus uses a 2px lavender outline with a 3px offset.
- **Results:** compact bordered rows show before and after test outcomes, plus a distinct repair-review status. Commands, patches and logs expand on request.
- **Motion:** shared easings `--ease` (expo-out) and `--spring` live in `style.css`. Pages enter with a staggered rise; the navigation indicator springs between items; every `<details>` animates its height. Timeline tracks draw in and release points pop in by row and position. Live work uses a pinging dot, a stepper rail that fills, an elapsed clock and a stage trail (`ActivityVisual`). Lists load behind skeletons, not text. A global `prefers-reduced-motion: reduce` rule disables all of it.
- **Long output:** test logs, installation output, patches and long resolver messages render in `LogView` (`ui.tsx`): bounded height, line numbers, error and diff highlighting, wrap, expand, jump-to-end and copy. Output beyond 1,500 lines shows the tail first. Agent decisions and recorded activity sit in bounded rails.

## Do's and Don'ts

- Do use the measured reference tokens and shared components for new screens.
- Do keep results, failures and recovery actions honest and visible.
- Do preserve keyboard focus, native labels and reduced-motion behavior.
- Don't copy Nebius account content or imply capabilities Oriclus does not provide.
- Don't add ornamental dashboards or invented metrics. Animation should explain state (loading, selection, progress, arrival), not just decorate.

The Impeccable detector flags Inter as common and sidebar margin animation as layout work. These are explicit reference choices, not general recommendations for unrelated screens. The 200ms transition is confined to navigation collapse. Screenshots are in `.oriclus/screenshots/nebius-*-desktop.png`; they record the rendered implementation, not a promise of pixel parity across every Nebius page.
