import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const SITE_URL = "https://vectiscode.com";
const DEFAULT_TITLE = "VectisCode | Local Roblox coding agent";
const DEFAULT_DESCRIPTION =
  "VectisCode is a free, open-source coding agent that works in your terminal and operates Roblox Studio through its native MCP server.";

export interface RouteMeta {
  title: string;
  description: string;
  canonical: string;
  noindex?: boolean;
}

const PUBLIC_META: Record<string, Omit<RouteMeta, "canonical">> = {
  "/": {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION
  },
  "/docs": {
    title: "Documentation | VectisCode",
    description: "Install VectisCode, connect a provider and Roblox Studio, and run your first supervised agent turn."
  },
  "/status": {
    title: "Release status | VectisCode",
    description: "Independent release status for the VectisCode website, account API, CLI package, source, and Roblox Studio MCP."
  },
  "/download": {
    title: "Install the CLI | VectisCode",
    description: "Install the free VectisCode public alpha from npm. Requires Node 20 or newer."
  },
  "/login": {
    title: "Sign in | VectisCode",
    description: "Sign in to the optional VectisCode account for connection labels, device sessions, and aggregate usage.",
    noindex: true
  },
  "/privacy": {
    title: "Privacy | VectisCode",
    description: "The privacy boundary between the local VectisCode CLI and its optional account service."
  },
  "/terms": {
    title: "Terms | VectisCode",
    description: "Terms for the open-source VectisCode CLI and optional hosted account service."
  }
};

const PRIVATE_PREFIXES = ["/account", "/new", "/chat", "/studio", "/profile", "/settings", "/admin", "/icons", "/models"];

function setMeta(name: string, content: string, attr: "name" | "property" = "name") {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attr, name);
    document.head.appendChild(element);
  }
  element.content = content;
}

function setCanonical(href: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!element) {
    element = document.createElement("link");
    element.rel = "canonical";
    document.head.appendChild(element);
  }
  element.href = href;
}

export function resolveRouteMeta(pathname: string): RouteMeta {
  const publicMeta = PUBLIC_META[pathname];
  if (publicMeta) {
    return { ...publicMeta, canonical: `${SITE_URL}${pathname === "/" ? "/" : pathname}` };
  }
  if (PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return { title: "Account | VectisCode", description: DEFAULT_DESCRIPTION, canonical: `${SITE_URL}/account`, noindex: true };
  }
  return { title: "Page not found | VectisCode", description: DEFAULT_DESCRIPTION, canonical: `${SITE_URL}/`, noindex: true };
}

export function useDocumentMeta(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    const meta = resolveRouteMeta(pathname);
    document.title = meta.title;
    setMeta("description", meta.description);
    setMeta("og:title", meta.title, "property");
    setMeta("og:description", meta.description, "property");
    setMeta("og:url", meta.canonical, "property");
    setMeta("twitter:title", meta.title);
    setMeta("twitter:description", meta.description);
    setMeta("robots", meta.noindex ? "noindex, follow" : "index, follow, max-image-preview:large");
    setCanonical(meta.canonical);
  }, [pathname]);
}
