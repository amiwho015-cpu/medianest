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
- Section `#vector`, API: `POST /api/ai/vector` ({image: dataURL, style: icons|illustration|logo|detailed|bw, removeBg: bool})
- Nijer smooth tracer (`lib/tracer.js`, shudhu `sharp` lage, `imagetracerjs` ar lage na): k-means rong -> stacked layer (gap/halo nai) -> sub-pixel contour -> corner-aware Bezier.

## Adobe Stock Vector Pack (one click, 1-5 ta ekshate)
- Section `#pack`, API: `POST /api/ai/pack` ({prompt, model, ratio, style, vectorFriendly, removeBg, extraKeywords, variant 1-5})
- UI-te "N ta pack ekshate" (default 5): 5-ta request parallel, server-e trace max 2-ta ekshate
- Flow: AI image -> smooth trace -> SVG + EPS (even-odd) -> JPG preview (>=4MP) -> SEO (title max 200, keywords max 49)
- Keyword-e rong chhobir asol palette theke ashe; notun `Icon Set` style (unique icon, grid, no duplicate)
- Quality warning card-e dekhay. Per-pack ZIP + "Download ALL" ZIP
- Adobe-e auto upload nai, portal-e manually. AI-generated hole "generative AI" tick dao

## AI Image Gen (1-5 ta ekshate)
- `#ai-gen`-e "N ta chhobi ekshate" select (default 5), ekta fail korle baki gulo thik thake, "Save all"
