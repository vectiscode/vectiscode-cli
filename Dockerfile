# Vectis Code API Dockerfile for Hugging Face Spaces or any Node container host

# Stage 1: Install dependencies and compile TypeScript
FROM node:22-slim AS build

WORKDIR /app

# Copy workspace root package files and workspace configs
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
COPY packages/contracts/package.json packages/contracts/package.json

# Install dependencies for API and contracts
RUN npm ci --workspace=apps/api --workspace=packages/contracts

# Copy API source and shared configuration packages
COPY apps/api/ apps/api/
COPY packages/ packages/

# Compile TypeScript
RUN npm run build --workspace=packages/contracts
RUN npm run build --workspace=apps/api

# Stage 2: Production image
FROM node:22-slim AS production

WORKDIR /app

# Copy workspace root package files and workspace configs for resolution
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
COPY packages/contracts/package.json packages/contracts/package.json

# Install production dependencies only
RUN npm ci --workspace=apps/api --workspace=packages/contracts --omit=dev

# Copy compiled output
COPY --from=build /app/apps/api/dist apps/api/dist
COPY supabase/ supabase/

# Hugging Face sets PORT automatically to 7860 for Space containers.
ENV NODE_ENV=production
ENV PORT=7860
ENV DATABASE_MODE=supabase
ENV SUPABASE_URL=https://gcivvtuljjmqimmpbtdi.supabase.co
ENV WEB_APP_URL=https://vectiscode.com
ENV API_BASE_URL=https://api.vectiscode.com
ENV COOKIE_SECURE=true
ENV COOKIE_DOMAIN=.vectiscode.com
ENV ALLOW_PRIVATE_OWNER_LOGIN=false
ENV ALLOW_LOCAL_FILE_STORE=false
ENV PUBLIC_SIGNUPS_ENABLED=false
ENV FREE_TIER_MODE=true
ENV DURABLE_RATE_LIMITS=true
ENV JSON_BODY_LIMIT=2mb
ENV MAX_SNAPSHOTS_PER_PROJECT=2
ENV YUNWU_BASE_URL=https://yunwu.ai/v1
ENV YUNWU_PREFER=true
ENV GOOGLE_CLOUD_PROJECT=project-17aef0a2-2bd5-4d28-98e
ENV GOOGLE_CLOUD_LOCATION=global
ENV LEGAL_PROVIDER_NAME=vectiscode
ENV LEGAL_PROVIDER_ADDRESS=vectiscode
ENV STRIPE_STARTER_PRICE_ID=price_1TYwCEKST7p18B964rulr68V
ENV STRIPE_STARTER_ANNUAL_PRICE_ID=price_1TYwCFKST7p18B96STgFxcy5
ENV STRIPE_PRO_PRICE_ID=price_1TYwCHKST7p18B96CZcTbLmO
ENV STRIPE_PRO_ANNUAL_PRICE_ID=price_1TYwCIKST7p18B96WpjzwBBp
ENV STRIPE_STUDIO_PRICE_ID=price_1TYwCJKST7p18B96YrPd1dgN
ENV STRIPE_STUDIO_ANNUAL_PRICE_ID=price_1TYwCKKST7p18B96SVO94yEz
ENV STRIPE_TOP_UP_SMALL_PRICE_ID=price_1TYwCMKST7p18B96wNcRz4Oh
ENV STRIPE_TOP_UP_LARGE_PRICE_ID=price_1TYwCNKST7p18B96yoZRAUHI
ENV STRIPE_PRO_CURRENCY=usd
ENV FIREBASE_PROJECT_ID=vectiscode-e2336
ENV FIREBASE_AUTH_DOMAIN=auth.vectiscode.com
ENV FIREBASE_APP_ID=1:491312197192:web:5f9677a881da3ba6e8327d
ENV FIREBASE_STORAGE_BUCKET=vectiscode-e2336.firebasestorage.app
ENV FIREBASE_MESSAGING_SENDER_ID=491312197192

EXPOSE 7860

CMD ["node", "apps/api/dist/server.js"]
