import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = { '@core': resolve(__dirname, 'src/core') }

export default defineConfig({
  // crypto-js and lodash are imported as ?raw source for the script sandbox, so they must be
  // inlined into the bundle rather than required at runtime.
  main: { plugins: [externalizeDepsPlugin({ exclude: ['crypto-js', 'lodash'] })], resolve: { alias } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  renderer: { plugins: [react()], resolve: { alias } }
})
