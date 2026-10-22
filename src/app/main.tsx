import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './index.css';

const root = document.getElementById('root')!;

const showFatal = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  root.innerHTML = '';

  const pre = document.createElement('pre');
  pre.textContent = message;
  pre.style.cssText =
    'margin:0;padding:2rem;font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;' +
    'white-space:pre-wrap;color:#b91c1c;background:#fef2f2;min-height:100vh;';

  root.appendChild(pre);
};

// `App` is imported dynamically, not statically, and that is load-bearing: static imports
// are hoisted and evaluated before any statement in this file, so a config error thrown
// while `src/lib/supabase.ts` initialises would escape before a try/catch here could see
// it — the page goes blank and the message reaches only the console. Importing inside the
// promise chain puts that evaluation somewhere catchable, which is what lets a missing
// VITE_SUPABASE_* var render as a readable message instead of a white screen.
import('./App.tsx')
  .then(({default: App}) => {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((error) => {
    showFatal(error);
    throw error;
  });
