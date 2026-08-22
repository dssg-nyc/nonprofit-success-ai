/// <reference types="vite/client" />

// Only VITE_-prefixed vars reach the client bundle. Anything declared here is public by
// definition — never declare a model key or a Supabase service-role key in this interface.
interface ImportMetaEnv {
  // The anon key is public by design: RLS is what constrains it, not secrecy.
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
