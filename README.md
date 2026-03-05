# HomeBranch

The backend API for [HomeBranch](https://homebranch.app) — a self-hosted e-book library. Manages books, bookshelves, favorites, reading position sync, and user accounts.

**Requires companion services:**
- [Authentication service](https://github.com/Oghamark/Authentication) — user accounts and JWT sessions
- PostgreSQL database

---

## Features

- Book management with file upload (EPUB)
- Automatic metadata enrichment from Open Library (genres, publisher, language, ratings, summary, ISBN, page count)
- Optional Google Books enrichment for series info and any fields Open Library didn't populate
- Bookshelves (collections) with many-to-many book relationships
- Favorites and Currently Reading lists
- Cross-device reading position sync
- User management with roles and permissions
- Pagination and search across the library
- OPDS catalog (v1.2 Atom and v2.0 JSON) for e-reader integration — authenticate with email and password via the companion Auth service

---

## OPDS

Homebranch exposes an OPDS catalog for e-readers (KOReader, Thorium, etc.).

| Feed | URL |
|---|---|
| OPDS 1.2 catalog root | `/opds/v1/catalog` |
| OPDS 2.0 catalog root | `/opds/v2/catalog` |
| Authentication document | `/opds/v1/auth` *(public)* |

Authentication uses HTTP Basic Auth (email + password). Credentials are forwarded to the companion Auth service — requires `AUTH_SERVICE_URL` to be configured. Without it, the catalog is accessible but login attempts return `401`.

> **Windows / Docker note:** If Thorium is installed from the Microsoft Store, it runs in an AppContainer sandbox that blocks access to `localhost`. Use your machine's LAN IP address (e.g. `http://192.168.1.x:3000/opds/v1/catalog`) instead.

---

## Deployment

The app is a NestJS API server that connects to PostgreSQL and reads configuration from environment variables.

### Docker (recommended)

Pre-built images are published to the GitHub Container Registry on every push to `main` and on version tags.

```bash
docker run -d \
  --name homebranch \
  -p 3000:3000 \
  -e DATABASE_HOST=your-db-host \
  -e DATABASE_PORT=5432 \
  -e DATABASE_USERNAME=homebranch \
  -e DATABASE_PASSWORD=changeme \
  -e CORS_ORIGIN=http://localhost \
  -e JWT_ACCESS_SECRET=your-secret \
  -e UPLOADS_DIRECTORY=/data/uploads \
  -v homebranch-uploads:/data/uploads \
  ghcr.io/oghamark/homebranch:latest
```

Or with Docker Compose:

```yaml
services:
  homebranch:
    image: ghcr.io/Oghamark/homebranch:latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_HOST: db
      DATABASE_PORT: 5432
      DATABASE_USERNAME: homebranch
      DATABASE_PASSWORD: changeme
      CORS_ORIGIN: http://localhost
      JWT_ACCESS_SECRET: your-secret
      UPLOADS_DIRECTORY: /data/uploads
    volumes:
      - uploads:/data/uploads
    restart: unless-stopped

  db:
    image: postgres:16
    environment:
      POSTGRES_USER: homebranch
      POSTGRES_PASSWORD: changeme
      POSTGRES_DB: homebranch
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  uploads:
  pgdata:
```

### Debian / Ubuntu package

Download the `.deb` from the [latest release](../../releases/latest) and install it:

```bash
sudo dpkg -i homebranch_*.deb
```

After the first install, edit the configuration:

```bash
sudo nano /etc/default/homebranch
# Set DATABASE_*, JWT_ACCESS_SECRET, CORS_ORIGIN, etc.
sudo systemctl restart homebranch
```

The config file is preserved across package upgrades so your edits won't be overwritten.

The service runs as a `homebranch` system user, installs to `/opt/homebranch`, and stores uploads in `/var/lib/homebranch/uploads` by default.

### Build from source

Requirements: Node.js 20+, PostgreSQL

```bash
git clone https://github.com/Oghamark/Homebranch
cd Homebranch
npm install
npm run build
```

Set the required environment variables (see Configuration below), then start the server:

```bash
node dist/main
```

---

## Configuration

### Environment variables

| Variable | Description |
|---|---|
| `DATABASE_HOST` | PostgreSQL host (e.g. `localhost`) |
| `DATABASE_PORT` | PostgreSQL port (e.g. `5432`) |
| `DATABASE_USERNAME` | PostgreSQL username |
| `DATABASE_PASSWORD` | PostgreSQL password |
| `CORS_ORIGIN` | Allowed CORS origin (e.g. `http://localhost`) |
| `JWT_ACCESS_SECRET` | JWT signing secret — must match the [authentication service](https://github.com/Hydraux/Authentication) |
| `UPLOADS_DIRECTORY` | Path where uploaded book files are stored |
| `GOOGLE_BOOKS_API_KEY` | *(Optional)* Google Books API key — enables Google Books metadata enrichment as a fallback. Without this, only Open Library is used. Can also be set at runtime (see below). |
| `AUTH_SERVICE_URL` | *(Optional)* Base URL of the [Authentication service](https://github.com/Oghamark/Authentication) (e.g. `http://auth:3001`). Required to enable OPDS Basic Auth — OPDS clients (e.g. KOReader) send an email and password which Homebranch forwards to this service to obtain a JWT. Without this variable the OPDS catalog is still served but Basic Auth attempts will return `401`. |

### Google Books API key (runtime)

The Google Books API key can be set or updated at runtime without restarting the server. A running API key overrides the environment variable.

```http
PUT /settings/google_books_api_key
Authorization: (admin JWT cookie)
Content-Type: application/json

{ "value": "your-api-key-here" }
```

> Requires `ADMIN` role. Without an API key, Google Books enrichment is skipped and only Open Library is used.

### Database migrations

Migrations run automatically on startup. To run them manually:

```bash
npm run migration:run
```

---

## Development

```bash
npm install
npm run start:dev
```

| Command | Description |
|---|---|
| `npm run start:dev` | Start with watch mode |
| `npm run start:debug` | Start with debugging |
| `npm run build` | Compile TypeScript |
| `npm test` | Run unit tests |
| `npm run test:cov` | Unit tests with coverage |
| `npm run test:e2e` | End-to-end tests |
| `npm run lint` | ESLint with auto-fix |
| `npm run format` | Prettier formatting |
| `npm run migration:generate -- src/migrations/Name` | Generate migration from entity changes |
| `npm run migration:run` | Execute pending migrations |
| `npm run migration:revert` | Revert last migration |
