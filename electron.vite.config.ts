import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const sharedAlias = {
  '@shared': resolve(__dirname, 'src/shared')
}

export default defineConfig({
  main: {
    resolve: {
      alias: sharedAlias
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    resolve: {
      alias: sharedAlias
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        },
        output: {
          format: 'cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    publicDir: resolve(__dirname, 'src/renderer/public'),
    // Required for packaged `loadFile`: absolute `/asset.png` becomes `file:///asset.png` and breaks.
    base: './',
    resolve: {
      alias: sharedAlias
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    },
    plugins: [react()]
  }
})
