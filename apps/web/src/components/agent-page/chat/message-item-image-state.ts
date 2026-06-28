export interface InlineImageInput {
  mediaType: string;
  data: string;
}

export interface InlineImageItem {
  key: string;
  href: string;
  src: string;
  alt: string;
}

export function createInlineImageItems(images: readonly InlineImageInput[] | null | undefined): InlineImageItem[] {
  if (!images?.length) return [];
  const items: InlineImageItem[] = [];
  for (const image of images) {
    const mediaType = image.mediaType.trim();
    const data = image.data.trim();
    if (!mediaType || !data) continue;
    const url = `data:${mediaType};base64,${data}`;
    items.push({
      key: `${mediaType}:${data.slice(0, 48)}`,
      href: url,
      src: url,
      alt: `图片 ${items.length + 1}`,
    });
  }
  return items;
}
