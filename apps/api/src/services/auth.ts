import type { Request, Response } from "express";
import { nanoid } from "nanoid";
import { createVerify } from "node:crypto";
import { config } from "./config.js";
import { store } from "./store.js";

export const sessionCookieName = "ras_session";
export const csrfCookieName = "ras_csrf";
const oauthStateCookieName = "ras_oauth_state";
const oauthModeCookieName = "ras_oauth_mode";

export function readCookie(req: Request, name: string) {
  const header = req.headers.cookie;
  if (!header) return undefined;

  const cookies = header.split(";").map((item) => item.trim());
  const found = cookies.find((item) => item.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : undefined;
}

export async function currentUser(req: Request) {
  return store.resolveAuthSessionUser(readCookie(req, sessionCookieName));
}

export async function requireUser(req: Request, res: Response) {
  const user = await currentUser(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return undefined;
  }
  return user;
}

function clearCookieEverywhere(res: Response, name: string) {
  res.clearCookie(name, { path: "/" });
  if (config.cookieDomain) {
    res.clearCookie(name, { path: "/", domain: config.cookieDomain });
  }
}

export async function setSessionCookie(res: Response, userId: string) {
  const csrfToken = nanoid(32);
  const session = await store.saveAuthSession({
    id: `auth_${nanoid(32)}`,
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString()
  });
  clearCookieEverywhere(res, sessionCookieName);
  clearCookieEverywhere(res, csrfCookieName);
  res.cookie(sessionCookieName, session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    domain: config.cookieDomain,
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
  res.cookie(csrfCookieName, csrfToken, {
    httpOnly: false,
    sameSite: "lax",
    secure: config.cookieSecure,
    domain: config.cookieDomain,
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
  return session;
}

export async function clearSessionCookie(req: Request, res: Response) {
  const sessionId = readCookie(req, sessionCookieName);
  if (sessionId) await store.deleteAuthSession(sessionId);
  clearCookieEverywhere(res, sessionCookieName);
  clearCookieEverywhere(res, csrfCookieName);
}

export function setOAuthStateCookie(res: Response, mode?: "popup") {
  const state = nanoid(32);
  res.cookie(oauthStateCookieName, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    domain: config.cookieDomain,
    path: "/",
    maxAge: 1000 * 60 * 10
  });
  if (mode) {
    res.cookie(oauthModeCookieName, mode, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.cookieSecure,
      domain: config.cookieDomain,
      path: "/",
      maxAge: 1000 * 60 * 10
    });
  }
  return state;
}

export function validateOAuthState(req: Request, res: Response, state: string) {
  const expected = readCookie(req, oauthStateCookieName);
  clearCookieEverywhere(res, oauthStateCookieName);
  return Boolean(expected && state && expected === state);
}

export function isOAuthPopup(req: Request) {
  return readCookie(req, oauthModeCookieName) === "popup";
}

export function clearOAuthModeCookie(res: Response) {
  clearCookieEverywhere(res, oauthModeCookieName);
}

export function sendOAuthPopupResult(res: Response, ok: boolean) {
  const targetOrigin = JSON.stringify(new URL(config.webAppUrl).origin);
  res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Signing in to Vectis Code...</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        margin: 0;
        padding: 0;
        background: #FDF6E3;
        color: #3F3525;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100vh;
        overflow: hidden;
      }
      .container {
        text-align: center;
        animation: fadeIn 0.3s ease-out;
      }
      .logo {
        width: 64px;
        height: 64px;
        margin-bottom: 24px;
        animation: pulse 1.5s infinite ease-in-out;
      }
      .text {
        font-size: 16px;
        font-weight: 500;
        letter-spacing: -0.01em;
        color: #3F3525;
      }
      .subtext {
        font-size: 13px;
        color: #6C5F49;
        margin-top: 8px;
      }
      @keyframes fadeIn {
        from { opacity: 0; transform: scale(0.96); }
        to { opacity: 1; transform: scale(1); }
      }
      @keyframes pulse {
        0%, 100% { transform: scale(1); opacity: 0.9; }
        50% { transform: scale(1.08); opacity: 1; filter: drop-shadow(0 4px 12px rgba(201, 120, 34, 0.15)); }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <img src="https://vectiscode.com/images/logo-96.webp" class="logo" alt="Vectis Code" onerror="this.style.display='none'" />
      <div class="text">Completing secure sign in...</div>
      <div class="subtext">You can close this window if it doesn't close automatically.</div>
    </div>
    <script>
      try {
        if (window.opener) {
          window.opener.postMessage({ type: "vectis:oauth", ok: ${ok ? "true" : "false"} }, ${targetOrigin});
        }
      } catch (e) {
        console.error(e);
      }
      setTimeout(() => {
        try {
          window.close();
        } catch (e) {
          console.error(e);
        }
      }, 400);
    </script>
  </body>
</html>`);
}

export function robloxAuthorizeUrl(state: string) {
  const params = new URLSearchParams({
    client_id: config.roblox.clientId,
    redirect_uri: config.roblox.redirectUri,
    response_type: "code",
    scope: "openid profile",
    state
  });
  return `https://apis.roblox.com/oauth/v1/authorize?${params.toString()}`;
}

interface RobloxTokenResponse {
  access_token: string;
}

interface RobloxUserInfo {
  sub: string;
  name?: string;
  nickname?: string;
  preferred_username?: string;
  picture?: string;
}

export async function exchangeRobloxCode(code: string) {
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.roblox.clientId,
    client_secret: config.roblox.clientSecret,
    redirect_uri: config.roblox.redirectUri
  });

  const tokenResponse = await fetch("https://apis.roblox.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody
  });

  if (!tokenResponse.ok) {
    throw new Error(`Roblox token exchange failed: ${tokenResponse.status}`);
  }

  const token = (await tokenResponse.json()) as RobloxTokenResponse;
  const userResponse = await fetch("https://apis.roblox.com/oauth/v1/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` }
  });

  if (!userResponse.ok) {
    throw new Error(`Roblox userinfo failed: ${userResponse.status}`);
  }

  const info = (await userResponse.json()) as RobloxUserInfo;
  return store.upsertRobloxUser({
    robloxUserId: info.sub,
    name: info.name ?? info.nickname ?? info.preferred_username ?? `Roblox ${info.sub}`,
    robloxUsername: info.preferred_username,
    avatarUrl: info.picture
  });
}

interface FirebaseJwtHeader {
  alg?: string;
  kid?: string;
}

interface FirebaseJwtPayload {
  aud?: string;
  iss?: string;
  sub?: string;
  user_id?: string;
  exp?: number;
  iat?: number;
  name?: string;
  email?: string;
  picture?: string;
}

const FIREBASE_CERT_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const FIREBASE_TOKEN_CLOCK_SKEW_SECONDS = 300;
let firebaseCertCache: { expiresAt: number; certs: Record<string, string> } | undefined;

function base64UrlToBuffer(input: string) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function decodeJwtPart<T>(input: string): T {
  return JSON.parse(base64UrlToBuffer(input).toString("utf8")) as T;
}

async function fetchFirebaseCerts() {
  if (firebaseCertCache && firebaseCertCache.expiresAt > Date.now()) return firebaseCertCache.certs;

  const response = await fetch(FIREBASE_CERT_URL);
  if (!response.ok) throw new Error(`Firebase certificate fetch failed: ${response.status}`);

  const certs = await response.json() as Record<string, string>;
  const cacheControl = response.headers.get("cache-control") ?? "";
  const maxAgeSeconds = Number(/max-age=(\d+)/i.exec(cacheControl)?.[1] ?? 300);
  firebaseCertCache = {
    certs,
    expiresAt: Date.now() + Math.max(60, maxAgeSeconds - 60) * 1000
  };
  return certs;
}

async function verifyFirebaseJwt(idToken: string) {
  const [encodedHeader, encodedPayload, encodedSignature] = idToken.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("Invalid Firebase ID token.");
  }

  const header = decodeJwtPart<FirebaseJwtHeader>(encodedHeader);
  const payload = decodeJwtPart<FirebaseJwtPayload>(encodedPayload);
  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Invalid Firebase ID token header.");
  }

  const cert = (await fetchFirebaseCerts())[header.kid];
  if (!cert) throw new Error("Firebase signing certificate was not found.");

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();
  if (!verifier.verify(cert, base64UrlToBuffer(encodedSignature))) {
    throw new Error("Firebase ID token signature is invalid.");
  }

  const projectId = config.firebase.projectId;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!projectId || payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error("Firebase ID token audience or issuer is invalid.");
  }
  if (!payload.sub || payload.sub.length > 128) throw new Error("Firebase ID token subject is invalid.");
  if (typeof payload.exp !== "number" || payload.exp <= nowSeconds - FIREBASE_TOKEN_CLOCK_SKEW_SECONDS) {
    throw new Error("Firebase ID token has expired.");
  }
  if (typeof payload.iat !== "number" || payload.iat > nowSeconds + FIREBASE_TOKEN_CLOCK_SKEW_SECONDS) {
    throw new Error("Firebase ID token issue time is invalid.");
  }

  return payload;
}

export async function verifyFirebaseIdToken(idToken: string) {
  const decoded = await verifyFirebaseJwt(idToken);
  const uid = decoded.user_id ?? decoded.sub;
  if (!uid) throw new Error("Firebase ID token user id is missing.");
  return store.upsertFirebaseUser({
    firebaseUserId: uid,
    name: decoded.name ?? decoded.email ?? "Google user",
    email: decoded.email,
    avatarUrl: decoded.picture
  });
}

export async function verifySupabaseIdToken(idToken: string) {
  if (!store.supabase) {
    throw new Error("Supabase is not configured yet.");
  }
  try {
    const url = new URL(config.supabase.url);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.endsWith(".supabase.co")) {
      throw new Error("invalid host");
    }
  } catch {
    throw new Error("Supabase project URL is invalid.");
  }
  const { data: { user }, error } = await store.supabase.auth.getUser(idToken);
  if (error || !user) {
    throw new Error(error?.message || "Invalid Supabase ID token.");
  }
  return store.upsertSupabaseUser({
    supabaseUserId: user.id,
    name: user.user_metadata.full_name || user.email || "Google user",
    email: user.email,
    avatarUrl: user.user_metadata.avatar_url
  });
}
