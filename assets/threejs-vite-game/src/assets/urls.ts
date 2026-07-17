/** Resolve files copied from Vite's public directory under any configured base. */
export function publicAssetUrl(relativePath: string): string {
  const localPath = relativePath.replace(/^\/+/, '');
  if (!localPath || /^[a-z][a-z\d+.-]*:/i.test(localPath)) {
    throw new Error(`Expected a project-local public asset path: ${relativePath}`);
  }
  return `${import.meta.env.BASE_URL}${localPath}`;
}
