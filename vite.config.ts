import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    // No `define:` block. It previously inlined GEMINI_API_KEY into the bundle, which
    // ships a model key to every browser that loads the app. Model keys belong in
    // server-only env (a Vercel Function), never in client code — see CLAUDE.md
    // §Conventions. Nothing read the key, so removing it changed no behaviour.
    //
    // If a variable genuinely needs to reach the client, give it a `VITE_` prefix and
    // read it as `import.meta.env.VITE_*`. That prefix is Vite's own signal that a value
    // is public: only `VITE_`-prefixed vars are exposed, so an unprefixed secret cannot
    // reach the bundle by accident. Never put a model key or a service-role key there.
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Opt-out escape hatch: set DISABLE_HMR=true when an agent is editing files in bulk,
      // so the dev server does not reload on every intermediate write. Inherited from the
      // Google AI Studio scaffold, kept because it is still useful here.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
