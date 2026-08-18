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
  const withImage = buildCard(digest, "https://example.com", "img_v2_test");
  assert.equal(withoutImage.card.elements.some((element) => element.tag === "img"), false);
  assert.equal(withImage.card.elements[0].img_key, "img_v2_test");
  assert.equal(withImage.card.config.wide_screen_mode, true);
});
