// Atom 1.0 feed renderer

import type { FeedAuthor, FeedDocument, FeedItem } from "@opal/types";
import { el, renderXml, toIsoDate, type XmlElement } from "./xml-builder.ts";

function renderAuthor(author: FeedAuthor): XmlElement {
  return el(
    "author",
    el("name", author.name),
    author.url && el("uri", author.url),
    author.email && el("email", author.email)
  );
}

function resolveFeedUpdated(document: FeedDocument): string {
  for (const item of document.items) {
    const date = toIsoDate(item.dateModified) ?? toIsoDate(item.datePublished);
    if (date !== undefined) return date;
  }
  return new Date().toISOString();
}

function renderEntry(item: FeedItem, feedUpdated: string): XmlElement {
  const updated = toIsoDate(item.dateModified) ?? toIsoDate(item.datePublished) ?? feedUpdated;
  const published = toIsoDate(item.datePublished);
  const summary = item.summary ?? item.contentText;
  const entryId = item.url ?? `urn:opal:item:${item.id}`;

  return el(
    "entry",
    el("id", entryId),
    el("title", item.title),
    item.url && el("link", { href: item.url }),
    el("updated", updated),
    published && el("published", published),
    summary && el("summary", summary),
    ...(item.authors ?? []).map(renderAuthor),
    ...(item.tags ?? []).map((tag) => el("category", { term: tag })),
    item.contentHtml && el("content", { type: "html" }, item.contentHtml),
    !item.contentHtml && item.contentText && el("content", { type: "text" }, item.contentText)
  );
}

export function renderAtom(document: FeedDocument): string {
  const updated = resolveFeedUpdated(document);
  const feedId =
    document.feedUrl ??
    document.homePageUrl ??
    `urn:opal:feed:${encodeURIComponent(document.title)}`;

  const feed = el(
    "feed",
    {
      xmlns: "http://www.w3.org/2005/Atom",
      "xml:lang": document.language,
    },
    el("id", feedId),
    el("title", document.title),
    el("updated", updated),
    document.feedUrl && el("link", { rel: "self", href: document.feedUrl }),
    document.homePageUrl && el("link", { rel: "alternate", href: document.homePageUrl }),
    document.description && el("subtitle", document.description),
    document.icon && el("logo", document.icon),
    document.favicon && el("icon", document.favicon),
    ...(document.authors ?? []).map(renderAuthor),
    ...document.items.map((item) => renderEntry(item, updated))
  );

  return renderXml(feed);
}
