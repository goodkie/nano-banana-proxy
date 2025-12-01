// index.js (CommonJS, Node 18+ 내장 fetch 사용)

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Nano Banana Pro API 설정
const FAL_API_URL = "https://fal.run/fal-ai/nano-banana-pro";
const FAL_API_KEY = process.env.FAL_KEY || process.env.FAL_API_KEY;

// CORS & JSON 설정
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "10mb" }));

// 간단 헬스 체크
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "nano-banana-proxy",
    message: "FotoD8 Nano Banana proxy is running.",
  });
});

// 해상도 값 정규화: 어떤 값이 들어와도 1K / 2K / 4K 중 하나로 매핑
function normalizeResolution(value) {
  if (!value) return "1K";
  const v = String(value).trim().toUpperCase();

  if (v === "1K" || v === "2K" || v === "4K") {
    return v;
  }

  if (/^1/.test(v)) return "1K";
  if (/^2/.test(v)) return "2K";
  if (/^4/.test(v)) return "4K";

  return "1K";
}

// fallback용 기본 프롬프트
const DEFAULT_PROMPT =
  "Retouch the image in ultra-high resolution without changing any person’s face, pose, or clothing. " +
  "Brighten skin tones and overall colors slightly for a clean, luminous look. " +
  "Apply a professional studio-style background suitable for a portrait. " +
  "Keep all subjects exactly as they appear in the original photo.";

// 메인 엔드포인트
app.post("/retouch", async (req, res) => {
  const startedAt = new Date().toISOString();
  console.log(`[${startedAt}] /retouch called`);

  try {
    const {
      imageBase64,
      backgroundId,
      resolutionHint,
      promptOverride,
      prompt,
    } = req.body || {};

    if (!FAL_API_KEY) {
      console.error("FAL_API_KEY (또는 FAL_KEY)가 설정되어 있지 않습니다.");
      return res.status(500).json({
        error: "Server is not configured with FAL_API_KEY.",
      });
    }

    if (!imageBase64) {
      console.warn("imageBase64 없음");
      return res.status(400).json({ error: "imageBase64 is required." });
    }

    // 해상도 정규화
    const resolution = normalizeResolution(resolutionHint);
    console.log("Normalized resolution:", resolution, " (from:", resolutionHint, ")");

    // ✨ 프롬프트 결정 로직:
    //  1) 프론트에서 보낸 promptOverride (구글 시트 프롬프트)
    //  2) 프론트에서 보낸 prompt
    //  3) DEFAULT_PROMPT
    let finalPrompt = DEFAULT_PROMPT;

    if (typeof promptOverride === "string" && promptOverride.trim().length > 0) {
      finalPrompt = promptOverride.trim();
    } else if (typeof prompt === "string" && prompt.trim().length > 0) {
      finalPrompt = prompt.trim();
    }

    console.log("Using prompt:", finalPrompt);
    console.log("backgroundId (for log only):", backgroundId);

    // 🔴 여기가 핵심 수정 부분입니다.
    // fal-ai/nano-banana-pro 는 body 최상위에 prompt / image_url / resolution 을 기대합니다.
    const payload = {
      prompt: finalPrompt,
      image_url: imageBase64,   // data URL 그대로 사용
      resolution,               // 1K / 2K / 4K
    };

    console.log("Sending request to fal.ai/nano-banana-pro …", payload);

    // Node 18+ 글로벌 fetch 사용 (node-fetch 불필요)
    const falRes = await fetch(FAL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${FAL_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await falRes.text();
    console.log("Fal response status:", falRes.status);
    console.log("Fal raw response:", rawText);

    if (!falRes.ok) {
      return res.status(500).json({
        error: "Nano Banana Pro processing failed",
        upstreamStatus: falRes.status,
        details: rawText,
      });
    }

    let falJson = {};
    try {
      falJson = rawText ? JSON.parse(rawText) : {};
    } catch (e) {
      console.error("Fal JSON parse error:", e);
      return res.status(500).json({
        error: "Invalid JSON from Nano Banana Pro",
        details: String(e),
        raw: rawText,
      });
    }

    // 응답에서 이미지 URL 찾기
    let imageUrl =
      falJson.image_url ||
      falJson.imageUrl ||
      (Array.isArray(falJson.images) && falJson.images[0]?.url) ||
      falJson.output?.[0]?.url;

    if (!imageUrl) {
      console.error("No image URL in fal response:", falJson);
      return res.status(500).json({
        error: "Nano Banana Pro did not return an image URL.",
        details: falJson,
      });
    }

    const finishedAt = new Date().toISOString();
    console.log(`[${finishedAt}] /retouch success. imageUrl=`, imageUrl);

    return res.json({
      ok: true,
      imageUrl,
      usedPrompt: finalPrompt,
      resolution,
      backgroundId,
      startedAt,
      finishedAt,
    });
  } catch (err) {
    console.error("Unexpected error in /retouch:", err);
    return res.status(500).json({
      error: "Unexpected server error",
      details: String(err),
    });
  }
});

app.listen(PORT, () => {
  console.log(`nano-banana-proxy listening on port ${PORT}`);
});
