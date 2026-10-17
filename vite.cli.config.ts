import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Bundles the CLI into a single Node script. Runtime deps (quickjs-emscripten, yaml, nanoid) stay
// external and come from node_modules; crypto-js/lodash are inlined because the sandbox imports
// them as ?raw source.
export default defineConfig({
  resolve: { alias: { '@core': resolve(__dirname, 'src/core') } },
  ssr: { noExternal: ['crypto-js', 'lodash'] },
  build: {
    ssr: resolve(__dirname, 'src/cli/index.ts'),
    outDir: 'out/cli',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      output: { format: 'cjs', entryFileNames: 'apiman.cjs', banner: '#!/usr/bin/env node' }
    }
  }
})
