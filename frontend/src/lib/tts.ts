/**
 * Speech Synthesis Integration.
 * Primary: Sarvam AI Indian Text-to-Speech (native en-IN, speaker 'priya', model 'bulbul:v3').
 * Fallback: ElevenLabs (if configured) or Client-side Web Speech API.
 */

export interface SynthesizeOptions {
  voiceId?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
}

export async function synthesizeSpeech(
  text: string,
  options?: SynthesizeOptions
): Promise<{ audioBase64: string; mimeType: string }> {
  // Clean markdown and non-verbal tokens for crisp, natural human speech
  const cleanedText = text
    .replace(/[*#_`~]/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/₹/g, " rupees ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleanedText) {
    throw new Error("Cannot synthesize empty text");
  }

  const sarvamKey = (process.env.SARVAM_API_KEY || "").trim();
  const elevenlabsKey = (process.env.ELEVENLABS_API_KEY || "").trim();

  // 1. Primary: Sarvam AI Indian Text-to-Speech
  if (sarvamKey) {
    try {
      const speaker = process.env.SARVAM_SPEAKER || "priya";
      const model = process.env.SARVAM_MODEL || "bulbul:v3";
      const res = await fetch("https://api.sarvam.ai/text-to-speech", {
        method: "POST",
        headers: {
          "api-subscription-key": sarvamKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: [cleanedText],
          target_language_code: "en-IN",
          speaker,
          model,
        }),
        signal: AbortSignal.timeout(7500),
      });

      if (res.ok) {
        const data = await res.json();
        const audioBase64 = data.audios?.[0];
        if (audioBase64) {
          return {
            audioBase64,
            mimeType: "audio/wav",
          };
        }
      } else {
        const errText = await res.text();
        console.warn(`[sarvam-tts] API error (${res.status}): ${errText.slice(0, 150)}`);
      }
    } catch (err: any) {
      console.warn("[sarvam-tts] request failed:", err?.message);
    }
  }

  // 2. Secondary fallback: ElevenLabs (only if key is provided)
  if (elevenlabsKey) {
    const voiceId =
      options?.voiceId ||
      process.env.ELEVENLABS_VOICE_ID ||
      "pFZP5JQG7iQjIQuC4Bku"; // Lily

    const modelId =
      options?.modelId ||
      process.env.ELEVENLABS_MODEL_ID ||
      "eleven_multilingual_v2";

    const stability = options?.stability ?? 0.5;
    const similarityBoost = options?.similarityBoost ?? 0.8;

    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": elevenlabsKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: cleanedText,
          model_id: modelId,
          voice_settings: {
            stability,
            similarity_boost: similarityBoost,
            use_speaker_boost: true,
          },
        }),
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const audioBase64 = Buffer.from(arrayBuffer).toString("base64");
        return {
          audioBase64,
          mimeType: "audio/mpeg",
        };
      }
    } catch (err: any) {
      console.warn("[tts] ElevenLabs fallback error:", err?.message);
    }
  }

  throw new Error("No speech synthesis provider succeeded.");
}

