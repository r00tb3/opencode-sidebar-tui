// Ships as source on purpose: only the host's transpiler emits the reactive
// Solid children that bun's bundler collapses into a single eager render.
export { default } from "./src/tui.tsx"
