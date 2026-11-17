require("dotenv").config();
const express = require("express");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "MAIL_FROM", "OTP_SECRET"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
if (process.env.OTP_SECRET.length < 32) {
  throw new Error("OTP_SECRET must be at least 32 characters.");
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

// Demo storage: pending codes are kept in memory and disappear on restart.
// Use Redis or a database for a production deployment.
const pending = new Map();
const COOLDOWN_MS = 60_000;
const EXPIRY_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

const sendLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: 5,
  standardHeaders: "draft-7", legacyHeaders: false,
  message: { message: "Слишком много запросов. Попробуйте позже." }
});
const verifyLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: 15,
  standardHeaders: "draft-7", legacyHeaders: false,
  message: { message: "Слишком много попыток. Попробуйте позже." }
});

function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}
function digest(email, code) {
  return crypto.createHmac("sha256", process.env.OTP_SECRET)
    .update(`${email}:${code}`).digest("hex");
}
function safeEqual(a, b) {
  const aa = Buffer.from(a, "hex"), bb = Buffer.from(b, "hex");
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

app.post("/api/send-code", sendLimiter, async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  if (!email) return res.status(400).json({ message: "Введите корректный адрес электронной почты." });

  const previous = pending.get(email);
  if (previous && Date.now() - previous.sentAt < COOLDOWN_MS) {
    return res.status(429).json({ message: "Подождите минуту перед повторной отправкой." });
  }

  const code = String(crypto.randomInt(10000, 100000));
  const entry = {
    hash: digest(email, code),
    expiresAt: Date.now() + EXPIRY_MS,
    sentAt: Date.now(),
    attempts: 0
  };
  // Save only the keyed hash, never the plaintext code.
  pending.set(email, entry);

  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: email,
      subject: "Код подтверждения электронной почты",
      text: `Ваш код подтверждения: ${code}\n\nКод действует 5 минут. Если вы не запрашивали его, проигнорируйте это письмо.`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Подтверждение почты</h2><p>Ваш код:</p><p style="font-size:30px;font-weight:bold;letter-spacing:8px">${code}</p><p>Код действует 5 минут. Никому не сообщайте его.</p><p>Если вы не запрашивали код, проигнорируйте это письмо.</p></div>`
    });
    return res.json({ message: "Если адрес указан верно, письмо с кодом отправлено. Проверьте входящие и папку «Спам»." });
  } catch (err) {
    pending.delete(email);
    console.error("Mail delivery failed:", err.message);
    return res.status(502).json({ message: "Не удалось отправить письмо. Проверьте настройки почтового сервера." });
  }
});

app.post("/api/verify-code", verifyLimiter, (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!email || !/^\d{5}$/.test(code)) {
    return res.status(400).json({ message: "Проверьте адрес и введите пятизначный код." });
  }

  const entry = pending.get(email);
  if (!entry || Date.now() > entry.expiresAt) {
    pending.delete(email);
    return res.status(400).json({ message: "Код не найден или срок его действия истёк. Запросите новый." });
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    pending.delete(email);
    return res.status(429).json({ message: "Лимит попыток исчерпан. Запросите новый код." });
  }

  entry.attempts += 1;
  const candidate = digest(email, code);
  if (!safeEqual(entry.hash, candidate)) {
    return res.status(400).json({ message: "Неверный код. Проверьте письмо и попробуйте ещё раз." });
  }

  pending.delete(email);
  return res.json({ message: "Почта успешно подтверждена." });
});

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Email verification site running on port ${port}`));
