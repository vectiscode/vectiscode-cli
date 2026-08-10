# Local Setup

## Firebase Login

Firebase Auth is the normal login/register path. It is the only Google-backed runtime feature.

Use Firebase Console:

1. Select the Firebase project.
2. Enable Authentication -> Sign-in method -> Google.
3. Add or open the Web app.
4. Copy the Firebase config values into `.env`.

```text
FIREBASE_PROJECT_ID=
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_APP_ID=
FIREBASE_STORAGE_BUCKET=
FIREBASE_MESSAGING_SENDER_ID=
```

The frontend signs in with Firebase Google popup, sends the Firebase ID token to the API, and the API verifies it against Firebase public certificates.

## Supabase

Local development can use `DATABASE_MODE=local`. Production must use Supabase:

```text
DATABASE_MODE=supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=vectis-attachments
```

Apply `supabase/schema.sql` to create the private document table and Storage bucket.

## AI Providers

Do not configure Vertex AI, Gemini API keys, Firestore, or Cloud Run credentials.

Use non-Google AI providers:

```text
YUNWU_API_KEY=
YUNWU_BASE_URL=https://yunwu.ai/v1
YUNWU_PREFER=true
XIAOMI_API_KEY=
DEEPSEEK_API_KEY=
```

Use the non-Google provider keys above for AI features. Firebase remains only for browser login.

## Roblox Login

Roblox OAuth is optional and separate from Roblox API keys.

Register an OAuth app in Roblox Creator Dashboard, request `openid profile`, and set:

```text
ROBLOX_OAUTH_CLIENT_ID=
ROBLOX_OAUTH_CLIENT_SECRET=
ROBLOX_OAUTH_REDIRECT_URI=https://api.vectiscode.com/auth/roblox/callback
```

If your Creator Dashboard only shows API Extensions, keep using private owner mode locally. The Studio connector does not require Roblox OAuth locally.
