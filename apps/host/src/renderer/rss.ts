// RSS 2.0 feed renderer

import type { FeedDocument, FeedItem } from "@opal/types";
import { el, renderXml, toRssDate } from "./xml-builder.ts";

function renderItem(item: FeedItem) {
  const guid = item.url ?? item.id;
  const description = item.summary ?? item.contentText ?? item.contentHtml;
  const pubDate = toRssDate(item.datePublished) ?? toRssDate(item.dateModified);

  return el(
    "item",
    el("title", item.title),
    item.url && el("link", item.url),
    el("guid", { isPermaLink: item.url !== undefined }, guid),
    description && el("description", description),
    pubDate && el("pubDate", pubDate),
    ...(item.authors ?? []).map((author) => el("author", author.email ?? author.name)),
    ...(item.tags ?? []).map((tag) => el("category", tag)),
    ...(item.attachments ?? []).map((att) =>
      el("enclosure", {
        url: att.url,
        type: att.mimeType,
        length: att.sizeBytes,
      })
    )
  );
}

export function renderRss(document: FeedDocument): string {
  const link = document.homePageUrl ?? document.feedUrl;
  if (link === undefined) {
    throw new TypeError(
      "RSS rendering requires FeedDocument.homePageUrl or FeedDocument.feedUrl"
    );
  }

  const rss = el(
    "rss",
    { version: "2.0" },
    el(
      "channel",
      el("title", document.title),
      el("link", link),
      el("description", document.description ?? document.title),
      document.language && el("language", document.language),
      document.icon &&
        el(
          "image",
          el("url", document.icon),
          el("title", document.title),
          el("link", link)
        ),
      ...document.items.map(renderItem)
    )
  );

  return renderXml(rss);
}
