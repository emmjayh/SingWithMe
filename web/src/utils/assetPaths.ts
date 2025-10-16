const ABSOLUTE_URL_PATTERN = /^(?:[a-z][a-z\d+\-.]*:)?\/\//i;

function toRelativePath(path: string) {
  if (!path) return "";
  return path.startsWith("/") ? path.slice(1) : path;
}

export function resolveAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (ABSOLUTE_URL_PATTERN.test(path) || path.startsWith("data:") || path.startsWith("blob:")) {
    return path;
  }

  const relativePath = toRelativePath(path);

  if (typeof window !== "undefined") {
    const { protocol, href, origin } = window.location;
    if (protocol === "file:") {
      const baseHref = new URL(".", href).toString();
      return new URL(relativePath, baseHref).toString();
    }

    const base = import.meta.env.BASE_URL ?? "/";
    const baseUrl = new URL(base, origin).toString();
    return new URL(relativePath, baseUrl).toString();
  }

  const base = import.meta.env.BASE_URL ?? "/";
  // Fallback for non-browser environments – best effort to keep relative paths intact.
  if (base === "/") {
    return `/${relativePath}`;
  }
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return `${normalizedBase}${relativePath}`;
}
