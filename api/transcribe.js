import "dotenv/config";

import fs from "fs";
import path from "path";
import { promisify } from "util";
import { Configuration, OpenAIApi } from "openai";

const writeFile = promisify(fs.writeFile);
const config = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
const openai = new OpenAIApi(config);

export default async function handler(req, res) {
  console.log("🛰️  /api/transcribe received:", req.method);
  try {
    if (req.method !== "POST") {
      console.log("↩️  Not a POST");
      return res.status(405).end();
    }

    const { audio } = req.body;
    console.log("ℹ️  audio payload length:", typeof audio, audio?.slice?.(0,30));
    if (!audio || typeof audio !== "string") {
      console.log("❌  No audio field");
      return res.status(400).json({ error: "Missing audio data" });
    }

    const match = audio.match(/^data:(audio\/[^;]+);base64,(.+)$/);
    if (!match) {
      console.log("❌  Data-URL parse failed");
      return res.status(400).json({ error: "Invalid audio format" });
    }
    const [, mimeType, base64Data] = match;
    console.log("📝  mimeType:", mimeType);

    const buffer = Buffer.from(base64Data, "base64");
    const ext = mimeType.split("/")[1];
    const tmpPath = path.join("/tmp", `recording.${ext}`);
    console.log("💾  writing to:", tmpPath);
    await writeFile(tmpPath, buffer);

    console.log("🎙️  calling Whisper…");
    const transcription = await openai.createTranscription(
      fs.createReadStream(tmpPath),
      "whisper-1"
    );
    console.log("✅  Whisper response:", transcription.data.text);

    return res.status(200).json({ transcript: transcription.data.text });

  } catch (err) {
    console.error("🔥  Transcribe Error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}
