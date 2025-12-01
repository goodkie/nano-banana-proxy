// index.js (CommonJS, Node 18+ 이상: 글로벌 fetch 사용)

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * ✅ Nano Banana Pro Image-to-Image(EDIT) 엔드포인트
 *  - Model ID: fal-ai/nano-banana-pro/edit
 *  - HTTP 엔드포인트: https://fal.run/fal-ai/nano-banana-pro/edit
 *  - 스키마(입력):
 *    {
 *      "prompt": "…",                      // required
 *      "num_images": 1,
 *      "aspect_ratio": "auto",
 *      "output_format": "png",
 *      "image_urls": ["data:image/..."],   // required (배경/편집용 원본 이미지들)
 *      "resolution": "1K"                  // "1K" | "2K" | "4K"
 *    }
 */
const FAL_API_URL = "https://fal.run/fal-ai/nano-banana-pro/edit";
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

// 헬스 체크
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "nano-banana-proxy",
    message: "FotoD8 Nano Banana EDIT proxy is running.",
  });
});

// 해상도 값 정규화: 어떤 값이 들어와도 1K / 2K / 4K 중 하나로 매핑
function normalizeResolution(value) {
  if (!value) return "1K";
  const v = String(value).trim().toUpperCase();

  if (v === "1K" || v === "2K" || v === "4K") return v;

  if (/^1/.test(v)) return "1K";
  if (/^2/.test(v)) return "2K";
  if (/^4/.test(v)) return "4K";

  return "1K";
}

// fallback용 기본 프롬프트 (프롬프트 미선택시 사용)
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
      imageBase64,   // data:image/jpeg;base64,...  형식
      backgroundId,  // 어떤 프롬프트(백그라운드) 선택했는지 추적용
      resolutionHint,
      promptOverride,
      prompt,
    } = req.body || {};

    // 1) API 키 확인
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

    // 3) 해상도 정규화 (Fal에 그대로 보냄)
    const resolution = normalizeResolution(resolutionHint);
    console.log(
      "Normalized resolution:",
      resolution,
      "(from:",
      resolutionHint,
      ")"
    );

    // 4) 최종 프롬프트 결정 순서:
    //    1) promptOverride (구글 시트에서 가져온 백그라운드 프롬프트)
    //    2) prompt (프론트에서 직접 보낸 프롬프트)
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
     * 5) Fal Nano Banana Pro EDIT API 요청
     *
     *  - 공식 스키마: https://fal.ai/models/fal-ai/nano-banana-pro/edit/api
     *  - 필수 필드: prompt (string), image_urls (string 배열)
     *  - resolution: "1K" | "2K" | "4K"
     *
     *  ⛔ sync_mode 는 넣지 않습니다.
     *     (true 로 두면 Request History 에 안 남아서 디버깅이 힘듦)
     */

    const payload = {
      prompt: finalPrompt,
      num_images: 1,
      aspect_ratio: "auto",
      output_format: "png",
      image_urls: [imageBase64], // ✅ 업로드된 이미지를 반드시 사용
      resolution,                // ✅ 1K / 2K / 4K
    };

    console.log("Sending request to fal-ai/nano-banana-pro/edit …");
    console.log("Payload (trimmed prompt):", {
      ...payload,
      prompt: payload.prompt.slice(0, 100) + (payload.prompt.length > 100 ? "..." : ""),
      image_urls_count: payload.image_urls.length,
    });

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
      // Fal이 4xx/5xx 반환 시
      return res.status(500).json({
        error: "Nano Banana Pro Edit processing failed",
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
        error: "Invalid JSON from Nano Banana Pro Edit",
        details: String(e),
        raw: rawText,
      });
    }

    // 6) 응답에서 최종 이미지 URL 추출
    //    공식 스키마: { images: [{ url, ... }], description: "" }
    let imageUrl =
      (Array.isArray(falJson.images) && falJson.images[0]?.url) ||
      falJson.image_url ||
      falJson.imageUrl ||
      falJson.output?.[0]?.url;

    if (!imageUrl) {
      console.error("No image URL in fal response:", falJson);
      return res.status(500).json({
        error: "Nano Banana Pro Edit did not return an image URL.",
        details: falJson,
      });
    }

    const finishedAt = new Date().toISOString();
    console.log(`[${finishedAt}] /retouch success. imageUrl =`, imageUrl);

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
  console.log(`nano-banana-pro EDIT proxy listening on port ${PORT}`);
});
