// Lightweight type-safe XML builder

export type XmlAttributes = Record<string, string | number | boolean | undefined>;
export type XmlChild = XmlElement | string | undefined | null | false;

export type XmlElement = {
  readonly tag: string;
  readonly attrs?: XmlAttributes;
  readonly children?: readonly XmlChild[];
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeAttr(value: string): string {
  return escapeXml(value);
}

export function el(tag: string, ...args: (XmlAttributes | XmlChild)[]): XmlElement {
  let attrs: XmlAttributes | undefined;
  const children: XmlChild[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (i === 0 && arg !== null && typeof arg === "object" && !("tag" in arg)) {
      attrs = arg as XmlAttributes;
    } else {
      children.push(arg as XmlChild);
    }
  }

  return { tag, attrs, children };
}

function renderAttrs(attrs: XmlAttributes | undefined): string {
  if (attrs === undefined) return "";

  const parts: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (value === true) {
      parts.push(` ${key}="${key}"`);
    } else {
      parts.push(` ${key}="${escapeAttr(String(value))}"`);
    }
  }
  return parts.join("");
}

function renderChildren(children: readonly XmlChild[] | undefined, indent: string): string {
  if (children === undefined || children.length === 0) return "";

  const parts: string[] = [];
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    if (typeof child === "string") {
      parts.push(escapeXml(child));
    } else {
      parts.push(renderElement(child, indent));
    }
  }
  return parts.join("");
}

function renderElement(element: XmlElement, indent: string): string {
  const { tag, attrs, children } = element;
  const attrStr = renderAttrs(attrs);

  if (children === undefined || children.length === 0) {
    return `${indent}<${tag}${attrStr} />`;
  }

  const hasElementChildren = children.some(
    (child) => child !== undefined && child !== null && child !== false && typeof child !== "string"
  );

  if (hasElementChildren) {
    const childIndent = indent + "  ";
    const childParts: string[] = [];

    for (const child of children) {
      if (child === undefined || child === null || child === false) continue;
      if (typeof child === "string") {
        childParts.push(`${childIndent}${escapeXml(child)}`);
      } else {
        childParts.push(renderElement(child, childIndent));
      }
    }

    return `${indent}<${tag}${attrStr}>\n${childParts.join("\n")}\n${indent}</${tag}>`;
  }

  const textContent = renderChildren(children, "");
  return `${indent}<${tag}${attrStr}>${textContent}</${tag}>`;
}

export type RenderOptions = {
  declaration?: boolean;
  encoding?: string;
};

export function renderXml(element: XmlElement, options: RenderOptions = {}): string {
  const { declaration = true, encoding = "UTF-8" } = options;
  const body = renderElement(element, "");

  if (declaration) {
    return `<?xml version="1.0" encoding="${encoding}"?>\n${body}`;
  }

  return body;
}

export function toIsoDate(value?: string): string | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

export function toRssDate(value?: string): string | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toUTCString();
}
