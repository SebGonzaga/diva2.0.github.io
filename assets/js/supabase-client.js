/* =========================================================================
   RAIN — Supabase client
   Publishable key is safe to expose in frontend code — it identifies your
   project but grants no access beyond what your Row Level Security
   policies (see supabase/schema.sql) allow.
   Requires the Supabase JS CDN script to be loaded BEFORE this file:
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   ========================================================================= */
const SUPABASE_URL = "https://ajvjxqdylnysmvlajvdr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_jgfGCr4QV6bJCppnEG8Pew_jwuGP472";

// If the Supabase library failed to load (offline with an empty cache, CDN
// blocked), fall back to an inert client instead of throwing. Every call
// resolves to { data: null, error } with no error.code, which the app
// already treats as "network problem": RainAuth.init() keeps the cached
// user and pages fall back to their RainOffline snapshots.
function makeOfflineClient() {
  const result = { data: null, error: { message: "Supabase library unavailable (offline)" } };
  const chain = new Proxy(function () {}, {
    get: (_t, prop) => (prop === "then" ? (res, rej) => Promise.resolve(result).then(res, rej) : chain),
    apply: () => chain,
  });
  const authResult = { data: { session: null, user: null }, error: result.error };
  return {
    from: () => chain,
    channel: () => chain,
    removeChannel: () => Promise.resolve("ok"),
    storage: { from: () => chain },
    auth: new Proxy({}, { get: () => () => Promise.resolve(authResult) }),
  };
}

const sb = typeof supabase !== "undefined"
  ? supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : makeOfflineClient();
