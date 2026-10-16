---
name: add-render-pass
description: Add a new export pass (like clay, color_id, depth, normals or pose) to the take renderer. Use when the user wants a new output pass, e.g. "add a segmentation pass", "export albedo", "add a canny/edge pass".
disable-model-invocation: true
argument-hint: <pass_id> [what it encodes]
---

# Add a render pass

New pass: `$ARGUMENTS`

A pass touches five places. Miss one and the build may still pass while the render dialog, the manifest or the bundle silently lacks the new pass. Work through them in order.

## 1. Register it in `src/render/plan.ts` (pure, no Three.js)

- Append the id to `PASSES` (snake_case, also used in file names via `outputName`).
- Add a `PASS_INFO` entry: a short `label` and a one-line `description` that says what the pixels mean and which AI control it feeds, in the tone of the existing entries.
- `PassId` and `RenderDialog` (checkbox list, saved settings filter) pick it up automatically. Only change `defaultSettings()` in `src/ui/RenderDialog.ts` if the pass should be on by default.

## 2. Configure the scene in `Passes.run()` (`src/render/passes.ts`)

Add a `case` to the `switch`. The rules:

- **Save and restore everything you change** inside the existing `try/finally` (background, `overrideMaterial`, swapped materials, visibility). The interactive scene must look identical after a render.
- **Exact bytes:** output goes to an 8-bit *linear* target. If values must be exact (ids, masks, encoded data), write them without sRGB conversion, as `color_id` and `depth` do. Only `clay` is tone-mapped (HDR target + `OutputPass` in `TakeRenderer`).
- Prefer a single `overrideMaterial` (`ShaderMaterial`, created once in the constructor and disposed in `dispose()`) over per-mesh material swaps. Skinned meshes need `#include <skinning_*>` chunks in custom shaders.
- Objects with `userData.helper` and anything registered with `App.addEditorOnly()` are already hidden by `App.withEditorHidden`. Don't re-hide them here.
- A 2D pass (like `pose`) does nothing here and is drawn in `TakeRenderer` instead (step 3).

## 3. Only for 2D passes: `src/render/TakeRenderer.ts`

The frame loop special-cases `pose`. A new 2D pass draws into an `OffscreenCanvas` and reads with `getImageData`. **Never** use APIs that background tabs throttle in this loop: `toBlob`, `convertToBlob`, `setTimeout`, `requestAnimationFrame`, or the async readback.

## 4. Describe the encoding in `src/render/manifest.ts`

`buildManifest`'s `encoding` is a `Record<PassId, unknown>`, so TypeScript fails until you add the entry. Say how to decode the pixels: color space, value mapping, background, units, conventions. A downstream tool should be able to read it without opening PrevizXR.

## 5. Test and document

- `src/render/plan.test.ts` / `export.test.ts`: cover any pure helper you added and check the manifest has the new `encoding` entry.
- Update `README.md`: the intro line, the "Render passes" feature bullet and the bundle table that says what each `<pass>.mp4` is for. Also update the opening line of `CLAUDE.md`, which lists every pass.
- Run `npm run check`. Then, in the dev server, render a short take with only the new pass and check the output (and a PNG export when exact bytes matter).
