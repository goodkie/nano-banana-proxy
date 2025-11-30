// index.js
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

// Fal API Key
const FAL_KEY = process.env.FAL_KEY;

if (!FAL_KEY) {
  console.error("[STARTUP ERROR] FAL_KEY is not set in environment variables.");
} else {
  console.log("[STARTUP] FAL_KEY is set (hidden).");
}

app.use(
  cors({
    origin: "*", // 필요시 Wix 도메인으로 제한 가능
  })
);
app.use(express.json({ limit: "20mb" }));

// 헬스 체크
app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Nano Banana proxy is running",
    hasFalKey: !!FAL_KEY,
  });
});

/**
 * 해상도 힌트를 Fal이 허용하는 값(1K/2K/4K)으로 정규화
 */
function normalizeResolution(hint) {
  const upper = (hint || "").toString().toUpperCase().trim(); // "1K", "2K", "4K" 기대
  if (upper === "1K" || upper === "2K" || upper === "4K") {
    return upper;
  }
  return "1K"; // 기본값
}

// 메인 라우트
app.post("/retouch", async (req, res) => {
  try {
    if (!FAL_KEY) {
      console.error("[ERROR] FAL_KEY missing.");
      return res.status(500).json({
        error: "Server configuration error",
        details: "FAL_KEY missing",
      });
    }

    const { imageBase64, backgroundId, resolutionHint } = req.body || {};

    if (!imageBase64) {
      console.error("[ERROR] imageBase64 is missing in request body.");
      return res.status(400).json({
        error: "imageBase64 is required in request body",
      });
    }

    // backgroundId에 따른 프롬프트
    const promptMap = {
      studioSoft:
        "Retouch the uploaded portrait into a soft, clean studio look with a light gradient backdrop. Do not change the person’s face, pose, expression, or clothing. Only adjust background, lighting, and overall mood.",
      taekwondo:
        "Create a high-energy Taekwondo Photo Day background with dynamic lighting, motion streaks, and subtle sparks. Do not change the subject’s face, pose, or uniform. Only modify the background and lighting.",
      holiday:
        "Transform the background into a warm holiday studio with subtle lights and seasonal mood. Keep the face, pose, and clothing as they are. Only adjust background, colors, and lighting.",
      cleanMono:
        "Use a simple, modern single-color studio wall background. Keep the person’s face, expression, and pose exactly the same, only cleaning up the background and lighting.",
    };

    const prompt = promptMap[backgroundId] || promptMap.studioSoft;

    // 해상도 정규화
    const resolution = normalizeResolution(resolutionHint);
    console.log("[INFO] Normalized resolution:", resolution, "from hint:", resolutionHint);

    console.log("[INFO] Incoming /retouch request", {
      backgroundId,
      resolution,
      imageLength: imageBase64.length,
    });

    // Fal endpoint (Nano Banana Pro edit)
    const falUrl = "https://fal.run/fal-ai/nano-banana-pro/edit";

    // Fal에 보낼 body
    // ⚠ Fal 스펙에 맞게 조정 필요: 여기서는 "input: { image_url, prompt } + resolution" 구조 사용
    const falBody = {
      input: {
        image_url: imageBase64, // Fal에서 base64 data URL 허용 시
        prompt: prompt,
      },
      resolution: resolution, // Fal 에러에서 loc: ["body","resolution"]로 나왔으므로 루트에 둠
    };

    console.log("[INFO] Calling Fal endpoint:", falUrl);
    console.log("[DEBUG] Fal request body (truncated image):", {
      ...falBody,
      input: {
        ...falBody.input,
        image_url: "[base64-data-url]",
      },
    });

    const falRes = await fetch(falUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${FAL_KEY}`,
      },
      body: JSON.stringify(falBody),
    });

    const falText = await falRes.text();

    console.log("[INFO] Fal response status:", falRes.status);
    console.log("[DEBUG] Fal response body:", falText);

    if (!falRes.ok) {
      // Fal에서 4xx/5xx 반환 시 그대로 로그 전달
      return res.status(500).json({
        error: "Nano Banana Pro processing failed",
        details: falText,
      });
    }

    let falJson = {};
    try {
      falJson = falText ? JSON.parse(falText) : {};
    } catch (e) {
      console.error("[ERROR] Failed to parse Fal JSON:", e);
      return res.status(500).json({
        error: "Invalid JSON from Fal",
        details: falText,
      });
    }

    // 결과 이미지 URL 찾기 (Fal 응답 스펙에 따라 조정 가능)
    const imageUrl =
      falJson.image_url ||
      falJson.url ||
      (falJson.output &&
        Array.isArray(falJson.output) &&
        falJson.output[0] &&
        falJson.output[0].url);

    if (!imageUrl) {
      console.error("[ERROR] No image URL in Fal response:", falJson);
      return res.status(500).json({
        error: "No image URL returned from Fal",
        details: falJson,
      });
    }

    console.log("[INFO] Returning imageUrl to client:", imageUrl);

    return res.json({ imageUrl });
  } catch (err) {
    console.error("[UNCAUGHT ERROR] /retouch:", err);
    return res.status(500).json({
      error: "Unexpected server error in /retouch",
      details: String(err),
    });
  }
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`Nano Banana proxy listening on port ${PORT}`);
});
