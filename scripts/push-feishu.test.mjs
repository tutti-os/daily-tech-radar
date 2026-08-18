import assert from "node:assert/strict";
import test from "node:test";
import { buildCard, deriveCategories, groupByCategory } from "./push-feishu.mjs";

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
  assert.equal(panels[0].expanded, false);
  assert.match(panels[0].elements[0].content, /A complete description that must never be truncated\./);
  assert.equal(panels[0].elements[1].img_key, "img_cover");
  assert.equal(panels[0].elements[1].alt.content, "Meridian 对应封面图");
});
