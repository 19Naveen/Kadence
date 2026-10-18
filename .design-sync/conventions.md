# Kadence design system — how to build with it

Kadence is a data workbench (import, shape, query data). Its look is quiet and dense: neutral
surfaces, one blue for interaction, amber only where data changed. Build screens like a mature
data tool (toolbars, panes, tables, 1px separators), not a marketing page.

## Setup

No provider or wrapper is needed: every component renders on its own. Styling comes entirely
from the stylesheet (`styles.css`, which imports `_ds_bundle.css` and IBM Plex from Google Fonts).
Set the page background yourself: `<div className="bg-bg text-text font-sans">`.
`Dialog` is controlled: render it with `open={true}` and handle `onClose`; it portals to `document.body`.

## Styling idiom: component classes + Tailwind utilities + tokens

Use the component classes first; they carry size, radius, focus ring and states.

| Need | Classes |
|---|---|
| Buttons (32px) | `btn btn-primary`, `btn btn-secondary`, `btn btn-ghost`, `btn btn-danger`; add `btn-sm` (28px); icon-only: `btn-icon` + `aria-label` |
| Form fields | `input` (inputs and selects), `field-label`, `field-hint` |
| Containers | `card` (rounded-lg, border, p-5), `card-hover` |
| Small labels | `badge` (neutral), `section-label` (small tertiary text, never uppercase), `kbd`, `tabular` (aligned numbers) |
| Table rows | `table-row` |

Colour utilities: surfaces `bg-bg` (canvas), `bg-surface` (panels), `bg-surface-2` (wells, sidebars),
`bg-surface-3` (hover/active); text `text-text`, `text-text-secondary`, `text-text-tertiary`; lines
`border-border`, `border-border-subtle`; interaction `bg-primary`, `text-primary`, `bg-primary-muted`
(selected rows); data change only `text-signal`, `bg-signal-muted`; status `text-danger`,
`bg-danger-muted`, `text-success`, `text-warning`, `bg-warning-muted`.

Only utilities the app already uses are compiled in. When a utility or colour isn't available, use an
inline style with the token: tokens are HSL triplets, so write `hsl(var(--primary))`,
`hsl(var(--border))`, `hsl(var(--text-secondary))` (also `--surface`, `--surface-2`, `--signal`, `--danger`).

Rules: sentence-case labels; no uppercase eyebrows, gradients, decorative coloured pills or radii above
`rounded-lg`; `font-mono` for data, numbers, column names and SQL; dense 13px text in tools.

## Icons

lucide-react icons are exported on the same global, e.g. `Upload`, `Database`, `Plus`, `Search`, `X`,
`Check` — use them at `size={15}` or `16` in toolbars and buttons.

## Where the truth lives

Read `styles.css` → `_ds_bundle.css` (tokens under `:root`, component classes such as `.btn`, `.input`,
`.card`) and each component's `<Name>.d.ts` and `<Name>.prompt.md` before styling.

## Example

```jsx
<div className="bg-bg text-text font-sans p-6">
  <PageHeader
    title="Data sources"
    subtitle="Upload files or connect a database."
    actions={<button className="btn btn-primary"><Upload size={15} /> Add data</button>}
  />
  <div className="card p-0">
    <div className="flex items-center justify-between border-b border-border px-4 py-2">
      <span className="text-sm font-medium">orders</span>
      <span className="tabular font-mono text-xs text-text-tertiary">60 rows · v2</span>
    </div>
  </div>
</div>
```
