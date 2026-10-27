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
  // Server nginx hijacks /assets (subscription panel proxy), so the build
  // output must not use the default Vite assets directory name.
  build: { target: 'es2022', assetsDir: 'fractol-assets' },
});
