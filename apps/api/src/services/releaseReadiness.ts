import {
  aiConfigured,
  config,
  firebaseConfigured,
  robloxOAuthConfigured,
  supabaseConfigured
} from "./config.js";

export type ReadinessSeverity = "error" | "warn";

export interface ReadinessCheck {
  id: string;
  severity: ReadinessSeverity;
  message: string;
}

export function releaseReadinessChecks(): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];

  if (!config.webAppUrl.startsWith("https://") && config.isProduction) {
    checks.push({
      id: "web-url-https",
      severity: "error",
      message: "WEB_APP_URL must use HTTPS in production."
    });
  }

  if (!config.apiBaseUrl.startsWith("https://") && config.isProduction) {
    checks.push({
      id: "api-url-https",
      severity: "error",
      message: "API_BASE_URL must use HTTPS in production."
    });
  }

  if (!config.cookieSecure && config.isProduction) {
    checks.push({
      id: "secure-cookies",
      severity: "error",
      message: "Cookies must be secure in production."
    });
  }

  if (config.allowPrivateOwnerLogin && config.isProduction) {
    checks.push({
      id: "private-owner-login",
      severity: "error",
      message: "Private owner login must be disabled in production."
    });
  }

  if (process.env.VECTIS_VISUAL_ADMIN === "true" && config.isProduction) {
    checks.push({
      id: "visual-admin-bypass",
      severity: "error",
      message: "VECTIS_VISUAL_ADMIN must be unset or false in production."
    });
  }

  if (config.useSupabase && config.isProduction && config.applyDatabaseSchemaOnStartup && !process.env.SUPABASE_DB_URL) {
    checks.push({
      id: "supabase-db-url",
      severity: "error",
      message: "SUPABASE_DB_URL is required when startup schema reconciliation is enabled in production."
    });
  }

  if (config.useSupabase && config.isProduction && !config.applyDatabaseSchemaOnStartup && !process.env.SUPABASE_DB_URL) {
    checks.push({
      id: "supabase-db-url-deploy",
      severity: "warn",
      message: "SUPABASE_DB_URL is not required at runtime, but deployment schema scripts need it when database changes ship."
    });
  }

  if (config.allowLocalFileStore && config.isProduction) {
    checks.push({
      id: "local-file-store",
      severity: "error",
      message: "Local JSON persistence must be replaced before production."
    });
  }

  if (!config.databaseUrl && !config.useSupabase) {
    checks.push({
      id: "database-url",
      severity: config.isProduction ? "error" : "warn",
      message: "DATABASE_URL or Supabase persistence is not configured. Local or memory storage is suitable only for private alpha."
    });
  }

  if (config.useSupabase && (!config.supabase.url || !config.supabase.serviceKey)) {
    checks.push({
      id: "supabase-credentials",
      severity: config.isProduction ? "error" : "warn",
      message: "Supabase persistence requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    });
  }

  if (config.isProduction && !config.useSupabase && !config.databaseUrl) {
    checks.push({
      id: "durable-database",
      severity: "error",
      message: "Production requires Supabase or another durable database."
    });
  }

  if (!config.stripe.secretKey) {
    checks.push({
      id: "stripe-secret-key",
      severity: config.isProduction ? "error" : "warn",
      message: "STRIPE_SECRET_KEY is not configured."
    });
  }

  if (!config.stripe.proPriceId && (!config.stripe.proAmountCents || !config.stripe.proCurrency)) {
    checks.push({
      id: "stripe-pro-price",
      severity: "warn",
      message: "Configure STRIPE_PRO_PRICE_ID or STRIPE_PRO_AMOUNT_CENTS plus STRIPE_PRO_CURRENCY."
    });
  }

  if (!config.stripe.webhookSecret) {
    checks.push({
      id: "stripe-webhook-secret",
      severity: config.isProduction ? "error" : "warn",
      message: "STRIPE_WEBHOOK_SECRET is not configured."
    });
  }

  if (config.adminEmails.length === 0) {
    checks.push({
      id: "admin-emails",
      severity: config.isProduction ? "error" : "warn",
      message: "ADMIN_EMAILS is empty, so no user can access admin tools."
    });
  }

  if (!firebaseConfigured() && !robloxOAuthConfigured() && !supabaseConfigured()) {
    checks.push({
      id: "auth-provider",
      severity: config.isProduction ? "error" : "warn",
      message: "No external auth provider is configured."
    });
  }

  if (!aiConfigured()) {
    checks.push({
      id: "ai-provider",
      severity: config.isProduction ? "error" : "warn",
      message: "No AI provider is configured for code generation."
    });
  }

  return checks;
}

export function assertReleaseReadyForProduction() {
  if (!config.isProduction) return;

  const errors = releaseReadinessChecks().filter((check) => check.severity === "error");
  if (errors.length > 0) {
    throw new Error(
      `Production readiness failed: ${errors.map((error) => `${error.id}: ${error.message}`).join(" ")}`
    );
  }
}
