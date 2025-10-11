import express from "express";
import path from "path";

const app = express();
const port = process.env.PORT || 8080;
const distDir = path.resolve(__dirname, "..", "dist");

app.use(express.static(distDir));

app.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    latencyTargetMs: Number(process.env.LATENCY_TARGET_MS ?? "25"),
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`SingWithMe web prototype listening on port ${port}`);
});
