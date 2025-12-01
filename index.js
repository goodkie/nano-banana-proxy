// index.js (CommonJS, Node 18+ 이상: 글로벌 fetch 사용)

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * ✅ Nano Banana "Image to Image" 편집용 엔드포인트
 *  - fal-ai/nano-banana/edit
 *  - 입력 스키마: { prompt, image_urls: [...], num_images, aspect_ratio, output_format, ... }
 *    (Fal 공식 문서 기준)
 */
const FAL_API_URL = "https://fal.run/fal-ai/nano-banana/edit";
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
    message: "FotoD8 Nano Banana EDIT proxy is running.",
  });
});

// (참고용) 해상도 정규화 – 현재 /edit 스키마에는 resolution 필드가 없으므로 Fal API에는 보내지 않음
function normalizeResolution(value) {
  if (!value) return "1K";
  const v = String(value).trim().toUpperCase();

  if (v === "1K" || v === "2K" || v === "4K") return v;
  if (/^1/.test(v)) return "1K";
  if (/^2/.test(v)) return "2K";
  if (/^4/.test(v)) return "4K";
  return "1K";
}

// fallback용 기본 프롬프트
const DEFAULT_PROMPT =
  "Retouch the image in ultra-high resolution without changing any person’s face, pose, or clothing. " +
  "Brighten skin tones and overall colors slightly for a clean, luminous look. " +
  "Replace the background and floor with a clean, seamless professional studio backdrop. " +
  "Keep all subjects exactly as they appear in the original photo.";

// 메인 엔드포인트
app.post("/retouch", async (req, res) => {
  const startedAt = new Date().toISOString();
  console.log(`[${startedAt}] /retouch called`);

  try {
    const {
      imageBase64,   // data:image/jpeg;base64,.... 형태
      backgroundId,  // 어떤 프롬프트를 썼는지 추적용
      resolutionHint,
      promptOverride,
      prompt,
    } = req.body || {};

    // 1) 키 확인
    if (!FAL_API_KEY) {
      console.error("FAL_API_KEY (또는 FAL_KEY)가 설정되어 있지 않습니다.");
      return res.status(500).json({
        error: "Server is not configured with FAL_API_KEY.",
      });
    }

    // 2) 이미지 존재 여부
    if (!imageBase64) {
      console.warn("imageBase64 없음");
      return res.status(400).json({ error: "imageBase64 is required." });
    }

    // 3) 해상도 힌트는 내부 로그만 (Fal /edit 스키마에는 없음)
    const resolution = normalizeResolution(resolutionHint);
    console.log(
      "Resolution hint (normalized for log only):",
      resolution,
      "(from:",
      resolutionHint,
      ")"
    );

    // 4) 최종 프롬프트 결정
    //    1) promptOverride (구글 시트에서 읽어온 백그라운드 프롬프트)
    //    2) prompt (프런트에서 직접 보낸 프롬프트)
    //    3) DEFAULT_PROMPT
    let finalPrompt = DEFAULT_PROMPT;

    if (typeof promptOverride === "string" && promptOverride.trim().length > 0) {
      finalPrompt = promptOverride.trim();
    } else if (typeof prompt === "string" && prompt.trim().length > 0) {
      finalPrompt = prompt.trim();
    }

    console.log("Using prompt:", finalPrompt);
    console.log("backgroundId (for log only):", backgroundId);

    /**
     * 5) Fal Nano Banana EDIT API 요청
     *
     *  🔹 Fal 공식 스키마 (https://fal.run/fal-ai/nano-banana/edit):
     *
     *    {
     *      "prompt": "…",
     *      "num_images": 1,
     *      "aspect_ratio": "auto",
     *      "output_format": "png",
     *      "image_urls": ["<URL 또는 data:image/...>"]
     *    }
     *
     *  🔹 여기서는 Wix에서 올라온 data URL (imageBase64)을 그대로 image_urls 에 넣습니다.
     *  🔹 Fal 문서에 따르면 이 필드는 Base64 data URI도 허용합니다.
     */

    const payload = {
      prompt: finalPrompt,
      num_images: 1,
      aspect_ratio: "auto",
      output_format: "png",
      sync_mode: true, // 결과를 즉시 반환받기 위함
      image_urls: [imageBase64], // ⭐ 업로드된 원본 사진을 그대로 전달
    };

    console.log("Sending request to fal-ai/nano-banana/edit …");

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
      // Fal이 4xx/5xx를 반환한 경우
      return res.status(500).json({
        error: "Nano Banana Edit processing failed",
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
        error: "Invalid JSON from Nano Banana Edit",
        details: String(e),
        raw: rawText,
      });
    }

    // 6) 응답에서 최종 이미지 URL 찾기
    //    공식 예시: { images: [{ url, ... }], description: "" }
    let imageUrl =
      (Array.isArray(falJson.images) && falJson.images[0]?.url) ||
      falJson.image_url ||
      falJson.imageUrl ||
      falJson.output?.[0]?.url;

    if (!imageUrl) {
      console.error("No image URL in fal response:", falJson);
      return res.status(500).json({
        error: "Nano Banana Edit did not return an image URL.",
        details: falJson,
      });
    }

    const finishedAt = new Date().toISOString();
    console.log(`[${finishedAt}] /retouch success. imageUrl=`, imageUrl);

    return res.json({
      ok: true,
      imageUrl,
      usedPrompt: finalPrompt,
      resolutionHint: resolution, // 참고용 echo
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
  console.log(`nano-banana EDIT proxy listening on port ${PORT}`);
});
