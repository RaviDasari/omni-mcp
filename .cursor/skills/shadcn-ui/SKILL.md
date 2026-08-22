---
name: shadcn-ui
description: Install and use shadcn/ui primitives in the omni-mcp Vite web UI. Use when adding UI components, theming, Tailwind classes, or working under web/.
---

# shadcn/ui (omni-mcp)

## When to use

Any new control in `web/` that already exists in shadcn (Button, Card, Dialog, Input, Select, Table, Tabs, Switch, Alert, Badge, Dropdown Menu).

## Install

From `web/`:

```bash
npx shadcn@latest add button
```

Config: [`web/components.json`](../../../web/components.json). Aliases: `@/components`, `@/components/ui`, `@/lib/utils`, `@/hooks`.

Do not hand-roll a primitive that is in the registry. Do not edit files under `web/src/components/ui/` except via the CLI.

## Look

Confluence-blue tokens live in `web/src/index.css` (`data-theme` light/dark). Prefer `var(--accent-primary)` for accents.

## Reference

Full component index: [`.github/shadcn.md`](../../../.github/shadcn.md)
