// index.js
import express from "express";
import cors from "cors";
import { fal } from "@fal-ai/client";

const app = express();
const PORT = process.env.PORT || 4000;

// ---------------------------------------------------------------------------
// 1) fal.ai API Key 설정 (Render 환경변수에서 FAL_KEY 읽음)
// ---------------------------------------------------------------------------
fal.config({
  credentials: process.env.FAL_KEY,
});

// ---------------------------------------------------------------------------
// 2) 서버 기본 설정
// ---------------------------------------------------------------------------
app.use(
  cors({
    origin: "*", // 필요하면 특정 도메인만 허용 가능
  })
);
app.use(express.json({ limit: "20mb" })); // base64 이미지 전송용

// ---------------------------------------------------------------------------
// 3) backgroundId -> 프롬프트 매핑
// ---------------------------------------------------------------------------
const PROMPTS = {
  studioSoft: `
Create a high-resolution studio portrait while keeping the subject’s original face,
pose, body proportions, and clothing completely unchanged.
Replace only the background with a clean, soft gradient studio backdrop.
Use professional studio lighting, subtle vignette, and gentle contrast so the subject
remains the clear focus. No warping, no reshaping, no face retouching.
`,

  taekwondo: `
Keep the subject’s original face, pose, proportions, and uniform exactly the same.
Transform only the background into a dynamic Taekwondo Photo Day scene:
cinematic lighting, energetic motion streaks, glowing dust, and subtle energy sparks.
Add a sense of speed and power, as if captured during an epic martial-arts showcase.
Do NOT change the subject’s face, pose, or uniform details—only the background and atmosphere.
`,

  holiday: `
Keep the subject’s face, pose, proportions, and outfit completely unchanged.
Replace only the background with a warm, cozy holiday lights scene:
soft bokeh lights, gentle glow, and a festive but elegant mood.
No cartoon effects, no distortion—just a professional holiday portrait style.
`,

  cleanMono: `
Keep the subject’s original face, pose, proportions, and clothing exactly as they are.
Replace only the background with a minimal, clean single-color wall look:
modern studio style, soft shadows, and simple gradient or flat tone.
The overall feeling should be premium, editorial, and distraction-free.
`,
};

// 기본 프롬프트 (혹시 없는 backgroundId가 들어올 때)
const DEFAULT_PROMPT = `
Keep the subject’s face, pose, proportions, and clothing exactly the same.
Change only the background to a clean, professional portrait style.
Do not alter the person’s identity or body shape in any way.
`;

// ---------------------------------------------------------------------------
// 4) 헬스체크 엔드포인트 (테스트용)
// ---------------------------------------------------------------------------
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Nano Banana Pro proxy is running." });
});

// ---------------------------------------------------------------------------
// 5) Wix에서 호출하는 이미지 변환 엔드포인트
// ---------------------------------------------------------------------------
app.post("/retouch", async (req, res) => {
  try {
    const { imageBase64, backgroundId } = req.body || {};

    if (!imageBase64) {
      return res.status(400).json({ error: "imageBase64 is required" });
    }

    if (!process.env.FAL_KEY) {
      return res.status(500).json({ error: "FAL_KEY is missing in server environment" });
    }

    const prompt = PROMPTS[backgroundId] || DEFAULT_PROMPT;

    // fal.ai nano-banana-pro/edit 호출
    const result = await fal.subscribe("fal-ai/nano-banana-pro/edit", {
      input: {
        prompt,
        image_urls: [imageBase64], // Wix에서 보내준 base64
        aspect_ratio: "auto",
        resolution: "1k",
        num_images: 1,
      },
      logs: false,
    });

    // 결과 URL 추출
    const images = result?.images || result?.data?.images;
    const imageUrl = images && images[0] && images[0].url;

    if (!imageUrl) {
      console.error("Unexpected fal.ai response:", result);
      return res.status(500).json({ error: "No imageUrl returned from fal.ai" });
    }

    // Wix로 전달
    return res.json({ imageUrl });
  } catch (err) {
    console.error("Nano Banana Pro error:", err);
    return res.status(500).json({
      error: "Nano Banana Pro processing failed",
      details: String(err),
    });
  }
});

// ---------------------------------------------------------------------------
// 6) 서버 실행
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Nano Banana Pro proxy running on port ${PORT}`);
});
