# The FocusSpace API.
#
# A Dockerfile rather than the platform's auto-detection, because this repo
# builds three different things from one package.json (extension, website,
# server) and every builder that guesses picks `npm run build` — the *extension*
# — and then serves `dist/` as a static site. This states which one to build.
#
# Node 22 is not optional: the server uses `node:sqlite` (DatabaseSync), which
# does not exist in 20.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` and not `npm install`: the lockfile is the build's input, and dev
# dependencies are needed here because vite does the bundling.
RUN npm ci
COPY . .
RUN npm run build:server

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# `build:server` emits a single self-contained ESM bundle that imports nothing
# but Node builtins, so the runtime image needs no node_modules at all.
COPY --from=build /app/dist-server ./dist-server
# DB_PATH points at the mounted volume in production (see docs/DEPLOY.md); this
# default only matters if someone runs the image with no volume.
RUN mkdir -p /data
EXPOSE 8788
CMD ["node", "dist-server/index.mjs"]
