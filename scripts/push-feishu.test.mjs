import assert from "node:assert/strict";
import test from "node:test";
import { buildCard, truncate } from "./push-feishu.mjs";

test("truncate preserves short text and ellipsizes long text", () => {
  assert.equal(truncate("short", 8), "short");
  assert.equal(truncate("abcdef", 5), "abcd…");
});

test("card only includes an image when Feishu returned an image key", () => {
  const digest = { date: "2026-08-18", productHunt: [], github: [] };
  const withoutImage = buildCard(digest, "https://example.com");
  const withImage = buildCard(digest, "https://example.com", {
    screenshot: "img_v2_test",
  });
  assert.equal(withoutImage.card.elements.some((element) => element.tag === "img"), false);
  assert.equal(withImage.card.elements[0].img_key, "img_v2_test");
  assert.equal(withImage.card.config.wide_screen_mode, true);
});

test("card places each available product image after its summary", () => {
  const item = { name: "Meridian", description: "AI work journal", metric: "323 票", url: "https://example.com" };
  const card = buildCard(
    { date: "2026-08-18", productHunt: [item], github: [] },
    "https://example.com",
    { productHunt: ["img_product"] },
  );
  const productImageIndex = card.card.elements.findIndex((element) => element.img_key === "img_product");
  assert.equal(card.card.elements[productImageIndex - 1].tag, "markdown");
  assert.equal(card.card.elements[productImageIndex].alt.content, "Meridian 产品图片");
});
