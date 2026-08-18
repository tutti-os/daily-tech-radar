import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CATEGORY_RULES = [
  ["AI代理", ["ai代理", "agent", "代理", "智能体", "autonomous"]],
  ["图像生成", ["图像", "视觉", "image", "photo", "video", "design", "生成"]],
  ["财务AI", ["财务", "金融", "投资", "cash", "finance", "revenue", "invest"]],
  ["开发工具", ["开发", "工具", "编程", "代码", "github", "api", "cli", "sdk", "python", "typescript", "javascript", "jupyter", "前端", "后端"]],
  ["生产力", ["生产力", "项目管理", "写作", "笔记", "workflow", "效率"]],
  ["商业智能", ["商业智能", "analytics", "分析", "报表", "metrics", "dashboard"]],
  ["电商自动化", ["电商", "商店", "ecommerce", "shopify", "commerce", "store"]],
  ["安全隐私", ["安全", "隐私", "privacy", "security", "prompt injection"]],
  ["健康应用", ["健康", "health", "fitness", "apple health", "treadmill"]],
  ["内容创作", ["内容", "文本", "语音", "tts", "slide", "幻灯片", "创作"]],
  ["开源模型", ["开源模型", "开放权重", "open weight", "model", "模型", "moe"]],
  ["AI", ["ai", "llm", "模型", "智能", "claude", "gpt", "agent"]],
];
const CATEGORY_ORDER = [...CATEGORY_RULES.map(([label]) => label), "其他"];
const DEFAULT_EXPANDED_CATEGORIES = new Set(["AI代理", "开发工具"]);

export function deriveCategories(values) {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  const categories = CATEGORY_RULES.filter(([, patterns]) =>
    patterns.some((pattern) => text.includes(pattern)),
  ).map(([label]) => label);
  return [...new Set(categories.length ? categories : ["其他"])];
}

function githubCover(repo) {
  const visualUrl = repo.visual?.thumbUrl || repo.visual?.url;
  if (repo.visual?.kind === "repository_avatar" || isGithubAvatarVisual(repo, visualUrl)) {
    return `https://opengraph.githubassets.com/daily-tech-radar/${repo.owner}/${repo.name}`;
  }
  if (visualUrl) {
    const visualText = [visualUrl, repo.visual?.sourceUrl, repo.visual?.alt, repo.visual?.kind]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (
      !/(^|[-_/])(banner|readme-banner|logo)([-_.:/]|$)/.test(visualText)
    ) {
      return visualUrl;
    }
  }
  return repo.avatarUrl
    ? `https://opengraph.githubassets.com/daily-tech-radar/${repo.owner}/${repo.name}`
    : undefined;
}

function isGithubAvatarVisual(repo, visualUrl) {
  if (!visualUrl) return false;
  const withoutQuery = (value) => value?.split("?")[0].replace(/\/+$/, "").toLowerCase();
  if (withoutQuery(visualUrl) === withoutQuery(repo.avatarUrl)) return true;
  try {
    const url = new URL(visualUrl);
    return (
      (["github.com", "www.github.com"].includes(url.hostname.toLowerCase()) &&
        /^\/[^/]+\.png$/i.test(url.pathname)) ||
      url.hostname.toLowerCase() === "avatars.githubusercontent.com"
    );
  } catch {
    return false;
  }
}

export async function loadDigest(dataRoot) {
  const [productHunt, github] = await Promise.all([
    readFile(resolve(dataRoot, "producthunt/zh-CN/latest.json"), "utf8").then(JSON.parse),
    readFile(resolve(dataRoot, "github/zh-CN/latest.json"), "utf8").then(JSON.parse),
  ]);
  const taxonomy = new Map(github.taxonomy.categories.map((category) => [category.id, category.label]));
  const productItems = productHunt.items.map((item) => {
    const categories = deriveCategories([item.name, item.tagline, item.description, ...(item.keywords || [])]);
    return {
      id: `producthunt:${item.id}`,
      source: "producthunt",
      name: item.name,
      description: item.description || item.tagline,
      metric: `${item.metrics?.votes ?? 0} 票 · ${item.metrics?.comments ?? 0} 评论`,
      url: item.links?.homepage || item.links.source,
      imageUrl:
        item.assets?.media?.find((media) => media.type === "image" && media.url)?.url ||
        item.assets?.thumbnail ||
        item.assets?.icon,
      fallbackImageUrl: item.assets?.thumbnail || item.assets?.icon,
      categories,
      category: categories[0],
      rank: item.rank,
    };
  });
  const githubItems = github.repos.map((repo) => {
    const primary = taxonomy.get(repo.classification.primaryCategoryId) || repo.classification.primaryCategoryId;
    const secondary = repo.classification.secondaryCategoryIds.map((id) => taxonomy.get(id) || id);
    const categories = deriveCategories([
      primary,
      ...secondary,
      repo.name,
      repo.owner,
      repo.metadata?.description,
      repo.readmeSignals?.summary,
      repo.metadata?.language,
      ...(repo.readmeSignals?.keywords || []),
      ...(repo.metadata?.topics || []),
      ...(repo.classification?.signals || []),
    ]);
    return {
      id: `github:${repo.id}`,
      source: "github",
      name: `${repo.owner}/${repo.name}`,
      description: repo.readmeSignals?.summary || repo.metadata?.description || "暂无简介",
      metric: `+${repo.source?.starsGained ?? 0} stars · ${repo.metadata?.stars ?? 0} 总星标`,
      url: repo.url,
      imageUrl: githubCover(repo),
      fallbackImageUrl: undefined,
      categories,
      category: categories[0],
      rank: repo.rank.globalRank,
    };
  });
  return {
    date: productHunt.date || github.taxonomy?.version || github.generatedAt.slice(0, 10),
    items: [...productItems, ...githubItems],
  };
}

export function groupByCategory(items) {
  const groups = new Map();
  for (const item of items) {
    const itemsForCategory = groups.get(item.category) || [];
    itemsForCategory.push(item);
    groups.set(item.category, itemsForCategory);
  }
  return CATEGORY_ORDER.filter((category) => groups.has(category))
    .map((category) => ({
      category,
      items: groups.get(category).sort(
        (left, right) =>
          (left.source === right.source ? 0 : left.source === "producthunt" ? -1 : 1) ||
          left.rank - right.rank,
      ),
    }))
    .sort(
      (left, right) =>
        right.items.length - left.items.length ||
        CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category),
    );
}

function itemElements(items, imageKeys = {}) {
  return items.flatMap((item, index) => [
    {
      tag: "markdown",
      content: `**${index + 1}. [${item.name}](${item.url})** · ${item.metric}\n${item.description}`,
    },
    ...(imageKeys[item.id]
      ? [{
          tag: "img",
          img_key: imageKeys[item.id],
          alt: { tag: "plain_text", content: `${item.name} 对应封面图` },
          mode: "fit_horizontal",
          preview: true,
        }]
      : []),
    ...(index === items.length - 1 ? [] : [{ tag: "hr" }]),
  ]);
}

function collapsiblePanel(title, elements, expanded = false) {
  return {
    tag: "collapsible_panel",
    expanded,
    header: {
      title: { tag: "plain_text", content: title },
      icon: {
        tag: "standard_icon",
        token: "down-small-ccm_outlined",
        size: "16px 16px",
      },
      icon_position: "right",
      icon_expanded_angle: -180,
    },
    border: { color: "grey", corner_radius: "5px" },
    elements,
  };
}

export function buildCard(digest, pageUrl, images = {}) {
  const groups = groupByCategory(digest.items);
  const overview = groups.map(({ category, items }) => {
    const githubCount = items.filter((item) => item.source === "github").length;
    return `**${category}**（${items.length} 个项目｜GitHub ${githubCount}｜PH ${items.length - githubCount}）`;
  });
  const elements = [
    ...(images.screenshot
      ? [{
          tag: "img",
          img_key: images.screenshot,
          alt: { tag: "plain_text", content: `${digest.date} Daily Tech Radar 页面截图` },
          mode: "fit_horizontal",
          preview: true,
        }]
      : []),
    {
      tag: "markdown",
      content: `**分类项目看板**\n\n${overview.join("\n\n")}\n\n[查看完整 Daily Tech Radar](${pageUrl})`,
    },
  ];
  for (const { category, items } of groups) {
    const githubCount = items.filter((item) => item.source === "github").length;
    elements.push(
      collapsiblePanel(
        `${category}（${items.length} 个项目｜GitHub ${githubCount}｜PH ${items.length - githubCount}）`,
        itemElements(items, images.items),
        DEFAULT_EXPANDED_CATEGORIES.has(category),
      ),
    );
  }
  return {
    msg_type: "interactive",
    card: {
      schema: "2.0",
      config: { wide_screen_mode: true, update_multi: true },
      header: {
        template: "green",
        title: { tag: "plain_text", content: `Daily Tech Radar · ${digest.date}` },
        subtitle: {
          tag: "plain_text",
          content: `Product Hunt · GitHub · 共 ${digest.items.length} 个项目`,
        },
      },
      body: { elements },
    },
  };
}

export async function capturePage(pageUrl, outputPath) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    await page.goto(screenshotPageUrl(pageUrl), { waitUntil: "networkidle", timeout: 60_000 });
    await page.locator(".radar-card").first().waitFor({ timeout: 30_000 });
    await page.addStyleTag({
      content: `
        body {
          background-attachment: scroll !important;
          background-repeat: no-repeat !important;
          background-size: 100% 100% !important;
        }
      `,
    });
    await page.evaluate(async () => {
      for (let offset = 0; offset < document.documentElement.scrollHeight; offset += window.innerHeight) {
        window.scrollTo(0, offset);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
      }
      window.scrollTo(0, 0);
    });
    await page.screenshot({ path: outputPath, fullPage: true });
  } finally {
    await browser.close();
  }
}

export function screenshotPageUrl(pageUrl) {
  const url = new URL(pageUrl);
  url.searchParams.set("locale", "zh-CN");
  return url.toString();
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
  const response = await fetch("https://open.feishu.cn/open-apis/im/v1/images", {
    method: "POST",
    headers: { authorization: `Bearer ${tenantToken}` },
    body: form,
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0 || !payload.data?.image_key) {
    throw new Error(`Feishu image upload failed: ${payload.msg || response.status}`);
  }
  return payload.data.image_key;
}

async function uploadRemoteImage(imageUrl, tenantToken) {
  if (!imageUrl) return undefined;
  try {
    let response;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
      if (response.status !== 429 || attempt === 2) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000 * (attempt + 1)));
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    let contentType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    let bytes = await response.arrayBuffer();
    if (contentType.includes("svg") || imageUrl.toLowerCase().includes(".svg")) {
      bytes = await rasterizeSvg(bytes);
      contentType = "image/png";
    }
    const extension = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    return await uploadImage(bytes, contentType, `cover.${extension}`, tenantToken);
  } catch (error) {
    console.warn(`Skipping cover ${imageUrl}: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}

async function rasterizeSvg(svgBytes) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    const source = Buffer.from(svgBytes).toString("base64");
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%;background:#fff}body{display:grid;place-items:center}img{max-width:100%;max-height:100%;object-fit:contain}</style><img id="cover" src="data:image/svg+xml;base64,${source}">`,
    );
    await page.locator("#cover").waitFor({ state: "visible" });
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
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
  const images = { items: {} };
  if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET) {
    const tenantToken = await tenantAccessToken(process.env.FEISHU_APP_ID, process.env.FEISHU_APP_SECRET);
    if (process.env.RADAR_SCREENSHOT_ENABLED !== "false") {
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
    }
    for (const item of digest.items) {
      images.items[item.id] = await uploadRemoteImage(item.imageUrl, tenantToken);
      if (!images.items[item.id] && item.fallbackImageUrl !== item.imageUrl) {
        images.items[item.id] = await uploadRemoteImage(item.fallbackImageUrl, tenantToken);
      }
    }
  } else {
    console.warn("FEISHU_APP_ID/FEISHU_APP_SECRET are not set; sending text and links without images.");
  }

  const card = buildCard(digest, pageUrl, images);
  if (dryRun) console.log(JSON.stringify(card, null, 2));
  else {
    await sendCard(webhookUrl, card);
    console.log(`Sent one Feishu card with ${digest.items.length} items for ${digest.date}.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
