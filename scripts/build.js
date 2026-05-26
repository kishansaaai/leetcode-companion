import { build } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

async function runBuild() {
  console.log('Building popup page...');
  await build({
    root,
    build: {
      rollupOptions: {
        input: {
          popup: path.resolve(root, 'popup.html'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js',
          assetFileNames: '[name].[ext]',
        }
      },
      outDir: 'dist',
      emptyOutDir: true, // Empty once at first
    }
  });

  console.log('Building background worker...');
  await build({
    root,
    build: {
      rollupOptions: {
        input: {
          background: path.resolve(root, 'src/background.ts'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js',
          assetFileNames: '[name].[ext]',
        }
      },
      outDir: 'dist',
      emptyOutDir: false,
    }
  });

  console.log('Building content script...');
  await build({
    root,
    build: {
      rollupOptions: {
        input: {
          content: path.resolve(root, 'src/content.ts'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js',
          assetFileNames: '[name].[ext]',
        }
      },
      outDir: 'dist',
      emptyOutDir: false,
    }
  });

  console.log('Build completed successfully!');
}

runBuild().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
