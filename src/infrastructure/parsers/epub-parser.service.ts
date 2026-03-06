import { Injectable, Logger } from '@nestjs/common';
import EPub from 'epub2';
import { IEpubMetadata, IEpubParser } from 'src/application/interfaces/epub-parser';

interface EpubMetadata {
  title?: string;
  creator?: string;
  language?: string;
  publisher?: string;
  date?: string;
  ISBN?: string;
  description?: string;
  subject?: string[];
  cover?: string;
  'belongs-to-collection'?: string;
  'calibre:series'?: string;
  'group-position'?: string | number;
  'calibre:series_index'?: string | number;
  [key: string]: unknown;
}

@Injectable()
export class EpubParserService implements IEpubParser {
  private readonly logger = new Logger(EpubParserService.name);

  async parse(filePath: string): Promise<IEpubMetadata> {
    const epub = await EPub.createAsync(filePath);
    const meta = epub.metadata as unknown as EpubMetadata;
    const result: IEpubMetadata = {};

    if (meta.title) result.title = meta.title.trim();
    if (meta.creator) result.author = meta.creator.trim();
    if (meta.language) result.language = meta.language.trim();
    if (meta.publisher) result.publisher = meta.publisher.trim();

    if (meta.date) {
      const year = parseInt(meta.date.substring(0, 4), 10);
      if (!isNaN(year) && year > 0) result.publishedYear = year;
    }

    if (meta.ISBN) result.isbn = meta.ISBN.trim();

    if (meta.description) {
      result.summary = meta.description.replace(/<[^>]+>/g, '').trim();
    }

    if (meta.subject?.length) {
      result.genres = meta.subject.filter(Boolean).slice(0, 5);
    }

    // EPUB3: belongs-to-collection; fallback to Calibre-style metadata
    const series = meta['belongs-to-collection'] ?? meta['calibre:series'];
    if (series) result.series = String(series).trim();

    // Series position: EPUB3 group-position or Calibre-style index
    const positionRaw = meta['group-position'] ?? meta['calibre:series_index'];
    if (positionRaw != null) {
      const pos = parseFloat(String(positionRaw));
      if (!isNaN(pos)) result.seriesPosition = pos;
    }

    const cover = await this.extractCover(epub);
    if (cover) {
      result.coverImageBuffer = cover.data;
      result.coverImageMimeType = cover.mimeType;
    }

    return result;
  }

  private async extractCover(epub: EPub): Promise<{ data: Buffer; mimeType: string } | null> {
    try {
      // EPUB2: metadata.cover holds the manifest item ID of the cover image
      const meta = epub.metadata as unknown as EpubMetadata;
      const coverId = meta.cover;
      if (coverId && typeof coverId === 'string') {
        const [data, mimeType] = await epub.getImageAsync(coverId);
        if (data) return { data, mimeType: mimeType as string };
      }

      // Fallback: find first manifest item with "cover" in its ID that is an image
      const manifest = epub.manifest as Record<string, { id?: string; 'media-type'?: string }>;
      const coverItem = Object.values(manifest).find(
        (item) => item.id?.toLowerCase().includes('cover') && item['media-type']?.startsWith('image/'),
      );
      if (coverItem?.id) {
        const [data, mimeType] = await epub.getImageAsync(coverItem.id);
        if (data) return { data, mimeType: mimeType as string };
      }
    } catch (err) {
      this.logger.warn(`Could not extract cover image from EPUB: ${String(err)}`);
    }
    return null;
  }
}
