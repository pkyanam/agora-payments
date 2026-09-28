# dither-kit area chart

Installed from the official dither-kit shadcn registry (`area-chart` and its `core`, both version 0.1.0): <https://tripwire.sh/dither-kit>. Source attribution: <https://github.com/Boring-Software-Inc/dither-kit>. The upstream registry manifest does not include a component license field, and the repository has no LICENSE file. The separate `@dither-kit/cli` npm package declares MIT, but that does not establish the license for the copied registry source. Keep this vendored copy in the private preview until the component-source license is confirmed before commercial or public redistribution.

The palette is customized to black and white for Agora. The renderer’s non-data sparkle layer is removed; its payment-series rendering, responsive sizing, hover crosshair, and reduced-motion handling remain. `ariaLabel` is added to the chart API so each embedded chart can describe its data.
