# Jormunvector

A browser vector editor built so an AI can read vector art as data and make precise micro-adjustments to it.

```
npm install
npm run dev     # editor at http://localhost:5173
npm test        # describe + ops unit tests
npm run build   # single-file dist/index.html
```

## AI panel

- **create**: describe something and the AI draws new shapes. Without a Gemini key it falls back to built-in keyword shapes.
- **edit**: describe a change, like "eyes 10% bigger" or "soften the left ear's tip". The AI gets the scene description plus a rendered PNG with each shape's ref printed on it. It replies with a list of small operations. Each one shows up checked in a review list, with the result ghosted in orange on the canvas. Untick any you don't want, then **apply checked**. ⌘Z undoes the whole batch.
  - Select shapes first to focus the AI on them.
  - **copy for any AI** copies the instructions and scene so you can paste them into any chatbot. Paste its JSON reply back into the prompt box and press **Propose edits**.
  - Double-click a shape in the Shapes list to name it. Names like "left ear" give the AI something to anchor on.

## Scene description (`js/describe.js`)

`describeScene(shapes, groups, { selectedIds })` returns `jormunvector.scene/1` JSON:

- per shape: `ref` (`s3`), `label`, `kind`, style, `bounds`, `center`, `area`, `length`, and self-`symmetric` axes
- for paths: every node with its `in`/`out` handles, `joint` (corner, smooth or end) and `turn` angle
- `relations`: `contains`, `overlaps`, `touches`, `mirrors` (with the axis), `centered-x`, `centered-y`
- `summary`: a plain-text digest of all of the above

Imported SVG paths are parsed into editable nodes when they are a single subpath without arcs. Anything else becomes a `compound-path`, which only accepts whole-shape ops.

## Edit operations (`js/ops.js`)

`applyOps(shapes, ops)` is pure: it returns new shapes plus a per-op `{ ok, error }`. `OPS_SPEC` lists every op:

- whole-shape: `move`, `scale`, `rotate`, `mirror`, `set_style`, `label`, `reorder`, `duplicate`, `delete`
- primitives: `set_params`
- nodes: `move_node`, `set_node`, `move_handle`, `set_handle`, `smooth_node`, `set_segment`, `insert_node`, `delete_node`, `set_closed`
- new shapes: `add`

Locked shapes and locked nodes are refused.
