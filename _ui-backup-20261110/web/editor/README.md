# CanvasEditor integration

`CanvasEditor` is a controlled Fabric 7 editor. Its public props are in `types.ts`:

```tsx
<CanvasEditor
  scene={document.scene}
  onChange={setLocalDraft}
  assets={authorizedReferencedAssets}
  onUpload={uploadToWorkspace}
  readOnly={!canEdit}
/>
```

The parent owns saving, `expectedRevision`, version history, conflict resolution and pending task results. An `onChange` updates a local draft; it does not mean that the backend has saved. Do not overwrite a newer local draft with an older save response. Mount with a document/workspace key when switching contexts.

`assets` must include every ID returned by `getSceneAssetIds(scene)`, including group children and video posters, plus any optional assets shown in the picker. A first-page-only list is insufficient for old documents. The server must authorize each asset. `originalUrl` must point to the actual original; the renderer never substitutes thumbnails for originals. Missing media is visibly marked, and strict export fails instead of exporting the placeholder.

The independent scene format and its request/output Zod schemas are in `../../contracts/scene.ts`. Request validation has a pre-recursion depth/size guard. Use `sceneDocumentOutputSchema` for response serialization, because Fastify's Zod response encoder cannot encode input preprocessors. Never persist Fabric's own arbitrary JSON. Coordinates are pixels from the top-left, children are relative to their group's top-left, layer arrays are back-to-front. The adapter translates Fabric's group-center coordinate system explicitly.

The component owns selection, geometry, keyboard controls, zoom/pan, undo/redo, layer ordering/visibility/locking, grouping, text/shape styling, source-pixel image crop and raster export. PNG/JPG export creates a separate StaticCanvas with the same adapter, original media, ready fonts and no editor overlays. Export is capped at 67,108,864 pixels. The source canvas is never resized or mutated by export.

Video layers keep original media ID, optional poster, real duration and trim range. The editor shows a paused frame at the trim start when no poster exists; the properties panel plays the original over the selected interval. PNG/JPG are explicitly static images. The original download remains an original; creating a trimmed MP4 belongs to the server's real video-processing tool.

Async scene loads are abortable, superseded loads cannot replace a newer draft, and old video elements are released when their Fabric objects are replaced. Export refuses missing media. Numeric fields commit on blur/Enter and retain invalid drafts with a message; Escape restores the current value. This permits intermediate negative/decimal input without corrupting a scene or creating an undo entry per digit.

Tests in `scene.test.ts` cover validation, response encoding, recursive resource references, transform composition, group/ungroup, alignment, identity regeneration and media placement. Browser evidence and remaining whole-app integration obligations are recorded in `../../../../reviews/phase-4-editor-self-review.md`.
