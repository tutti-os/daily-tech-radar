import assert from "node:assert/strict";
import test from "node:test";
import { buildCard, deriveCategories, groupByCategory, loadDigest } from "./push-feishu.mjs";

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

test("one card contains collapsible categories, full descriptions, and covers", () => {
  const card = buildCard(
    { date: "2026-08-18", items: [productItem] },
    "https://example.com/radar",
    { items: { "producthunt:1": "img_cover" } },
  );
  assert.equal(card.card.schema, "2.0");
  assert.match(card.card.body.elements[0].content, /开发工具.*1 个项目.*PH 1/);
  const panels = card.card.body.elements.filter((element) => element.tag === "collapsible_panel");
  assert.equal(panels.length, 1);
  assert.equal(panels[0].expanded, true);
  assert.match(panels[0].elements[0].content, /A complete description that must never be truncated\./);
  assert.equal(panels[0].elements[1].img_key, "img_cover");
  assert.equal(panels[0].elements[1].alt.content, "Meridian 对应封面图");
});

test("AI agent and developer tool panels are expanded by default", () => {
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
  assert.equal(panelByCategory.AI代理.expanded, true);
  assert.equal(panelByCategory.开发工具.expanded, true);
  assert.equal(panelByCategory.其他.expanded, false);
});
