# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **AI Proxy**: Claude/OpenAI API proxy (ClaudeProxy)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Claude/OpenAI Proxy (ClaudeProxy)

The API server includes a proxy service based on https://github.com/ytf211/ClaudeProxy

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/healthz` | Health check |
| GET | `/v1/models` | List available models |
| POST | `/v1/messages` | Anthropic-native messages API |
| POST | `/v1/chat/completions` | OpenAI-compatible chat completions |

### Authentication

All `/v1/*` endpoints require authentication via:
- `Authorization: Bearer <PROXY_API_KEY>` header
- `x-api-key: <PROXY_API_KEY>` header

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PROXY_API_KEY` | Client access key (secret) |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Anthropic API key (secret) |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI API key (secret) |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | Anthropic base URL (default: https://api.anthropic.com) |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | OpenAI base URL (default: https://api.openai.com/v1) |

### Client Configuration (Claude Code)

```bash
export ANTHROPIC_API_KEY=<your PROXY_API_KEY>
export ANTHROPIC_BASE_URL=https://<your-domain>.replit.app
claude
```
