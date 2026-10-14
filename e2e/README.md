# End-to-End Test Suite (`@bs/e2e`)

Real browser end-to-end tests for `bsec` using Playwright against an active, un-mocked stack.

## Architecture & Storage
All media tests in this suite run against real local storage. When running the staging stack via `docker-compose.staging.yml`, `MEDIA_LOCAL_DIR` and `STORAGE_LOCAL_DIR` are mounted from the shared `media_data` volume, ensuring real uploads, thumbnail generation, downloads, and storefront image delivery without external cloud dependencies.

## Fixtures
Test fixtures are located in `e2e/fixtures/`:
- `sample.png`: Valid 1x1 PNG image
- `sample.jpg`: Valid 1x1 JPEG image
- `sample.mp4`: Valid MP4 container with ISO `ftyp` atom
- `sample.pdf`: Valid PDF document (`%PDF-1.4`)
- `sample.docx`: Valid DOCX document (ZIP package)
- `rejected.svg`: SVG file rejected for security (ADR-028)
- Dynamic oversized files: 6 MB JPEG and 11 MB MP4 generated on disk for quota and size refusal verification.

## Running Locally

### 1. Start the staging stack or local dev server
```bash
# Option A: Start CI staging docker compose
IMAGE_TAG=latest \
POSTGRES_PASSWORD=postgres \
APP_OWNER_PASSWORD=postgres \
APP_RW_PASSWORD=postgres \
APP_PLATFORM_PASSWORD=postgres \
APP_SAAS_PASSWORD=postgres \
BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
TENANT_SECRETS_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
docker compose -f docker-compose.staging.yml up -d

# Option B: Run local dev servers
pnpm --filter @bs/web dev
pnpm --filter @bs/admin dev
```

### 2. Run Playwright
```bash
# Run all specs
pnpm --filter @bs/e2e e2e

# Run only media library spec
pnpm --filter @bs/e2e exec playwright test media-library.spec.ts

# Use installed Google Chrome instead of downloading Playwright browser
E2E_CHROME=1 pnpm --filter @bs/e2e exec playwright test media-library.spec.ts
```

### 3. Environment Variables
- `ADMIN_URL`: Admin SPA origin (default `http://127.0.0.1:8080` or `http://127.0.0.1:5173`)
- `API_URL`: Web / API origin (default `http://127.0.0.1:3000`)
- `E2E_EMAIL`: Seeded store owner email (default `owner@ci.example`)
- `E2E_PASSWORD`: Seeded store owner password
- `E2E_CHROME`: Set to `1` to use system Chrome.
