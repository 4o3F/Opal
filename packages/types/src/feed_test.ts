import { assertEquals } from "@std/assert";
import { isFeedItem, isFeedDocument } from "./feed.ts";

// Test isFeedItem rejects invalid items
Deno.test("isFeedItem rejects null in array", () => {
  assertEquals(isFeedItem(null), false);
});

Deno.test("isFeedItem rejects empty id", () => {
  assertEquals(isFeedItem({ id: "", title: "Test" }), false);
});

Deno.test("isFeedItem rejects invalid optional field types", () => {
  assertEquals(isFeedItem({ id: "1", title: "Test", url: 123 }), false);
  assertEquals(isFeedItem({ id: "1", title: "Test", authors: "invalid" }), false);
  assertEquals(isFeedItem({ id: "1", title: "Test", tags: [1, 2, 3] }), false);
});

Deno.test("isFeedItem accepts valid item", () => {
  assertEquals(isFeedItem({ id: "1", title: "Test" }), true);
  assertEquals(
    isFeedItem({
      id: "1",
      title: "Test",
      url: "https://example.com",
      authors: [{ name: "Author" }],
      tags: ["a", "b"],
    }),
    true
  );
});

// Test isFeedDocument validates items array
Deno.test("isFeedDocument rejects invalid items in array", () => {
  const doc = {
    title: "Feed",
    items: [null],
  };
  assertEquals(isFeedDocument(doc), false);
});

Deno.test("isFeedDocument rejects items with invalid structure", () => {
  const doc = {
    title: "Feed",
    items: [{ id: "1", title: "OK" }, { missing: "fields" }],
  };
  assertEquals(isFeedDocument(doc), false);
});

Deno.test("isFeedDocument accepts valid document", () => {
  const doc = {
    title: "Feed",
    items: [
      { id: "1", title: "Item 1" },
      { id: "2", title: "Item 2" },
    ],
  };
  assertEquals(isFeedDocument(doc), true);
});

Deno.test("isFeedDocument validates optional authors array", () => {
  const invalid = {
    title: "Feed",
    items: [],
    authors: [{ invalid: true }],
  };
  assertEquals(isFeedDocument(invalid), false);

  const valid = {
    title: "Feed",
    items: [],
    authors: [{ name: "Author" }],
  };
  assertEquals(isFeedDocument(valid), true);
});
