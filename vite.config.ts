import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from '@tomjs/vite-plugin-electron'
import tsConfigPaths from 'vite-tsconfig-paths'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron(),
    tsConfigPaths(),
  ],
})