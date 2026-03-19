// Feed renderer module exports

import type { FeedDocument, FeedFormat } from "@opal/types";
import { renderAtom } from "./atom.ts";
import { renderJsonFeed } from "./jsonfeed.ts";
import { renderRss } from "./rss.ts";

export { renderAtom } from "./atom.ts";
export { renderJsonFeed } from "./jsonfeed.ts";
export { renderRss } from "./rss.ts";
export { el, renderXml, toIsoDate, toRssDate, type XmlElement } from "./xml-builder.ts";

export function renderFeed(format: FeedFormat, document: FeedDocument): string {
  switch (format) {
    case "rss":
      return renderRss(document);
    case "atom":
      return renderAtom(document);
    case "jsonfeed":
      return renderJsonFeed(document);
  }
}

export function getFeedContentType(format: FeedFormat): string {
  switch (format) {
    case "rss":
      return "application/rss+xml; charset=utf-8";
    case "atom":
      return "application/atom+xml; charset=utf-8";
    case "jsonfeed":
      return "application/feed+json; charset=utf-8";
  }
}
