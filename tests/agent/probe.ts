/**
 * Agent browser-automation probe.
 *
 * A Playwright-driven (library, not test runner) script that an AI agent can
 * run and extend to drive the game in a real browser: it boots the game,
 * reads the state exposed on `window.__gameState`, sends input, takes a
 * screenshot, and writes a JSON report to tests/agent/artifacts/.
 *
 * Run with: bun run test:agent
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const PORT = 4199;
const BASE_URL = `http://localhost:${PORT}`;
const ARTIFACTS = new URL("./artifacts/", import.meta.url).pathname;

interface StepResult {
  step: string;
  ok: boolean;
  detail?: unknown;
}

const steps: StepResult[] = [];

async function waitForServer(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await Bun.sleep(200);
  }
  throw new Error(`Dev server did not come up on ${BASE_URL}`);
}

async function main(): Promise<void> {
  const server = Bun.spawn(["bun", "--port", String(PORT), "index.html"], {
    stdout: "inherit",
    stderr: "inherit",
  });

  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await waitForServer();
    await mkdir(ARTIFACTS, { recursive: true });

    browser = await chromium.launch();
    // Mobile-first: probe with a phone-sized touch viewport.
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    page.on("pageerror", (err) =>
      steps.push({ step: "pageerror", ok: false, detail: String(err) }),
    );

    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__gameState?.ready === true, undefined, {
      timeout: 15_000,
    });
    steps.push({ step: "boot", ok: true });

    const initial = await page.evaluate(() => window.__gameState);
    steps.push({ step: "read-state", ok: true, detail: initial });

    // Tap two tiles right of screen center: the cursor should follow the tap.
    // Done first, while the camera is still centered on the boot cursor.
    await page.touchscreen.tap(390 / 2 + 64, 844 / 2);
    await Bun.sleep(100);
    const tapped = await page.evaluate(() => window.__gameState?.cursor);
    const tapOk =
      !!initial && !!tapped && tapped.x === initial.cursor.x + 2 && tapped.y === initial.cursor.y;
    steps.push({
      step: "tap-moves-cursor",
      ok: tapOk,
      detail: { before: initial?.cursor, after: tapped },
    });

    for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft"] as const) {
      await page.keyboard.press(key);
    }
    await Bun.sleep(100);
    const moved = await page.evaluate(() => window.__gameState?.cursor);
    const movedOk = !!tapped && !!moved && moved.x === tapped.x && moved.y === tapped.y + 1;
    steps.push({
      step: "cursor-moves",
      ok: movedOk,
      detail: { before: tapped, after: moved },
    });

    await page.mouse.move(195, 422);
    await page.mouse.down();
    await page.mouse.move(380, 260, { steps: 5 });
    await page.mouse.up();
    steps.push({ step: "camera-drag-pan", ok: true });

    const canvas = page.locator("#game canvas");
    await canvas.screenshot({ path: `${ARTIFACTS}probe-screenshot.png` });
    steps.push({ step: "screenshot", ok: true, detail: "artifacts/probe-screenshot.png" });
  } finally {
    await browser?.close();
    server.kill();
  }

  const failed = steps.filter((s) => !s.ok);
  const report = { url: BASE_URL, at: new Date().toISOString(), ok: failed.length === 0, steps };
  await writeFile(`${ARTIFACTS}probe-report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
