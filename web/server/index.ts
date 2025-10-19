import nodemailer from "nodemailer";
import express from "express";
import path from "path";
import multer from "multer";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "url";
import Stripe from "stripe";

const app = express();
const port = process.env.PORT || 8080;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, "..", "dist");
const publicDir = path.resolve(__dirname, "..", "public");
const mediaDir = path.join(publicDir, "media");
const uploadDir = path.resolve(__dirname, "..", "uploads");
const fulfillmentPath = process.env.FULFILLMENT_FILE_PATH
  ? path.resolve(process.env.FULFILLMENT_FILE_PATH)
  : null;
const downloadTickets = new Map<string, { expires: number }>();
const ticketTtlMs = Number(process.env.DOWNLOAD_TOKEN_TTL_MS ?? 5 * 60 * 1000);

const stripeSecret = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecret
  ? new Stripe(stripeSecret, {
    apiVersion: "2024-06-20",
  })
  : null;

const smtpUrl = process.env.SMTP_URL;
const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT ?? 587);
const smtpUser = process.env.SMTP_USER;
const smtpPassword = process.env.SMTP_PASSWORD;
const smtpSecure = (process.env.SMTP_SECURE ?? "").toLowerCase() === "true" || smtpPort === 465;

let mailer: nodemailer.Transporter | null = null;
try {
  if (smtpUrl) {
    mailer = nodemailer.createTransport(smtpUrl);
  } else if (smtpHost) {
    mailer = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: smtpUser && smtpPassword ? { user: smtpUser, pass: smtpPassword } : undefined
    });
  }
  if (mailer) {
    mailer.verify().catch((error) => {
      console.warn("SMTP transporter verification failed", error);
    });
  }
} catch (error) {
  console.warn("Failed to configure SMTP transporter", error);
  mailer = null;
}

fs.mkdirSync(uploadDir, { recursive: true });
if (fulfillmentPath && !fs.existsSync(fulfillmentPath)) {
  // eslint-disable-next-line no-console
  console.warn(`Fulfillment file not found at ${fulfillmentPath}. Download endpoint will error until it is provided.`);
}

app.use(express.json());

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

if (fs.existsSync(mediaDir)) {
  app.use("/media", express.static(mediaDir));
}

app.use(express.static(distDir));
app.use("/uploads", express.static(uploadDir));

function cleanupTickets() {
  const now = Date.now();
  downloadTickets.forEach((meta, token) => {
    if (meta.expires <= now) {
      downloadTickets.delete(token);
    }
  });
}

app.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    latencyTargetMs: Number(process.env.LATENCY_TARGET_MS ?? "25"),
  });
});

app.get("/api/download-ticket", async (req, res) => {
  cleanupTickets();

  const sessionId = req.query.session_id;
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return res.status(400).json({ error: "Missing session_id query parameter." });
  }
  if (!stripe) {
    return res.status(500).json({ error: "Stripe secret key not configured on server." });
  }
  if (!fulfillmentPath || !fs.existsSync(fulfillmentPath)) {
    return res.status(500).json({ error: "Fulfillment asset is not available. Please contact support." });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["customer", "customer_details"],
    });

    if (!session || session.payment_status !== "paid") {
      return res.status(403).json({ error: "Payment is not completed for this session." });
    }

    const token = randomUUID();
    downloadTickets.set(token, { expires: Date.now() + ticketTtlMs });

    return res.json({
      downloadUrl: `/api/download/${token}`,
      expiresInMs: ticketTtlMs,
      session: {
        email: session.customer_details?.email ?? session.customer_email ?? null,
        amountTotal: session.amount_total,
        currency: session.currency,
      },
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to verify checkout session", error);
    return res.status(500).json({ error: "Unable to verify purchase. Please contact support with your receipt." });
  }
});

app.get("/api/download/:token", (req, res) => {
  cleanupTickets();
  const token = req.params.token;
  const ticket = downloadTickets.get(token);

  if (!ticket) {
    return res.status(410).json({ error: "This download link has expired. Please refresh the page to request a new one." });
  }

  if (!fulfillmentPath || !fs.existsSync(fulfillmentPath)) {
    downloadTickets.delete(token);
    return res.status(500).json({ error: "Fulfillment asset is not available. Please contact support." });
  }

  downloadTickets.delete(token);
  res.download(fulfillmentPath, path.basename(fulfillmentPath), (err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error("Failed to send download", err);
      res.status(500).end();
    }
  });
});

app.post("/api/waitlist", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  if (!email) {
    return res.status(400).json({ error: "Email address is required." });
  }
  if (!mailer) {
    return res.status(500).json({ error: "Waitlist email is not configured." });
  }
  const to = process.env.WAITLIST_TO_EMAIL;
  if (!to) {
    return res.status(500).json({ error: "WAITLIST_TO_EMAIL is not configured on the server." });
  }
  const from = process.env.WAITLIST_FROM_EMAIL ?? to;
  const subject = process.env.WAITLIST_SUBJECT ?? "Android waitlist signup";
  const text = `New Android waitlist signup:

Email: ${email}
Received: ${new Date().toISOString()}`;
  try {
    await mailer.sendMail({
      from,
      to,
      replyTo: email,
      subject,
      text
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Failed to send waitlist email", error);
    return res.status(500).json({ error: "Unable to send waitlist email." });
  }
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
  console.log(`TuneTrix web prototype listening on port ${port}`);
});

