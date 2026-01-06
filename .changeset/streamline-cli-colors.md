---
"@radkode/neo": patch
---

Streamline CLI output styling with reduced color palette

- Reduce color palette from 7 to 4 semantic colors (primary, success, error, muted)
- Simplify banner gradient from 6 colors to 3 blue shades
- Update info() and step() to use muted gray for cleaner output
- Unify logger to use Colors constant for consistent styling
