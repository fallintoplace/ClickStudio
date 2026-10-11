# ClickStudio styles

All application styles enter through `clickstudio/src/frontend/common/styles/main.css`. Import order is part of the cascade: native and help feature styles load first, followed by Tailwind, shared tokens, component styles, responsive rules and panel chrome. Do not import styles from React components.

`foundation.css` owns theme palettes, typography, spacing roles, borders, shadows and shared control tokens. Components consume these variables. Component-specific light rules and breakpoints live in their owning stylesheet. `responsive.css` contains only application layout and the global reduced-motion override; `animations.css` owns shared keyframes. `controls.css` owns the shared light input, focus, invalid and placeholder states; it loads last.

## Changing styles

- Put new component styles in `@layer components` so explicit Tailwind utilities can override them. Keep existing unlayered dialog, explorer, responsive and panel rules in their current cascade until a visual comparison proves a migration preserves their behavior.
- Give a property one owner. If a named component class owns dimensions, padding, border or background, avoid setting that property again with JSX utilities.
- Keep a selector's base declarations together. Put its states and responsive rules in the same feature file. Preserve shorthand/longhand order; do not sort properties automatically.
- Prefer semantic variables such as `--panel`, `--text-soft`, `--control-border` and `--focus-color`. Keep derived feature variables in their component scope so they inherit the current accent.
- `!important` needs a local Stylelint exception explaining why. Existing exceptions protect CodeMirror overrides, layered icon sizing, hidden panels and reduced motion.

CSS formatting and lint run as part of `npm run review`:

```sh
cd clickstudio
npm run lint:css
npm run format:css
```

The lint rejects repeated selectors within a block, repeated properties, unknown CSS properties/functions, invalid values and unexplained `!important`. Tailwind's `@theme` is explicitly allowed.

## Appearance reference

```sh
cd clickstudio
npm run test:e2e:styles
```

The visual tests compare full-page screenshots against `tests/fixtures/styles/reference.css.gz`, a frozen Vite development stylesheet. They replace only static Vite styles in one browser operation, leaving runtime editor styles in place, then render the reference and current styles on the same DOM in the same browser. This makes the comparison portable across operating systems without introducing production minification differences. Computed colors, typography, borders and geometry must match exactly, including pseudo-elements and file inputs. The pixel comparison tolerates antialiasing noise; the report contains reference, current and diff images.

Coverage includes both themes, both accents, both workspace modes, wide and narrow desktop windows, collapsed panels, help features, native explorers, file/SQL import states and Cloud destinations for existing/new tables. Contrast and workflow assertions remain in the other browser tests. This reference catches CSS changes; it is not a historical baseline for React markup or runtime chart code.

For an intentional visual change, first inspect the current UI and existing report, then regenerate the reference from source:

```sh
npm run test:e2e:styles:update
npm run test:e2e:styles
```

Commit the updated reference with the intentional style change. Do not refresh it to hide a refactoring regression.
