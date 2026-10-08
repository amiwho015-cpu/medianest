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

## AI Upscale (Adobe Stock)
- Section `#upscale`, API: `POST /api/ai/upscale` ({image: dataURL, engine: 1|2, target: min|large|xl})
- AI upscale (GenX hub) -> Lanczos diye minimum 4MP / 12MP / 24MP -> JPEG 300 DPI, 45MB-er niche, 100MP-er beshi hole chhoto
- Notun dependency: `sharp` -> `npm install` abar chalao

## Image to Vector (SVG)
- Section `#vector`, API: `POST /api/ai/vector` ({image: dataURL, style: illustration|logo|detailed|bw, removeBg: bool})
- imagetracerjs diye color trace -> SVG (viewBox shoho, scalable). Adobe Stock-er jonno SVG ta Illustrator/Inkscape-e EPS/AI save korte hobe
- Notun dependency: `imagetracerjs` -> `npm install` abar chalao

## Adobe Stock Vector Pack (one click)
- Section `#pack`, API: `POST /api/ai/pack` ({prompt, model, ratio, style, vectorFriendly, removeBg, extraKeywords})
- Flow: AI image (GenX) -> trace -> SVG + EPS (`lib/vectorpack.js`) -> JPG preview (sharp) -> rule-based SEO (title max 200, keywords max 49)
- Client e title/keywords edit kora jay; ZIP-e eps, svg, jpg, metadata.csv, keywords.txt, upload-checklist.txt (ZIP: JSZip cdnjs theke)
- Adobe-e auto upload nai (login/password ei site-e dewa hoy na), upload portal-e manually
