import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    // Runtime media and browser evidence must not reload an in-progress creation form.
    watch: { ignored: ['**/var/**', '**/dist/**', '**/research/**'] },
    proxy: { '/api': { target: 'http://127.0.0.1:4310', changeOrigin: false } },
  },
  build: {
    outDir: 'dist/web',
    // Open sessions may still request chunks from the previous frontend build.
    emptyOutDir: false,
    sourcemap: true,
    chunkSizeWarningLimit: 750,
    rollupOptions: {
      output: {
        manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], editor: ['fabric'] },
      },
    },
  },
});
