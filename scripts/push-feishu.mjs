import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function truncate(value, length) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= length ? compact : `${compact.slice(0, length - 1)}…`;
}

export async function loadDigest(dataRoot) {
  const [productHunt, github] = await Promise.all([
    readFile(resolve(dataRoot, "producthunt/zh-CN/latest.json"), "utf8").then(JSON.parse),
    readFile(resolve(dataRoot, "github/zh-CN/latest.json"), "utf8").then(JSON.parse),
  ]);
  return {
    date: productHunt.date || github.taxonomy?.version || github.generatedAt.slice(0, 10),
    productHunt: productHunt.items.slice(0, 3).map((item) => ({
      name: item.name,
      description: item.description || item.tagline,
      metric: `${item.metrics?.votes ?? 0} 票`,
      url: item.links?.homepage || item.links.source,
    })),
    github: github.repos.slice(0, 3).map((repo) => ({
      name: `${repo.owner}/${repo.name}`,
      description: repo.readmeSignals?.summary || repo.metadata?.description || "暂无简介",
      metric: `+${repo.source?.starsGained ?? 0} stars`,
      url: repo.url,
    })),
  };
}

function markdownSection(title, items) {
  const rows = items.map(
    (item, index) =>
      `**${index + 1}. [${item.name}](${item.url})** · ${item.metric}\n${truncate(item.description, 88)}`,
  );
  return `### ${title}\n${rows.join("\n\n")}`;
}

export function buildCard(digest, pageUrl, imageKey) {
  const elements = [];
  if (imageKey) {
    elements.push({
      tag: "img",
      img_key: imageKey,
      alt: { tag: "plain_text", content: `${digest.date} Daily Tech Radar 页面截图` },
      mode: "fit_horizontal",
    });
  }
  elements.push(
    {
      tag: "markdown",
      content: `${markdownSection("Product Hunt Top 3", digest.productHunt)}\n\n${markdownSection("GitHub Trending Top 3", digest.github)}`,
    },
    {
      tag: "note",
      elements: [
        {
          tag: "plain_text",
          content: imageKey
            ? "页面截图、摘要和完整链接均已更新"
            : "摘要和网页已更新；配置飞书应用凭证后将自动附带页面截图",
        },
      ],
    },
    {
      tag: "action",
      actions: [
        {
          tag: "button",
          text: { tag: "plain_text", content: "查看完整 Daily Tech Radar" },
          url: pageUrl,
          type: "primary",
        },
      ],
    },
  );
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true, enable_forward: true },
      header: {
        template: "green",
        title: { tag: "plain_text", content: `Daily Tech Radar · ${digest.date}` },
        subtitle: { tag: "plain_text", content: "每日产品与开源技术趋势" },
      },
      elements,
    },
  };
}

async function capturePage(pageUrl, outputPath) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 60_000 });
    await page.locator(".radar-card").first().waitFor({ timeout: 30_000 });
    await page.screenshot({ path: outputPath, fullPage: false });
  } finally {
    await browser.close();
  }
}

async function uploadImage(imagePath, appId, appSecret) {
  const tokenResponse = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
  );
  const tokenPayload = await tokenResponse.json();
  if (!tokenResponse.ok || tokenPayload.code !== 0 || !tokenPayload.tenant_access_token) {
    throw new Error(`Feishu tenant token failed: ${tokenPayload.msg || tokenResponse.status}`);
  }
  const form = new FormData();
  form.set("image_type", "message");
  form.set("image", new Blob([await readFile(imagePath)], { type: "image/png" }), "daily-tech-radar.png");
  const imageResponse = await fetch("https://open.feishu.cn/open-apis/im/v1/images", {
    method: "POST",
    headers: { authorization: `Bearer ${tokenPayload.tenant_access_token}` },
    body: form,
  });
  const imagePayload = await imageResponse.json();
  if (!imageResponse.ok || imagePayload.code !== 0 || !imagePayload.data?.image_key) {
    throw new Error(`Feishu image upload failed: ${imagePayload.msg || imageResponse.status}`);
  }
  return imagePayload.data.image_key;
}

async function sendCard(webhookUrl, card) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(card),
  });
  const payload = await response.json();
  const code = payload.code ?? payload.StatusCode ?? -1;
  if (!response.ok || code !== 0) {
    throw new Error(`Feishu webhook failed: ${payload.msg || payload.StatusMessage || response.status}`);
  }
}

export async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
  const pageUrl = process.env.RADAR_PAGE_URL || "https://github.com/tutti-os/tutti-apps/tree/main/apps/daily-tech-radar";
  if (!webhookUrl && !dryRun) throw new Error("FEISHU_WEBHOOK_URL is required");

  const digest = await loadDigest(resolve(process.cwd(), "data"));
  let imageKey;
  if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET) {
    const screenshotPath = resolve(process.env.RUNNER_TEMP || ".", "daily-tech-radar.png");
    await capturePage(pageUrl, screenshotPath);
    imageKey = await uploadImage(
      screenshotPath,
      process.env.FEISHU_APP_ID,
      process.env.FEISHU_APP_SECRET,
    );
  } else {
    console.warn("FEISHU_APP_ID/FEISHU_APP_SECRET are not set; sending without an inline screenshot.");
  }

  const card = buildCard(digest, pageUrl, imageKey);
  if (dryRun) console.log(JSON.stringify(card, null, 2));
  else {
    await sendCard(webhookUrl, card);
    console.log(`Feishu notification sent for ${digest.date}.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
