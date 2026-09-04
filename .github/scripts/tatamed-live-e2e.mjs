import { chromium } from "playwright";
import fs from "node:fs/promises";

const base = "https://modelo-primer-parcial.lovable.app";
const audioPath = "/tmp/palotranscribe-test.wav";
const model = {
  index: Number(process.env.MODEL_INDEX || 0),
  name: process.env.MODEL_NAME || "Rápido",
};
const maxWaitMs = Number(process.env.MAX_WAIT_MS || 360000);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
page.on("console", (msg) => console.log(`[browser:${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => console.error(`[pageerror] ${err.message}`));

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.evaluate(() => sessionStorage.setItem("tatamed-easter-access", "1"));
  await page.goto(`${base}/?ttm=1`, { waitUntil: "domcontentloaded", timeout: 90000 });

  const fileInput = page.locator('input[type="file"]');
  await fileInput.waitFor({ state: "attached", timeout: 90000 });

  const radio = page.locator('label.model input[type="radio"]').nth(model.index);
  await radio.check({ force: true });
  await fileInput.setInputFiles(audioPath);

  const go = page.locator("button.go");
  await page.waitForFunction(() => {
    const button = document.querySelector("button.go");
    const input = document.querySelector('input[type="file"]');
    return Boolean(button && !button.disabled && input?.files?.length);
  }, null, { timeout: 30000 });
  await go.click({ force: true });

  const progressValues = new Set();
  const deadline = Date.now() + maxWaitMs;
  let lastStatus = "";
  let lastDetail = "";
  let lastProgress = "";
  let nextLog = 0;

  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);
    lastProgress = ((await page.locator(".prog b").first().textContent().catch(() => "")) || "").trim();
    lastStatus = ((await page.locator(".prog strong").first().textContent().catch(() => "")) || "").trim();
    lastDetail = ((await page.locator(".prog small").first().textContent().catch(() => "")) || "").trim();
    const value = Number.parseInt(lastProgress, 10);
    if (Number.isFinite(value)) progressValues.add(value);

    if (Date.now() >= nextLog) {
      console.log(`[state] ${model.name} · ${lastProgress} · ${lastStatus} · ${lastDetail}`);
      nextLog = Date.now() + 10000;
    }

    if (lastStatus.includes("Transcripción terminada")) break;
    if (lastStatus.includes("No se pudo") || lastStatus.includes("Error")) {
      throw new Error(`${model.name}: ${lastStatus} — ${lastDetail}`);
    }
  }

  if (!lastStatus.includes("Transcripción terminada")) {
    throw new Error(`${model.name}: timeout · ${lastProgress} · ${lastStatus} — ${lastDetail}`);
  }

  const resultText = ((await page.locator(".result pre").textContent()) || "").trim();
  if (!resultText || resultText.includes("[ARCHIVO OMITIDO")) {
    throw new Error(`${model.name}: resultado vacío u omitido: ${resultText.slice(0, 300)}`);
  }
  if (!/(hola|mundo|prueba|transcrip)/i.test(resultText)) {
    throw new Error(`${model.name}: texto no corresponde al audio: ${resultText.slice(0, 300)}`);
  }

  const values = [...progressValues].sort((a, b) => a - b);
  if (!values.some((value) => value > 0 && value < 100)) {
    throw new Error(`${model.name}: no hubo progreso intermedio (${values.join(", ")})`);
  }
  if (Number.parseInt(lastProgress, 10) !== 100) {
    throw new Error(`${model.name}: progreso final no llegó a 100% (${lastProgress})`);
  }

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    page.getByRole("button", { name: /TXT completo/i }).click({ force: true }),
  ]);
  const path = await download.path();
  if (!path) throw new Error(`${model.name}: no se creó el TXT`);
  const stat = await fs.stat(path);
  if (stat.size < 20) throw new Error(`${model.name}: TXT vacío o demasiado pequeño (${stat.size} bytes)`);

  console.log(`PASS ${model.name} · progreso ${values.join(" → ")} · TXT ${stat.size} bytes`);
  console.log(`TRANSCRIPT ${resultText.slice(0, 500)}`);
} finally {
  await browser.close();
}
