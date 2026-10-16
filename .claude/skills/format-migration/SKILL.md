---
name: format-migration
description: Change the shape of a saved PrevizXR file (scene `previzxr.scene`, take `previzxr.take`, or render manifest `previzxr.render`) safely. Use whenever a change renames, removes, moves or re-types a field in SceneDoc, SceneObject, CameraRig, Take or the manifest, or changes what an existing field means. Adding a new optional field with a default does not need a version bump.
---

# Saved-file format changes

Users have scene and take files on disk and in IndexedDB (`src/storage/`). They must keep opening after every deploy. The rule in CLAUDE.md is: **bump the version and add a migration when the shape changes.**

## Decide whether to bump

| Change | Bump? |
|---|---|
| New optional field with a sensible default when missing | No. Parse it defensively and default it. |
| Rename, move, remove or re-type a field | Yes |
| Same field, new meaning or units | Yes |

## Where things live

| Format | Version constant | Parser | Tests |
|---|---|---|---|
| Scene | `SCENE_FORMAT_VERSION` in `src/model/scene.ts` | `parseScene` in `src/model/serialize.ts` | `src/model/scene.test.ts` |
| Take | `TAKE_FORMAT_VERSION` in `src/model/take.ts` | `parseTake` in `src/model/take.ts` | `src/model/take.test.ts` |
| Render manifest | literal `version` in `buildManifest` (`src/render/manifest.ts`) | none (write-only) | `src/render/export.test.ts` |

The parsers already reject versions *newer* than the app supports. Older versions are accepted and must be upgraded.

## Steps for a bump

1. Bump the constant.
2. In the parser, after the format and version checks and **before** field validation, upgrade old data step by step: `if (data.version < 2) data = migrateV1toV2(data);`. Keep each step a small pure function in the same file, working on plain JSON. Never import Three.js there.
3. Validation runs on the upgraded shape. The parser stays defensive: input is untrusted (imported files, IndexedDB). Invalid nested values are **repaired to defaults** (see `repairPath`, `parseCamera`, light repair) or rejected with the format's error class (`SceneFormatError` / `TakeFormatError`). They must never throw a raw `TypeError`.
4. Tests: add a fixture in the *old* shape (a literal object, not built with current helpers that already produce the new shape) and assert it parses to the expected new shape. Keep the round-trip test passing.
5. If an exported scene embeds data (`embeddedImages` in `Project`) or a take references scene object ids, check both sides still line up.
6. Run `npm run check`.

## Don't

- Mutate stored records in IndexedDB in place. Migrate on read; the next save writes the new version.
- Put per-device preferences into scene files; they belong in `src/app/prefs.ts`.
