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
      imageUrl:
        item.assets?.media?.find((media) => media.type === "image")?.url ||
        item.assets?.thumbnail ||
        item.assets?.icon,
    })),
    github: github.repos.slice(0, 3).map((repo) => ({
      name: `${repo.owner}/${repo.name}`,
      description: repo.readmeSignals?.summary || repo.metadata?.description || "暂无简介",
      metric: `+${repo.source?.starsGained ?? 0} stars`,
      url: repo.url,
      imageUrl: repo.visual?.url || repo.visual?.thumbUrl || repo.avatarUrl,
    })),
  };
}

function itemElements(items, imageKeys = []) {
  return items.flatMap((item, index) => {
    const elements = [
      {
        tag: "markdown",
        content: `**${index + 1}. [${item.name}](${item.url})** · ${item.metric}\n${truncate(item.description, 88)}`,
      },
    ];
    if (imageKeys[index]) {
      elements.push({
        tag: "img",
        img_key: imageKeys[index],
        alt: { tag: "plain_text", content: `${item.name} 产品图片` },
        mode: "fit_horizontal",
        preview: true,
      });
    }
    return elements;
  });
}

export function buildCard(digest, pageUrl, images = {}) {
  const elements = [];
  if (images.screenshot) {
    elements.push({
      tag: "img",
      img_key: images.screenshot,
      alt: { tag: "plain_text", content: `${digest.date} Daily Tech Radar 页面截图` },
      mode: "fit_horizontal",
    });
  }
  elements.push(
    { tag: "markdown", content: "**Product Hunt Top 3**" },
    ...itemElements(digest.productHunt, images.productHunt),
    { tag: "hr" },
    { tag: "markdown", content: "**GitHub Trending Top 3**" },
    ...itemElements(digest.github, images.github),
    {
      tag: "note",
      elements: [
        {
          tag: "plain_text",
          content: images.screenshot
            ? "页面截图、产品图片、摘要和完整链接均已更新"
            : images.productHunt?.some(Boolean) || images.github?.some(Boolean)
              ? "产品图片、摘要和完整链接均已更新"
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

async function tenantAccessToken(appId, appSecret) {
  const response = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
  );
  const payload = await response.json();
  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
    throw new Error(`Feishu tenant token failed: ${payload.msg || response.status}`);
  }
  return payload.tenant_access_token;
}

async function uploadImage(bytes, contentType, filename, tenantToken) {
  const form = new FormData();
  form.set("image_type", "message");
  form.set("image", new Blob([bytes], { type: contentType }), filename);
  const imageResponse = await fetch("https://open.feishu.cn/open-apis/im/v1/images", {
    method: "POST",
    headers: { authorization: `Bearer ${tenantToken}` },
    body: form,
  });
  const imagePayload = await imageResponse.json();
  if (!imageResponse.ok || imagePayload.code !== 0 || !imagePayload.data?.image_key) {
    throw new Error(`Feishu image upload failed: ${imagePayload.msg || imageResponse.status}`);
  }
  return imagePayload.data.image_key;
}

async function uploadRemoteImage(imageUrl, tenantToken) {
  if (!imageUrl) return undefined;
  try {
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    const extension = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    return await uploadImage(await response.arrayBuffer(), contentType, `product.${extension}`, tenantToken);
  } catch (error) {
    console.warn(`Skipping product image ${imageUrl}: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
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
  const images = { productHunt: [], github: [] };
  if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET) {
    const tenantToken = await tenantAccessToken(
      process.env.FEISHU_APP_ID,
      process.env.FEISHU_APP_SECRET,
    );
    const screenshotPath = resolve(process.env.RUNNER_TEMP || ".", "daily-tech-radar.png");
    try {
      await capturePage(pageUrl, screenshotPath);
      images.screenshot = await uploadImage(
        await readFile(screenshotPath),
        "image/png",
        "daily-tech-radar.png",
        tenantToken,
      );
    } catch (error) {
      console.warn(`Skipping page screenshot: ${error instanceof Error ? error.message : error}`);
    }
    [images.productHunt, images.github] = await Promise.all(
      [digest.productHunt, digest.github].map((items) =>
        Promise.all(items.map((item) => uploadRemoteImage(item.imageUrl, tenantToken))),
      ),
    );
  } else {
    console.warn("FEISHU_APP_ID/FEISHU_APP_SECRET are not set; sending without an inline screenshot.");
  }

  const card = buildCard(digest, pageUrl, images);
  if (dryRun) console.log(JSON.stringify(card, null, 2));
  else {
    await sendCard(webhookUrl, card);
    console.log(`Feishu notification sent for ${digest.date}.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
