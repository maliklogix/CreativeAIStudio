# Static Ads Generator

AI-powered static ad creative platform with brand management, batch campaign generation, and creative intelligence.

## Stack
- **Backend**: Node.js + Express (single monolith)
- **Database**: PostgreSQL
- **Image Generation**: FAL.ai (flux/schnell)
- **AI / LLM**: Google Gemini 1.5 Flash
- **Frontend**: Vanilla JS + Tailwind CSS (CDN)

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set environment variables
```bash
cp .env.example .env
# Edit .env with your keys
```

Required keys:
| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `FAL_KEY` | [fal.ai](https://fal.ai/dashboard/keys) API key |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/app/apikey) key |

### 3. Ensure PostgreSQL is running and database exists
```bash
createdb static_ads_generator
```

### 4. Start the server
```bash
npm start          # Production
npm run dev        # Development (nodemon)
```

App runs on **http://localhost:8080**

---

## Features

| Feature | Description |
|---|---|
| **Generate Ads** | Single ad generation with FAL.ai, brand kit injection, reference/product images |
| **Re-prompt** | Generate variations from existing outputs |
| **History Board** | Visual card grid with hover actions, status chips |
| **Brand Setup** | Brand kit (name, colors, fonts) with autosave + logo uploads |
| **Brand Intelligence** | AI-generated or manual audience persona/pain/angle profiles |
| **Prompt Compose** | Gemini-powered prompt composition from brand context + profile |
| **Reverse Engineer** | Extract style prompt + variants from a winning ad image |
| **Campaign Builder** | 6-step planner: reference → product → profiles → brief → plan → batch generate |
| **Brand Assets** | Multi-file upload with category tagging |
| **Template Library** | Save generated winners as reusable templates |

## API Reference

| Route | Method | Description |
|---|---|---|
| `/api/clients` | GET/POST | List and create clients |
| `/api/clients/:id/set-default` | POST | Set active client |
| `/api/brand-kit` | GET/PUT | Get/upsert brand kit |
| `/api/brand-kit/logo` | POST | Upload dark/light logos |
| `/api/generate` | POST | Generate ad images |
| `/api/generate/edit` | POST | Re-prompt variation |
| `/api/generate/history` | GET | Paginated generation history |
| `/api/intelligence` | GET/POST | List/add profiles |
| `/api/intelligence/generate` | POST | AI generate profiles |
| `/api/prompt/compose` | POST | AI prompt composition |
| `/api/prompt/reverse` | POST | Reverse-engineer ad |
| `/api/prompt/concepts` | POST | Generate concept directions |
| `/api/campaign/plan` | POST | Build generation matrix |
| `/api/campaign/generate` | POST | Execute batch campaign |
| `/api/assets` | GET/POST | List/upload assets |
| `/api/templates` | GET/POST | List/upload templates |
| `/api/templates/save-from-generation` | POST | Save generated image as template |
| `/api/health` | GET | Health check |
# CreativeAIStudio
