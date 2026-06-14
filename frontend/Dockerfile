# AHA · Ayni frontend — multi-stage build to a small standalone Next.js image.
# NEXT_PUBLIC_* values are inlined at build time, so they're passed as build args.

# 1) deps — install node_modules from the lockfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# 2) builder — compile the app (standalone output)
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Public (client-inlined) config — override via docker build args / compose.
ARG NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
ARG NEXT_PUBLIC_IPFS_GATEWAY=https://w3s.link/ipfs/
ARG NEXT_PUBLIC_FOUNDATION_CIRCLE=5ojNff2MEHNgLv55DgsYRvd7SYY2jZ8uaSst65b2Yrm7
ARG NEXT_PUBLIC_AHA_EMAIL_DOMAIN=aha.community
ENV NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL \
    NEXT_PUBLIC_IPFS_GATEWAY=$NEXT_PUBLIC_IPFS_GATEWAY \
    NEXT_PUBLIC_FOUNDATION_CIRCLE=$NEXT_PUBLIC_FOUNDATION_CIRCLE \
    NEXT_PUBLIC_AHA_EMAIL_DOMAIN=$NEXT_PUBLIC_AHA_EMAIL_DOMAIN \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# 3) runner — minimal runtime
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
