export function isImageFilePath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase();
  return ext ? ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'].includes(ext) : false;
}
