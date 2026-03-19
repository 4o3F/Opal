// JSON Feed 1.1 renderer

import type { FeedDocument } from "@opal/types";

type JsonFeedAuthor = {
  name: string;
  url?: string;
  email?: string;
};

type JsonFeedAttachment = {
  url: string;
  mime_type: string;
  title?: string;
  size_in_bytes?: number;
  duration_in_seconds?: number;
};

type JsonFeedItem = {
  id: string;
  url?: string;
  title: string;
  content_html?: string;
  content_text?: string;
  summary?: string;
  image?: string;
  date_published?: string;
  date_modified?: string;
  language?: string;
  authors?: JsonFeedAuthor[];
  tags?: string[];
  attachments?: JsonFeedAttachment[];
};

type JsonFeed = {
  version: string;
  title: string;
  home_page_url?: string;
  feed_url?: string;
  description?: string;
  icon?: string;
  favicon?: string;
  language?: string;
  authors?: JsonFeedAuthor[];
  items: JsonFeedItem[];
};

function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key as keyof T] = value as T[keyof T];
    }
  }
  return result;
}

export function renderJsonFeed(document: FeedDocument): string {
  const feed: JsonFeed = {
    version: "https://jsonfeed.org/version/1.1",
    title: document.title,
    ...omitUndefined({
      home_page_url: document.homePageUrl,
      feed_url: document.feedUrl,
      description: document.description,
      icon: document.icon,
      favicon: document.favicon,
      language: document.language,
    }),
    authors: document.authors?.map((author) =>
      omitUndefined({
        name: author.name,
        url: author.url,
        email: author.email,
      }) as JsonFeedAuthor
    ),
    items: document.items.map((item) => ({
      id: item.id,
      title: item.title,
      ...omitUndefined({
        url: item.url,
        content_html: item.contentHtml,
        content_text: item.contentText,
        summary: item.summary,
        image: item.image,
        date_published: item.datePublished,
        date_modified: item.dateModified,
        language: item.language,
      }),
      authors: item.authors?.map((author) =>
        omitUndefined({
          name: author.name,
          url: author.url,
          email: author.email,
        }) as JsonFeedAuthor
      ),
      tags: item.tags,
      attachments: item.attachments?.map((att) =>
        omitUndefined({
          url: att.url,
          mime_type: att.mimeType,
          title: att.title,
          size_in_bytes: att.sizeBytes,
          duration_in_seconds: att.durationSeconds,
        }) as JsonFeedAttachment
      ),
    })),
  };

  return JSON.stringify(feed, null, 2);
}
