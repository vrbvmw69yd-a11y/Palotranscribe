import { chromium } from "playwright";
import fs from "node:fs/promises";

const base = process.env.APP_URL || "https://modelo-primer-parcial.lovable.app";
const audioPath = process.env.AUDIO_FILE || "/tmp/palotranscribe-test.wav";
const maxWaitMs = Number(process.env.MAX_WAIT_MS || 25 * 60_000);
const requestedIndex = Number(process.env.MODEL_INDEX ?? 0);
const allModels = [
  { index: 0, name: "Rápido" },
  { index: 1, name: "Recomendado" },
  { index: 2, name: "Pro" },
];
const model = allModels.find((m) => m.index === requestedIndex);
if (!model) throw new Error(`MODEL_INDEX inválido: ${process.env.MODEL_INDEX}`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
page.on("console", (msg) => console.log(`[browser:${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => console.error(`[pageerror] ${err.message}`));

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.evaluate(() => sessionStorage.setItem("tatamed-easter-access", "1"));
  await page.goto(`${base}/?ttm=1`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.locator('input[type="file"]').waitFor({ state: "attached", timeout: 90_000 });

  console.log(`=== Testing ${model.name} ===`);
  const radio = page.locator('label.model input[type="radio"]').nth(model.index);
  await radio.check({ force: true });
  await page.waitForTimeout(750);

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(audioPath);
  await page.waitForFunction(() => {
    const button = document.querySelector("button.go");
    const input = document.querySelector('input[type="file"]');
    return Boolean(button && !button.disabled && input && input.files && input.files.length === 1);
  }, null, { timeout: 90_000 });

  const go = page.locator("button.go");
  await go.scrollIntoViewIfNeeded();
  await go.click({ force: true });

  const progressSeen = new Set();
  const deadline = Date.now() + maxWaitMs;
  let terminal = "";
  let lastStatus = "";
  let lastDetail = "";
  let lastProgress = "";
  let nextLog = 0;

  while (Date.now() < deadline) {
    await page.waitForTimeout(2_000);
    const progressLabel = page.locator(".prog b");
    if (await progressLabel.count()) {
      lastProgress = (await progressLabel.first().textContent()) || "";
      const value = Number.parseInt(lastProgress, 10);
      if (Number.isFinite(value)) progressSeen.add(value);
    }

    lastStatus = ((await page.locator(".prog strong").first().textContent().catch(() => "")) || "").trim();
    lastDetail = ((await page.locator(".prog small").first().textContent().catch(() => "")) || "").trim();
    if (Date.now() >= nextLog) {
      console.log(`[state] ${model.name} · ${lastProgress} · ${lastStatus} · ${lastDetail}`);
      nextLog = Date.now() + 10_000;
    }

    if (lastStatus.includes("Transcripción terminada")) {
      terminal = lastStatus;
      break;
    }
    if (lastStatus.includes("No se pudo") || lastStatus.includes("Error")) {
      throw new Error(`${model.name}: ${lastStatus} — ${lastDetail}`);
    }
  }

  if (!terminal) throw new Error(`${model.name}: timeout · ${lastProgress} · ${lastStatus} — ${lastDetail}`);

  const resultText = ((await page.locator(".result pre").textContent()) || "").trim();
  if (!resultText || resultText.includes("[ARCHIVO OMITIDO")) throw new Error(`${model.name}: resultado vacío u omitido`);
  if (!/(hola|mundo|prueba|transcrip)/i.test(resultText)) throw new Error(`${model.name}: texto inesperado: ${resultText.slice(0, 250)}`);

  const values = [...progressSeen].sort((a, b) => a - b);
  if (!values.some((value) => value > 0 && value < 100)) throw new Error(`${model.name}: sin progreso intermedio (${values.join(", ")})`);
  const finalText = (await page.locator(".prog b").first().textContent()) || "";
  if (Number.parseInt(finalText, 10) !== 100) throw new Error(`${model.name}: la barra no terminó en 100% (${finalText})`);

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByRole("button", { name: /TXT completo/i }).click({ force: true }),
  ]);
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error(`${model.name}: no se generó el archivo TXT`);
  const stat = await fs.stat(downloadPath);
  if (stat.size < 20) throw new Error(`${model.name}: TXT demasiado pequeño (${stat.size} bytes)`);

  console.log(`${model.name}: OK · progreso ${values.join(" → ")} · TXT ${stat.size} bytes`);
  console.log("MODEL_TEST_OK");
} finally {
  await browser.close();
}
