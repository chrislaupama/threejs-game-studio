/** Resolve files copied from Vite's public directory under any configured base. */
export function publicAssetUrl(relativePath: string): string {
  const localPath = relativePath.replace(/^\/+/, '');
  if (
    !localPath ||
    /^[a-z][a-z\d+.-]*:/i.test(localPath) ||
    localPath.includes('\\') ||
    /[\u0000-\u001f\u007f?#]/.test(localPath)
  ) {
    throw new Error(`Expected a project-local public asset path: ${relativePath}`);
  }

  // Validate repeatedly decoded text so `%2e%2e`, `%252e%252e`, and encoded
  // separators cannot become traversal after a browser or host decodes them.
  let decoded = localPath;
  for (let depth = 0; depth < 8; depth += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new Error(`Malformed public asset path encoding: ${relativePath}`);
    }
    if (next === decoded) break;
    decoded = next;
    if (depth === 7) {
      throw new Error(`Excessively encoded public asset path: ${relativePath}`);
    }
  }
  if (
    decoded.startsWith('/') ||
    decoded.includes('\\') ||
    /[\u0000-\u001f\u007f?#]/.test(decoded) ||
    decoded.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Unsafe project-local public asset path: ${relativePath}`);
  }
  return `${import.meta.env.BASE_URL}${localPath}`;
}
