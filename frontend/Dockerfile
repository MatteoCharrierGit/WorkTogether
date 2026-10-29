# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
# Prima solo i manifest: il layer di `npm ci` resta in cache finché le dipendenze non cambiano.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
# Login tramite Authentik (OIDC): issuer dell'applicazione e client id pubblico.
ARG VITE_OIDC_AUTHORITY=""
ARG VITE_OIDC_CLIENT_ID="worktogether"
ENV VITE_OIDC_AUTHORITY=$VITE_OIDC_AUTHORITY
ENV VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID
RUN npm run build \
 # Pre-compressione per `gzip_static on` in nginx (file testuali > 1 kB, l'originale resta).
 && find dist -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.css' -o -name '*.html' \
      -o -name '*.svg' -o -name '*.json' -o -name '*.webmanifest' -o -name '*.txt' \) \
      -size +1k -exec gzip -k -9 -n {} +

# ---- runtime ----
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
