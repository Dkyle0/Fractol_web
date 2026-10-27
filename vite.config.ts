import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: true,
    // Private snapshots and reports are not application inputs. Frozen source
    // snapshots can still be requested explicitly by isolated diagnostics.
    watch: { ignored: ['**/.local/**', '**/artifacts/**', '**/test-results/**', '**/playwright-report/**'] },
  },
  build: { target: 'es2022' },
});
