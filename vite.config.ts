import { defineConfig } from 'vite'

// Served at slade.ninja/hoverjuice and sladequinn.github.io/hoverjuice
export default defineConfig({
  base: '/hoverjuice/',
  preview: {
    allowedHosts: true,
  },
})
