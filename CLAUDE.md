# PrevizXR: notes for Claude and contributors

Open-source VR previsualization web app. Block out scenes in VR (actors, props, virtual camera), record camera takes, and export frame-synced video passes (clay, color_id, depth, normals, OpenPose) as input for generative AI video models.

## Stack

- TypeScript (pinned to ~6.0 because typescript-eslint doesn't support TS 7 yet), Vite 8, Three.js r186, Vitest 5, ESLint 10 flat config.
- WebXR via Three.js (`renderer.xr`, XRControllerModelFactory, XRHandModelFactory).
- No backend. Static site deployed to GitHub Pages at `/PrevizXR/` (see `base` in `vite.config.ts`).
- Targets: Meta Quest 3 browser (immersive-vr) and desktop Chrome/Edge (orbit and keyboard). The Immersive Web Emulator extension works because it polyfills `navigator.xr`.

## Architecture

**Capture and render are separate.**

1. **Capture** (VR or desktop) records a *take*: JSON with fps, duration and per-frame camera transform and lens data, every object's transform, and actor clip names and playback times.
2. **Render** (desktop recommended) loads scene and take, replays deterministically frame by frame at a fixed fps (never a wall clock), renders each pass to an offscreen target, and encodes.

**Single source of truth:** `src/model/` holds the serializable scene model, which is plain JSON-safe objects with no Three.js types. The Three.js scene graph is derived from it by a sync layer. Never store state only on a `Object3D`; mutate the model through commands (undo/redo) and let the sync layer update Three.js.

Interactive frame loop: `App.tick` → desktop controls → `onFrame` callbacks → render. Objects tagged `userData.helper = true` (grid, gizmos, UI) are excluded from export passes.

## Folder layout

```
src/
  main.ts              entry; wires App and the sidebar
  app/                 App (renderer, scene, rig, loop), environment (floor/grid/lights)
  desktop/             DesktopControls (OrbitControls and WASD/QE)
  xr/                  XRSessionManager (support detection, enter/exit), XRInput (controllers, hands)
  model/               serializable scene/take model and pure logic (unit-tested)
  ui/                  DOM sidebar (desktop); later the in-VR 3D panels
public/                static files copied as-is (favicon, later .glb assets)
```

Planned, per milestone: `sync/` (model to Three.js), `interaction/`, `camera/` (lens math, virtual camera), `take/` (record and playback), `render/` (passes, encoders, zip).

## Conventions

- Pure logic (math, model, serialization, playback timing) lives outside Three.js-dependent files where possible and gets a `*.test.ts` next to it.
- Units: metres, seconds, millimetres for focal length and sensor sizes. Rotations in the model are quaternions `[x, y, z, w]`.
- File formats carry `format` and `version` fields; bump the version and add a migration when the shape changes.
- Controllers are the primary VR input. Hand tracking is rendered but not interactive yet (planned for milestone 7).
- Assets must be CC0 and listed in `ASSETS.md`.
- Keep Quest performance in mind: target 72 fps, avoid per-frame allocations in hot paths, and reuse vectors.

## Commands

```bash
npm install
npm run dev        # http://localhost:5173 (also exposed on the LAN)
npm run check      # lint + typecheck + tests
npm run build      # production build into dist/ with base /PrevizXR/
npm run preview    # serve dist/
```

Testing on a Quest during development: WebXR needs a secure context. Either use `adb reverse tcp:5173 tcp:5173` and open `http://localhost:5173` in the Quest browser, or push to `main` and use the Pages URL.

## Deploy

`.github/workflows/deploy.yml` runs lint, typecheck, tests and build on every push and PR, and deploys `dist/` to GitHub Pages on pushes to `main`. Pages source must be set to "GitHub Actions".

The `window.previz` global exposes the `App` instance for debugging.
