# Vibe coding figures — Figma import

Assets for **FIGURE 1** and **FIGURE 2** from the vibe coding paper, following the [`figma-generate-diagram`](https://github.com/cursor-public/figma-skills) workflow.

## Cloud Agent limitation

Figma MCP (`generate_diagram`) is **not authenticated** in Cloud Agent (OAuth unavailable / timeout). Use the files below, or run the same steps on **Cursor Desktop** with Figma MCP connected.

---

## FIGURE 1 — Dialogue process (three columns)

### Option A: Import SVG (closest to the paper)

1. Open Figma Design or FigJam.
2. **File → Import** → `vibe-coding-figure-1.svg`.

### Option B: `generate_diagram` (Desktop + Figma MCP)

Per **figma-generate-diagram** Step 6:

- **name:** `Vibe Coding Figure 1 — Process Flow`
- **mermaidSyntax:** contents of `vibe-coding-figure-1.mmd`

---

## FIGURE 2 — Paradigm shift (traditional vs vibe coding)

### Option A: Import SVG (closest to the paper)

1. **File → Import** → `vibe-coding-figure-2.svg`  
   Includes Human / Intent Mediation Gap / Computer bands, purple vs orange mediation, and numbered callouts **1–5**.

### Option B: `generate_diagram` (Desktop + Figma MCP)

- **name:** `Figure 2 — Deterministic vs Probabilistic Intent Mediation`
- **mermaidSyntax:** contents of `vibe-coding-figure-2.mmd`
- **userIntent:** Compare traditional deterministic mediation with vibe coding probabilistic mediation

### Option C: Hybrid workflow (optional, per `references/workflow.md`)

If the FigJam layout from Mermaid is enough structurally but callouts **1–5** need to match the paper:

1. Call `generate_diagram` as in Option B; save the returned `figma.com/board/{fileKey}/...` URL.
2. Load **figma-use-figjam** skill; call `use_figma` with the same `fileKey` to add yellow label circles and a legend (see workflow recipe: Annotations).

For this figure, **Option A (SVG)** already includes callouts **1–5**; hybrid is only needed when starting from Mermaid.
