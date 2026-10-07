# MediaNest
1. `npm install`
2. `.env.example` copy kore `.env` banao (OPENWEATHER_KEY boshao)
3. `npm start` -> http://localhost:3000

Render deploy: Build `npm install`, Start `npm start`, env vars dashboard-e dao.

## AI Image Gen + AI Image Edit (GenX models)
- `#ai-gen`: shudhu prompt theke chhobi, shob 12 model, ratio 1:1 / 16:9 / 9:16 / 4:3 / 3:4
- `#ai-edit`: ekshathe max 5-ta chhobi upload + prompt (Qwen Image bade 11-ta model)
- API: `GET /api/ai/models`, `POST /api/ai/gen` ({model, prompt, ratio}), `POST /api/ai/edit` ({model, prompt, ratio, images:[dataURL]})
- Dependency: `form-data` -> `npm install` abar chalao
