# universal-theme-extension
Apply color themes universally to chrome! Any web page any theme! WHAT! O yes!

Pick one of 75 built-in themes (or make your own) as the default for every site, or per site. The
extension asks [Jev](https://docs.typesafe.ai) — TypeSafe AI's decision model — what every element on
the page *is* (page, card, input, primary button, muted text, link, divider…), and the theme decides what
color each of those roles gets.

▶ **[Watch the video](marketing/universal-theme.mp4)**: one minute, 75 themes, and Inky.

<img src="assets/icons/128.png" width="64" alt="Inky, a pink pixel octopus" align="right">

Meet **Inky**, the mascot: a pixel octopus, because octopuses recolor themselves in a blink. Inky is
the toolbar icon, drifts around the empty margins of the settings page (click for a heart), and
bobs in the corner of the popup and theme editor.

## How it works

- **Jev decides every color role; code never guesses.** Code measures each element's original colors and
  describes them in words (Jev is weak at hex/RGB). Jev picks a design token for each background, text
  color, border, and icon. Code only skips questions that have nothing to decide, like a transparent
  background or an inherited color.
- **Nothing flashes.** Until Jev has labeled an element it is *crushed* to the theme's base color. A dark
  theme flashes dark and a light theme flashes light, never the site's white. The first paint is crushed
  by a stylesheet registered per theme at `document_start`, before any script runs.
- **Labels are cached per site for 24 hours** (configurable). After that they are still used while Jev
  lays the site out again in the background. Labels are theme-independent tokens, so switching themes is
  instant and costs no Jev calls.
- **A MutationObserver** labels new elements. Ones Jev has seen before (same look) are themed before
  they are painted; new looks are crushed until Jev answers, usually in about 100ms.
- **Web components are themed too.** A tiny script in the page's own world reports every
  `attachShadow` (open or closed), so the extension adopts its stylesheet into the new shadow root
  before the component draws anything, and watches it like the rest of the page. Measuring follows
  the rendered (flat) tree, so slotted content inherits correctly.
- **Built for heavy web apps** (tested on Excel for the web, Google Sheets, and Shoelace):
  - *Canvases* (spreadsheet grids, document pages): Jev decides whether one is line art or content to
    keep. Code works out the paper it was drawn on, and a per-theme CSS filter maps paper → page color
    and ink → text color while keeping hues (a blue table header stays blue).
  - *Page scripts see the site's own colors.* When a page reads a color through
    `getComputedStyle`, our CSS steps aside for that element. Office uses this to detect Windows
    High Contrast, and without it Excel switched renderers and drew nothing.
  - *Repeated elements are measured once.* Grid cells and list rows that CSS cannot tell apart reuse
    a measurement once two copies agreed.
  - *CSS added from script* (`insertRule`, constructed stylesheets, CSS-in-JS) triggers re-measuring
    of just the elements its color rules match.
  - *Frames follow the tab's site theme*, so an app frame on another host matches the page around it.

```
page element ──measure (our CSS off for that element only)──▶ facts in words + signature
     │                                                               │
     │                    per-site cache hit? ──yes──▶ data-ute-bg="raised" …  ─▶ theme CSS vars ─▶ color
     │                                   └──no──▶ batch of ≤10 ─▶ Jev (background worker) ─┘
     └── crushed to the base color until labeled
```

### Tokens

Backgrounds: `page surface raised input control selected code accent danger success warning info
highlight divider overlay`, plus `-soft` tints (picked by code from the measured color) and `inherit` /
`content` (keep the original, e.g. color swatches). Text: `text strong muted faint link on-accent accent
danger success warning info`; masked icons use the text tokens for their ink. Borders: `subtle strong
accent danger success warning info`. Graphics (`<img>`, `<svg>`, `<canvas>`, sprite icons): `icon`
(recolor to the text color), `lineart` (re-tint paper and ink into the theme), `keep`.

### Themes

A theme is plain JSON: an explicit color for every token above, in five groups. Built-in themes live
in `src/themes/builtin/*.json`, and themes made in the editor are stored in the same shape:

```jsonc
{
  "$schema": "../theme.schema.json",   // editor autocompletion and checking
  "format": 1,
  "id": "gruvbox-dark-medium",         // lowercase, digits, dashes; custom themes get "custom-…"
  "name": "Gruvbox Dark Medium",
  "family": "Gruvbox",                 // optional: groups themes in pickers
  "mode": "dark",
  "background": { "page": "#282828", "surface": "#32302f", "raised": "#3c3836", … "danger-soft": "#522f2a" },
  "text":       { "text": "#ebdbb2", "strong": "#fbf1c7", "muted": "#a89984", "link": "#83a598", … },
  "border":     { "subtle": "#504945", "strong": "#7c6f64", "accent": "#fabd2f", … },
  "textOnFill": { "accent": "#282828", "danger": "#282828", … },   // labels on solid fills
  "interface":  { "visitedLink": "#d3869b", "selection": "#665c54", "selectionText": "#fbf1c7", "scrollbarThumb": "#665c54", "scrollbarTrack": "#282828" }
}
```

Colors can be any CSS color: `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, or `oklch()`. Every token is
required, so adding a token to the vocabulary makes every theme say what color it is.
`src/themes/format.ts` validates themes and describes each field. `src/themes/theme.schema.json` is
the matching JSON Schema; regenerate it with `npm run schema`, and a unit test fails if it is stale.

Everything else a theme needs is derived when it is compiled: the crush color (its page), the
single-color icon tint, and the line-art filters. The line-art filters are exact SVG color matrices
that map paper → page and ink → text.

**Adding a built-in theme:**
1. Write `src/themes/builtin/<id>.json`, giving the palette's own colors for everything except the
   automatic ones.
2. Run `npm run themes -- derive <file>` to fill in the soft tints and text-on-fill colors the same
   way the editor does. It also puts keys in canonical order.
3. Run `npm run themes -- check <file>` to validate the format and legibility. Every built-in theme
   must pass: body text 4.5:1, muted text 3:1, text on fills 3:1, and so on.
4. Run `npm run themes -- index` to add it to the generated list (`builtin/index.ts`). A unit test
   fails if the list and the folder disagree.

Pages only ever receive their active theme's colors, so shipping more themes costs pages nothing.

**Making your own:** open **Settings → My themes → New theme** (or Duplicate a theme there).
- You start from any theme and change its colors: color pickers and text fields for every token,
  with the token's meaning under each one.
- A live preview mock page is drawn through the same CSS variables real pages use. It includes a
  spreadsheet canvas showing the line-art re-tint.
- Legibility checks report contrast ratios.
- Tints and text-on-fill colors marked **auto** follow the colors they are made from until you set
  them yourself.
- Saving applies the theme everywhere a built-in theme can be used, and pages open in it recolor
  immediately.
- **Export JSON** / **Import JSON** round-trip the format above.

Theme pickers (popup and settings) are type-ahead. Type any part of a name, family, or mode, with
words in any order ("light hard", "gruv soft"), then pick with the mouse or ↑/↓ and Enter.

## Install

Easiest: ask your AI coding agent (Claude Code, for example) to *"install the Chrome extension
from https://github.com/BenjaminBenetti/universal-theme-extension/blob/main/SKILL.md"*. It downloads
the latest release and walks you through the rest. Or by hand:

1. Download the zip from the [latest release](https://github.com/BenjaminBenetti/universal-theme-extension/releases/latest)
   and unzip it.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick
   the unzipped folder.
3. The settings page opens: paste a TypeSafe API key from [console.typesafe.ai](https://console.typesafe.ai)
   and save.

## Setup (from source)

1. Get a TypeSafe API key at [console.typesafe.ai](https://console.typesafe.ai).
2. `npm install && npm run build`
3. In Chromium, open `chrome://extensions`, enable **Developer mode**, and **Load unpacked** the `dist/`
   folder. The settings page opens; paste the key and save.

The toolbar popup sets the theme for the current site and the default for all other sites, and can
**Re-layout** a site (forget Jev's labels for it).

## Development

Install Docker and a devcontainer-compatible editor (such as VS Code with the
Dev Containers extension), then open this repository in a devcontainer. The
container includes Node.js 24 LTS, Chromium, and a lightweight desktop.
The container relaxes Docker's seccomp restrictions to allow Chromium's own
sandbox to run; use it for local development, not as a production environment.

Open the forwarded port 6080 in your browser to access the desktop (the default
noVNC password is `vscode`). From the container terminal, run `chromium` to
open the browser on that desktop, and load `dist/` as described above. Reload the
extension from `chrome://extensions` after rebuilding.

| Command | What it does |
| --- | --- |
| `npm run build` / `npm run watch` | Bundle `src/` into `dist/` (esbuild) and generate the theme CSS |
| `npm run package` | Release build of `dist/` (no source maps), zipped as `release/universal-theme-<version>.zip` |
| `npm run typecheck` | TypeScript |
| `npm test` | Unit tests (Vitest): color naming, themes, CSS, questions, settings |
| `npm run test:e2e` | Loads the extension in Chromium against a mock Jev (Playwright) |
| `npm run screenshots` | Themes real sites with every theme using the **real** Jev; writes `screenshots/` |
| `npm run smoke -- <url> <theme> <out.png>` | One site, one theme, real Jev |
| `npm run ui-screenshots` | Screenshots of the popup, settings page, and theme editor |
| `npm run schema` | Regenerate `src/themes/theme.schema.json` from the theme format |
| `npm run themes -- derive\|check\|index` | Tools for built-in theme files (see Themes) |
| `npm run gallery -- [url] [settle-ms]` | One page in every built-in theme as a contact sheet, real Jev |
| `npm run video:capture` / `npm run video:render` | The marketing video (see `marketing/video/README.md`) |
| `npm run store:images` | Chrome Web Store screenshots and promo tile (see `marketing/store/README.md`) |

The real-Jev scripts read the key from `TYPESAFE_API_KEY`, or from `JEV_KEY` in `secrets.env`
(git-ignored).

**Releasing:** `npm version <major|minor|patch>` bumps the version and tags it, then
`git push --follow-tags`. The tag starts the Release workflow (`.github/workflows/release.yml`):
it checks the tag matches `package.json`, runs the typecheck and unit tests, builds the zip, and
publishes a GitHub release with it attached.

### Layout

- `src/content/` runs in every page. `measure.ts` reads original colors and writes the facts Jev sees.
  `index.ts` handles crushing, the cache, the MutationObservers, and applying labels. `dom.ts` walks
  shadow roots, `memo.ts` reuses measurements of repeated elements, and `styles.ts` finds the elements
  new CSS affects. `main-world.ts` runs in the page's own world: it reports shadow roots and
  script-added CSS, and shows page scripts their original colors.
- `src/background/` is the service worker: the Jev client, question building, the label cache, and
  registration of the first-paint stylesheet.
- `src/themes/` has the theme format (`format.ts`), the built-in themes (`builtin/*.json`), the
  registry (`index.ts`), the CSS generator (`css.ts`), and the graphic filters (`filters.ts`).
- `src/shared/` has the color math, the token vocabulary, settings, and messages.
- `src/ui/` has the popup, the settings page, the theme editor, the type-ahead theme picker, and
  Inky (`inky-sprite.ts` holds the pixels; `inky.ts` animates them). `npm run icons` redraws the
  toolbar icons from the sprite, pixel for pixel.

## Known limitations

- Canvas content is re-tinted with a color-matrix filter, not repainted. Paper and ink land exactly
  on the theme's colors, but accent colors in between are approximations that keep their hue.
- A custom theme's very first paint uses the crush color of the nearest built-in theme, because
  first-paint stylesheets have to be files in the extension. The difference only shows for a moment,
  and then the theme's own page color takes over.
- Jev cannot see pixels it cannot read (cross-origin images without CORS), so a colorful logo is
  occasionally recolored as an icon. **Re-layout site** asks again.
- Page scripts get original values for properties the theme overrides. The one exception is a text
  color an element inherits rather than sets itself, which reports the theme's value.
- Closed shadow roots are found when they are attached. A closed root created on a plain element
  while it is detached from the page, or declared in HTML (`shadowrootmode="closed"`), is not.
- `<video>` and cross-origin `<iframe>` contents are left as they are (frames run their own copy of
  the extension).
- Google's search *results* pages show a captcha to automated browsers, so automated screenshots use the
  Google homepage; normal browsing is unaffected.
