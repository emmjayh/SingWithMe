import express from "express";
import path from "path";
import multer from "multer";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "url";

const app = express();
const port = process.env.PORT || 8080;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, "..", "dist");
const uploadDir = path.resolve(__dirname, "..", "uploads");

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".wav";
    const safeBase = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9-_]/g, "-")
      .toLowerCase();
    const name = `${randomUUID()}-${safeBase || "track"}${ext}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 60 * 1024 * 1024 }
});

app.use(express.static(distDir));
app.use("/uploads", express.static(uploadDir));

app.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    latencyTargetMs: Number(process.env.LATENCY_TARGET_MS ?? "25"),
  });
});

app.post("/api/tracks", upload.fields([
  { name: "instrument", maxCount: 1 },
  { name: "guide", maxCount: 1 }
]), (req, res) => {
  const files = req.files as { [key: string]: Express.Multer.File[] | undefined } | undefined;
  const instrumentFile = files?.instrument?.[0];
  const guideFile = files?.guide?.[0];

  if (!instrumentFile || !guideFile) {
    return res.status(400).json({ error: "Instrument and guide files are required." });
  }

  return res.json({
    instrumentUrl: `/uploads/${path.basename(instrumentFile.path)}` ,
    guideUrl: `/uploads/${path.basename(guideFile.path)}`
  });
});

app.get("/*", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`SingWithMe web prototype listening on port ${port}`);
});

