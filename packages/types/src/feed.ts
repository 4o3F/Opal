// Feed document types (RSS/Atom/JSON Feed compatible)

import { z } from "zod";

// Feed format enum
export const FEED_FORMATS = ["rss", "atom", "jsonfeed"] as const;
export const FeedFormatSchema = z.enum(FEED_FORMATS);
export type FeedFormat = z.infer<typeof FeedFormatSchema>;

// Feed author schema
export const FeedAuthorSchema = z.object({
  name: z.string(),
  url: z.string().optional(),
  email: z.string().optional(),
});
export type FeedAuthor = z.infer<typeof FeedAuthorSchema>;

// Feed attachment schema
export const FeedAttachmentSchema = z.object({
  url: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().optional(),
  title: z.string().optional(),
  durationSeconds: z.number().optional(),
});
export type FeedAttachment = z.infer<typeof FeedAttachmentSchema>;

// Feed item schema
export const FeedItemSchema = z.object({
  id: z.string().min(1),
  url: z.string().optional(),
  title: z.string(),
  contentHtml: z.string().optional(),
  contentText: z.string().optional(),
  summary: z.string().optional(),
  image: z.string().optional(),
  datePublished: z.string().optional(),
  dateModified: z.string().optional(),
  authors: z.array(FeedAuthorSchema).optional(),
  tags: z.array(z.string()).optional(),
  attachments: z.array(FeedAttachmentSchema).optional(),
  language: z.string().optional(),
});
export type FeedItem = z.infer<typeof FeedItemSchema>;

// Feed document schema
export const FeedDocumentSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  homePageUrl: z.string().optional(),
  feedUrl: z.string().optional(),
  icon: z.string().optional(),
  favicon: z.string().optional(),
  authors: z.array(FeedAuthorSchema).optional(),
  language: z.string().optional(),
  items: z.array(FeedItemSchema),
});
export type FeedDocument = z.infer<typeof FeedDocumentSchema>;

// Feed response wrapper schema
export const FeedResponseStatusSchema = z.enum(["ready", "stale", "warming"]);
export const FeedResponseSchema = z.object({
  status: FeedResponseStatusSchema,
  cachedAt: z.string().optional(),
  feed: FeedDocumentSchema,
});
export type FeedResponse = z.infer<typeof FeedResponseSchema>;

// Type guard functions (backward compatible API)
export function isFeedAuthor(value: unknown): value is FeedAuthor {
  return FeedAuthorSchema.safeParse(value).success;
}

export function isFeedAttachment(value: unknown): value is FeedAttachment {
  return FeedAttachmentSchema.safeParse(value).success;
}

export function isFeedItem(value: unknown): value is FeedItem {
  return FeedItemSchema.safeParse(value).success;
}

export function isFeedDocument(value: unknown): value is FeedDocument {
  return FeedDocumentSchema.safeParse(value).success;
}

export function isFeedResponse(value: unknown): value is FeedResponse {
  return FeedResponseSchema.safeParse(value).success;
}

// Parse functions (throw on invalid input)
export function parseFeedAuthor(value: unknown): FeedAuthor {
  return FeedAuthorSchema.parse(value);
}

export function parseFeedAttachment(value: unknown): FeedAttachment {
  return FeedAttachmentSchema.parse(value);
}

export function parseFeedItem(value: unknown): FeedItem {
  return FeedItemSchema.parse(value);
}

export function parseFeedDocument(value: unknown): FeedDocument {
  return FeedDocumentSchema.parse(value);
}

export function parseFeedResponse(value: unknown): FeedResponse {
  return FeedResponseSchema.parse(value);
}

// Safe parse functions (return result object)
export function safeParseFeedAuthor(value: unknown) {
  return FeedAuthorSchema.safeParse(value);
}

export function safeParseFeedAttachment(value: unknown) {
  return FeedAttachmentSchema.safeParse(value);
}

export function safeParseFeedItem(value: unknown) {
  return FeedItemSchema.safeParse(value);
}

export function safeParseFeedDocument(value: unknown) {
  return FeedDocumentSchema.safeParse(value);
}

export function safeParseFeedResponse(value: unknown) {
  return FeedResponseSchema.safeParse(value);
}
