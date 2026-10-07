# MediaNest
1. `npm install`
2. `.env.example` copy kore `.env` banao (OPENWEATHER_KEY boshao)
3. `npm start` -> http://localhost:3000

Render deploy: Build `npm install`, Start `npm start`, env vars dashboard-e dao.

## AI Image Edit (GenX models)
- Section: `#ai-edit` (navbar-e "AI Edit")
- 12-ta GenX model (Flux 2 Max, GPT Image 2, Nano Banana, SeedDream 4 ...), ratio: 1:1, 16:9, 9:16, 4:3, 3:4
- Ekshathe max 5-ta chhobi upload kora jay (browser-e 1600px-e chhoto kore server-e jay)
- API: `GET /api/ai/models`, `POST /api/ai/edit` ({model, prompt, ratio, images:[dataURL]})
- Notun dependency: `form-data` -> `npm install` abar chalao
