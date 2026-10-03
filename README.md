# PrevizXR

**Open-source VR previsualization for AI video.** Block out a scene in VR with actors, props and a handheld virtual camera, record camera takes, then export frame-synced video passes (clay, ID color, depth, normals, OpenPose skeletons) to drive generative video models with video-to-video, depth or pose control.

Runs entirely in the browser: Meta Quest 3 for capture, and desktop Chrome/Edge for scene building and rendering. No install, no server, no account.

**Live:** https://sirjoeyama.github.io/PrevizXR/

![PrevizXR screenshot](docs/screenshot.svg)
<!-- Screenshot placeholder: replace docs/screenshot.svg with a real capture -->

> **Status:** early development. Milestones 1–5 of 7 are done: scene building in VR and on desktop, a 2,000+ model library, a virtual camera with real lens controls, take recording and playback, and rendering clay, color_id and depth passes to MP4. See the [roadmap](#roadmap).

## Features

- **Scene building** *(available now)*: four rigged humanoid actors with idle, walk, run and sit clips and waypoint paths you draw on the floor; blockout shapes (box, cylinder, wall, door frame, chair, table, car); 42 bundled furniture, street, vehicle, nature and building models; point and spot lights. Every object gets a flat ID color and a name label. Grab, move, rotate, scale, snap to floor, duplicate, delete, undo and redo, in VR and on desktop. Preview plays actor paths and clips from the start.
- **Model library** *(available now)*: search and place any of the 2,292 [Poly by Google](https://poly.pizza/u/Poly%20by%20Google) models on Poly Pizza (CC-BY 3.0), loaded on demand. Attribution is tracked per scene in the Credits panel. See [ASSETS.md](ASSETS.md).
- **Scenes** *(available now)*: autosaved in the browser (IndexedDB), reopened on the next visit, and importable/exportable as `.previz.json` files.
- **Virtual camera** *(available now)*: a camera you hold in VR (it follows your right controller) or fly on desktop, with a live monitor on the camera body and a picture-in-picture monitor on desktop. Focal length from 14 to 135 mm (presets or continuous) gives the correct field of view for a Super 35 (24.89 × 18.66 mm) or full-frame (36 × 24 mm) sensor at 16:9, 9:16, 2.39:1 or 1:1. Also: 24/25/30 fps, autofocus on the frame centre or manual focus distance, and rule-of-thirds, safe-area and centre guides.

- **Takes** *(available now)*: record a camera move with a 3-2-1 countdown, in VR (hold the camera and pull the trigger) or on desktop (fly the camera in camera view). Actors play their paths from the start while you record. Takes are captured at exactly the lens frame rate (24/25/30 fps), whatever the headset refresh rate, and stored per frame: camera position, rotation, focal length and focus distance, plus every object's transform and each actor's clip and clip time. Play takes back in the headset or on desktop. Smoothing (0–100%) is applied on playback without touching the raw take. Takes are saved in the browser and import/export as `.take.json`.
- **Camera paths** *(available now)*: on desktop, build a keyframed dolly/crane move (smooth spline through keys, with rotation and focal length interpolated), preview it, and save it as a take.

- **Render passes** *(available now)*: **clay**, **color_id** and **depth**, rendered offline frame by frame from a take, all at the same resolution (480p/720p/1080p on the short side) and frame rate. Each pass is encoded to **H.264 MP4** with WebCodecs and [Mediabunny](https://mediabunny.dev), or to a **lossless PNG sequence** (zip) when you need exact ID colors and depth values, or when the browser can't encode H.264. Rendering is deterministic: the same take renders byte-identical frames every time. Shows progress, can be canceled, and keeps running at full speed in a background tab.

Planned:

- **More passes and the export bundle:** normals and OpenPose (COCO-18) passes; the camera as JSON and as an animated glTF; everything for a take in one zip with a `manifest.json`.

## Setup

Requires Node.js 22 or newer.

```bash
git clone https://github.com/SirJoeYama/PrevizXR.git
cd PrevizXR
npm install
npm run dev
```

Open http://localhost:5173.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload (also reachable on your LAN) |
| `npm run check` | Lint, typecheck and unit tests |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |

### Testing in VR

- **Quest 3:** WebXR needs HTTPS or localhost. With the headset connected over USB and developer mode on, run `adb reverse tcp:5173 tcp:5173`, then open `http://localhost:5173` in the Quest browser. Or open the live Pages URL.
- **No headset:** install the [Immersive Web Emulator](https://chromewebstore.google.com/detail/immersive-web-emulator/cgffilbpcibhmcfbgggfhfolhkfbhmik) extension for Chrome/Edge, open DevTools → WebXR, choose a Meta Quest 3 device, and reload. **Enter VR** becomes available.

## Controls

### Desktop

| Input | Action |
| --- | --- |
| Left drag | Orbit |
| Right drag | Pan |
| Mouse wheel | Zoom |
| `W` `A` `S` `D` / arrow keys | Move (click the viewport first) |
| `Q` / `E` | Down / up |
| `Shift` | Move faster |
| Click | Select an object (click empty floor to deselect) |
| `1` / `2` / `3` | Move / rotate / scale gizmo |
| `G` | Snap the selection to the floor |
| `F` | Focus the view on the selection |
| `P` | Draw a path for the selected actor: click the floor to add waypoints, `Esc` to finish |
| `Ctrl+D` / `Delete` | Duplicate / delete |
| `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) | Undo / redo |
| `Space` | Preview actor paths from the start, or stop |
| `C` | Select the camera |
| `V` | Look through the camera (letterboxed); drag to aim, `W` `A` `S` `D` / `Q` `E` to move, wheel to zoom, `V` or `Esc` to exit |
| `M` | Show or hide the camera monitor in the viewport corner |
| `R` | Record a take (3-second countdown), or stop recording |
| `K` | Add a camera path keyframe at the camera's current position |
| `Space` | While a take plays or records: stop |

To render, select a take in the **Takes** panel and click **Render…**. Choose resolution, format and passes, set the depth range (or use **Auto**, which fits near/far to everything the camera sees during the take), then download the files.

Add objects from the **Add** panel in the sidebar: they appear on the floor at the centre of the view, facing you.

### VR (Quest controllers)

| Input | Action |
| --- | --- |
| **B** | Show or hide the menu on your left controller |
| Trigger (pointing at the menu) | Press a button or add the highlighted object in front of you |
| Trigger (pointing at an object) | Select it |
| Trigger (path drawing on) | Add a waypoint where the ray hits the floor |
| Grip | Grab the object under the ray; it stays upright and turns with your wrist |
| Grip + trigger | Grab with free rotation |
| Grip on both controllers | Scale the grabbed object |
| Thumbstick while grabbing | Push/pull along the ray (up/down), turn it (left/right) |
| Left thumbstick | Walk |
| Right thumbstick | Snap turn 30° |
| **A** | Snap the selection to the floor |
| **X** / **Y** | Undo / redo |
| Right thumbstick click | Hold the camera in your right hand (it points where the controller points), or let go |
| Right thumbstick up/down while holding | Zoom (focal length) |
| Trigger while holding the camera | Record a take (3-2-1 countdown), or stop |

The menu's **Takes** tab records, plays and loops takes. The monitor shows the countdown, a red REC timer while recording, and the take name during playback.

The menu's **Camera** tab has focal presets, sensor, aspect, fps, guides and focus, plus **Bring here** to fetch the camera. Grabbing the camera with grip rotates it freely, unlike props, which stay upright. The monitor on top of the camera shows exactly what it records.

The menu's **Library** tab has one-tap searches (chair, car, tree, …) because there's no keyboard in VR. Use the desktop sidebar to search the full library by name.

## Feeding passes into AI video tools

Every pass is rendered from the same camera, at the same resolution and frame rate, so the frames line up exactly. Normals and pose (and the zip bundle) arrive in milestone 6. Typical uses:

| Pass | Use it as |
| --- | --- |
| `depth.mp4` | Depth control (ControlNet depth, Runway/Luma-style structure guidance, Wan/VACE depth conditioning). White means near, black far, linear between the near/far you chose (planar view-space depth). |
| `pose.mp4` | OpenPose control for character motion (ControlNet OpenPose, VACE pose, Animate-style pipelines). COCO-18 keypoints in standard OpenPose colors on black. |
| `clay.mp4` | Source video for video-to-video restyling (Runway Gen-4 V2V, Luma Modify, Kling, ComfyUI AnimateDiff/VACE). Neutral grey with soft studio light (the scene's own lights are ignored), so the model is free to invent materials and lighting. |
| `normals.mp4` | Normal-map control where supported, or as an extra structure cue. |
| `color_id.mp4` | Segmentation-style masks: each actor or prop has a flat, unique color (the swatch in the inspector) on black, handy for regional prompts or compositing masks. The floor is black too. Use the PNG format when you need exact colors, because H.264 slightly shifts colors and blurs edges. |
| `camera.json` / `camera.glb` | The exact camera move, to match it in Blender, Unreal or After Effects, or to drive camera-conditioned models. |

Tips:
- Pick the aspect ratio and fps your target model supports *before* recording (for example 16:9 at 24 fps).
- Keep takes short, around 5–10 s; most models generate clips of that length.
- In ComfyUI, load each pass with a "Load Video" node and route it to the matching ControlNet or preprocessor-bypass input. The passes are already preprocessed.

## Roadmap

1. ✅ Vite + Three.js skeleton, desktop mode, Enter VR, Pages deploy
2. ✅ Spawning and manipulating actors and props in VR and desktop; save/load; Poly by Google library
3. ✅ Virtual camera with live monitor and lens controls
4. ✅ Take recording and playback
5. ✅ Render mode with clay, color_id and depth to MP4
6. Normals and pose passes, camera export, zip bundle
7. Polish: Quest performance (72 fps), docs, menu accessibility, hand tracking

## Contributing

See [CLAUDE.md](CLAUDE.md) for the architecture, folder layout and conventions. Assets must be CC0 or CC-BY and listed in [ASSETS.md](ASSETS.md).

## License

Code: [MIT](LICENSE). Models are CC0 (Quaternius actors) or CC-BY 3.0 (Poly by Google); see [ASSETS.md](ASSETS.md). Credit CC-BY models when you publish renders that use them.
