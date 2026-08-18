import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCard,
  buildDailyHighlights,
  deriveCategories,
  generateDailyHighlights,
  groupByCategory,
  linkifyProjectNames,
  loadDigest,
  SCREENSHOT_FULL_PAGE,
  screenshotPageUrl,
} from "./push-feishu.mjs";

const productItem = {
  id: "producthunt:1",
  source: "producthunt",
  name: "Meridian",
  description: "A complete description that must never be truncated.",
  metric: "323 票",
  url: "https://example.com/meridian",
  category: "开发工具",
  categories: ["开发工具"],
  rank: 1,
};

test("classification mirrors the Radar app finite taxonomy", () => {
  assert.deepEqual(deriveCategories(["AI agent development API"]), ["AI代理", "开发工具", "AI"]);
  assert.deepEqual(deriveCategories(["gardening calendar"]), ["其他"]);
});

test("repository avatars become repo covers while real SVG visuals are preserved for rasterizing", async () => {
  const digest = await loadDigest("data");
  const memory = digest.items.find((item) => item.id === "github:akitaonrails-ai-memory");
  const cybersecurity = digest.items.find(
    (item) => item.id === "github:mukul975-anthropic-cybersecurity-skills",
  );
  const careerOps = digest.items.find((item) => item.id === "github:santifer-career-ops");
  assert.match(memory.imageUrl, /opengraph\.githubassets\.com\/daily-tech-radar\/akitaonrails\/ai-memory/);
  assert.match(
    cybersecurity.imageUrl,
    /opengraph\.githubassets\.com\/daily-tech-radar\/mukul975\/Anthropic-Cybersecurity-Skills/,
  );
  assert.match(careerOps.imageUrl, /producthunt\.svg$/);
});

test("primary category grouping keeps every item once in the single card", () => {
  const githubItem = {
    ...productItem,
    id: "github:1",
    source: "github",
    category: "AI代理",
    categories: ["AI代理", "开发工具", "AI"],
  };
  const groups = groupByCategory([productItem, githubItem]);
  assert.deepEqual(groups.map((group) => group.category), ["AI代理", "开发工具"]);
  assert.equal(groups.flatMap((group) => group.items).length, 2);
});

test("daily highlights summarize directions and each source leader", () => {
  const highlights = buildDailyHighlights([
    productItem,
    {
      ...productItem,
      id: "github:1",
      source: "github",
      name: "MoneyPrinterTurbo",
      metric: "+1275 stars",
      url: "https://github.com/harry0703/MoneyPrinterTurbo",
      category: "AI代理",
      categories: ["AI代理", "开发工具"],
    },
  ]);
  assert.match(highlights, /今日主题集中在 AI代理 1、开发工具 1/);
  assert.match(highlights, /Product Hunt.*Meridian.*complete description/);
  assert.match(highlights, /GitHub.*MoneyPrinterTurbo.*complete description/);
});

test("LLM highlights turn all items into three concrete Chinese insights", async () => {
  const githubItem = {
    ...productItem,
    id: "github:money-printer",
    source: "github",
    name: "harry0703/MoneyPrinterTurbo",
    url: "https://github.com/harry0703/MoneyPrinterTurbo",
  };
  const highlights = await generateDailyHighlights([productItem, githubItem], {
    apiKey: "test-key",
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ bullets: [
        "今天的产品集中在本地优先 AI 与可执行智能体，重点从聊天转向可审计、可接管的实际工作流。",
        "Meridian 自动记录并总结本地工作，Omni 则把智能体跨设备部署，体现个人 AI 基础设施正在成熟。",
        "MoneyPrinterTurbo 将脚本、素材和字幕串成视频流水线，Strix 则把自主安全验证带进软件交付过程。",
      ] }) } }],
    })),
  });
  assert.match(highlights, /今日趋势速览（基于全部 2 个项目）/);
  assert.match(highlights, /\*\*整体趋势\*\*：.*本地优先 AI/);
  assert.match(highlights, /\[Meridian\]\(https:\/\/example\.com\/meridian\)/);
  assert.match(highlights, /\[MoneyPrinterTurbo\]\(https:\/\/github\.com\/harry0703\/MoneyPrinterTurbo\)/);
  assert.equal(highlights.split("\n").length, 4);
});

test("project names and reliable short aliases use source URLs", () => {
  const items = [
    { ...productItem, name: "Omni by xpander", url: "https://example.com/omni" },
    {
      ...productItem,
      source: "github",
      name: "usestrix/strix",
      url: "https://github.com/usestrix/strix",
    },
  ];
  assert.equal(
    linkifyProjectNames("Omni 负责部署，Strix 负责安全验证。", items),
    "[Omni](https://example.com/omni) 负责部署，[Strix](https://github.com/usestrix/strix) 负责安全验证。",
  );
});

test("one card contains collapsible categories, full descriptions, and covers", () => {
  const card = buildCard(
    { date: "2026-08-18", items: [productItem] },
    "https://example.com/radar",
    { items: { "producthunt:1": "img_cover" } },
  );
  assert.equal(card.card.schema, "2.0");
  assert.doesNotMatch(card.card.body.elements[0].content, /开发工具.*1 个项目.*PH 1/);
  assert.match(card.card.body.elements[0].content, /点击分类标题展开项目，点击图片查看大图/);
  assert.match(card.card.body.elements[0].content, /今日重点/);
  assert.match(card.card.body.elements[0].content, /locale=zh-CN/);
  const intro = card.card.body.elements[0].content;
  assert.ok(intro.indexOf("查看完整") < intro.indexOf("分类项目看板"));
  assert.ok(intro.indexOf("分类项目看板") < intro.indexOf("点击分类标题"));
  const panels = card.card.body.elements.filter((element) => element.tag === "collapsible_panel");
  assert.equal(panels.length, 1);
  assert.match(panels[0].header.title.content, /开发工具.*1 个项目.*PH 1/);
  assert.equal(panels[0].expanded, false);
  assert.match(panels[0].elements[0].content, /A complete description that must never be truncated\./);
  assert.equal(panels[0].elements[1].img_key, "img_cover");
  assert.equal(panels[0].elements[1].alt.content, "Meridian 对应封面图");
});

test("all category panels are collapsed by default", () => {
  const card = buildCard(
    {
      date: "2026-08-18",
      items: [
        productItem,
        { ...productItem, id: "github:agent", source: "github", category: "AI代理" },
        { ...productItem, id: "github:other", source: "github", category: "其他" },
      ],
    },
    "https://example.com/radar",
  );
  const panels = card.card.body.elements.filter((element) => element.tag === "collapsible_panel");
  const panelByCategory = Object.fromEntries(
    panels.map((panel) => [panel.header.title.content.match(/^[^（]+/)[0], panel]),
  );
  assert.equal(panelByCategory.AI代理.expanded, false);
  assert.equal(panelByCategory.开发工具.expanded, false);
  assert.equal(panelByCategory.其他.expanded, false);
});

test("page screenshots always use Chinese without dropping existing filters", () => {
  assert.equal(SCREENSHOT_FULL_PAGE, false);
  assert.equal(
    screenshotPageUrl("https://example.com/radar?source=github&locale=en-US"),
    "https://example.com/radar?source=github&locale=zh-CN",
  );
});
