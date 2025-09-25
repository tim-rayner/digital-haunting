# ---- build stage ----
    FROM public.ecr.aws/docker/library/node:20-alpine AS build
    WORKDIR /app
    COPY package.json package-lock.json* ./
    RUN npm ci
    COPY tsconfig.json ./
    COPY src ./src
    COPY public ./public
    RUN npm run build
    
    # ---- runtime stage ----
    FROM public.ecr.aws/docker/library/node:20-alpine
    WORKDIR /app
    ENV NODE_ENV=production
    COPY package.json package-lock.json* ./
    RUN npm ci --omit=dev
    COPY --from=build /app/dist ./dist
    COPY --from=build /app/public ./public
    ENV PORT=8080
    EXPOSE 8080
    CMD ["node", "dist/server.js"]