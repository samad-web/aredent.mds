# syntax=docker/dockerfile:1

# ──────────────────────────────────────────────────────────────────────────
# Stage 1 — build the Vite SPA. VITE_* vars are baked into the bundle here
# (public anon key only; the service-role key is NEVER passed to this stage).
# ──────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run build

# ──────────────────────────────────────────────────────────────────────────
# Stage 2 — runtime. Express serves /api/* and the static dist/ build.
# Only production deps are installed; the server reads src/lib/* at runtime.
# ──────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY src ./src
COPY --from=build /app/dist ./dist

EXPOSE 8787
CMD ["node", "server/index.js"]
