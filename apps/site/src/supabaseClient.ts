import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type SupabaseBrowserConfig = {
  url: string;
  anonKey: string;
};

const storageKey = "vectis-supabase-auth";
let cachedClient: SupabaseClient | undefined;
let cachedKey = "";

function authParamsFromCurrentUrl() {
  const url = new URL(window.location.href);
  return {
    url,
    code: url.searchParams.get("code"),
    error: url.searchParams.get("error_description") || url.searchParams.get("error")
  };
}

function clearAuthParams(url: URL) {
  ["code", "state", "error", "error_code", "error_description"].forEach((param) => {
    url.searchParams.delete(param);
  });
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function supabaseClient(config: SupabaseBrowserConfig) {
  const key = `${config.url}|${config.anonKey}`;
  if (!cachedClient || cachedKey !== key) {
    cachedClient = createClient(config.url, config.anonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        persistSession: true,
        storageKey
      }
    });
    cachedKey = key;
  }
  return cachedClient;
}

export async function signInWithSupabaseGoogle(config: SupabaseBrowserConfig) {
  const supabase = supabaseClient(config);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/`
    }
  });
  if (error) throw error;
}

export async function completeSupabaseOAuth(config: SupabaseBrowserConfig) {
  const { url, code, error: oauthError } = authParamsFromCurrentUrl();
  if (!code && !oauthError) return undefined;

  try {
    if (oauthError) throw new Error(oauthError);
    const supabase = supabaseClient(config);
    const { data, error } = await supabase.auth.exchangeCodeForSession(code!);
    if (error) throw error;
    return data.session?.access_token;
  } finally {
    clearAuthParams(url);
  }
}

export async function clearSupabaseSession(config: SupabaseBrowserConfig) {
  const supabase = supabaseClient(config);
  await supabase.auth.signOut({ scope: "local" });
}
