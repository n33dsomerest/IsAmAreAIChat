/**
 * shadcn/ui (nova preset) emits components that import `cn` from the `cn`
 * package. Re-exporting it here keeps the `utils` alias in components.json
 * valid so future `shadcn add` runs land in the same place, and gives app code
 * a single import path for class merging.
 */
export { cn } from 'cn';