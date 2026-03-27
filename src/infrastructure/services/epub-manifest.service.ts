import { Injectable, Logger } from '@nestjs/common';
import * as AdmZip from 'adm-zip';
import { basename, join } from 'path';
import { Book } from 'src/domain/entities/book.entity';
import { IPublicationManifestService } from 'src/application/interfaces/publication-manifest-service';

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

interface SpineItem {
  idref: string;
}

interface TocEntry {
  href: string;
  title: string;
  children?: TocEntry[];
}

@Injectable()
export class EpubManifestService implements IPublicationManifestService {
  private readonly logger = new Logger(EpubManifestService.name);

  generateManifest(book: Book, baseUrl: string): object {
    const uploadsDirectory = process.env.UPLOADS_DIRECTORY || './uploads';
    const epubPath = join(uploadsDirectory, 'books', basename(book.fileName));
    const zip = new AdmZip(epubPath);

    const containerXml = zip.readAsText('META-INF/container.xml');
    const opfRelPath = this.extractOpfPath(containerXml);
    const opfDir = opfRelPath.includes('/')
      ? opfRelPath.substring(0, opfRelPath.lastIndexOf('/') + 1)
      : '';
    const opfXml = zip.readAsText(opfRelPath);

    const manifestItems = this.parseManifest(opfXml);
    const spineItems = this.parseSpine(opfXml);
    const itemById = new Map(manifestItems.map((i) => [i.id, i]));

    const contentBase = `${baseUrl}/books/${book.id}/content`;
    // Encode each path segment individually to preserve slashes
    const makeUrl = (zipPath: string) =>
      `${contentBase}/${zipPath.split('/').map(encodeURIComponent).join('/')}`;
    const resolveHref = (relHref: string) => opfDir + relHref;

    const readingOrder = spineItems
      .map((s) => itemById.get(s.idref))
      .filter((item): item is ManifestItem => !!item)
      .map((item) => ({
        href: makeUrl(resolveHref(item.href)),
        type: this.normalizeMediaType(item.href, item.mediaType),
      }));

    const spineSet = new Set(spineItems.map((s) => s.idref));
    const resources = manifestItems
      .filter((item) => !spineSet.has(item.id))
      .map((item) => ({
        href: makeUrl(resolveHref(item.href)),
        type: this.normalizeMediaType(item.href, item.mediaType),
        ...(item.properties?.includes('nav') && { rel: ['contents'] }),
      }));

    let toc: TocEntry[] = [];
    const navItemId = this.extractNavItemId(opfXml);
    const tocNcxId = this.extractTocNcxId(opfXml);

    if (navItemId) {
      const navItem = itemById.get(navItemId);
      if (navItem) {
        try {
          const navPath = resolveHref(navItem.href);
          const navXml = zip.readAsText(navPath);
          const navDir = navPath.includes('/')
            ? navPath.substring(0, navPath.lastIndexOf('/') + 1)
            : '';
          toc = this.parseNavToc(navXml, makeUrl, navDir);
        } catch (e) {
          this.logger.warn(`Failed to parse EPUB3 nav TOC: ${e}`);
        }
      }
    } else if (tocNcxId) {
      const ncxItem = itemById.get(tocNcxId);
      if (ncxItem) {
        try {
          const ncxPath = resolveHref(ncxItem.href);
          const ncxXml = zip.readAsText(ncxPath);
          const ncxDir = ncxPath.includes('/')
            ? ncxPath.substring(0, ncxPath.lastIndexOf('/') + 1)
            : '';
          toc = this.parseNcxToc(ncxXml, makeUrl, ncxDir);
        } catch (e) {
          this.logger.warn(`Failed to parse EPUB2 NCX TOC: ${e}`);
        }
      }
    }

    const lang = this.extractDcValue(opfXml, 'language') || 'en';
    const readingProgression = this.extractReadingProgression(opfXml);

    return {
      '@context': 'https://readium.org/webpub-manifest/context.jsonld',
      metadata: {
        '@type': 'http://schema.org/Book',
        title: book.title,
        author: { name: book.author },
        language: lang,
        readingProgression,
        ...(book.publishedYear && { published: String(book.publishedYear) }),
        ...(book.publisher && { publisher: { name: book.publisher } }),
      },
      links: [
        {
          rel: 'self',
          href: `${baseUrl}/books/${book.id}/manifest`,
          type: 'application/webpub+json',
        },
      ],
      readingOrder,
      resources,
      toc,
    };
  }

  private extractOpfPath(containerXml: string): string {
    const match = /full-path="([^"]+\.opf)"/i.exec(containerXml);
    if (!match) throw new Error('Cannot locate OPF path in META-INF/container.xml');
    return match[1];
  }

  private parseManifest(opfXml: string): ManifestItem[] {
    const items: ManifestItem[] = [];
    const section = opfXml.match(/<manifest[^>]*>([\s\S]*?)<\/manifest>/i)?.[1] ?? '';
    const re = /<item\s([^>]+?)\s*\/?>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(section)) !== null) {
      const attrs = m[1];
      const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
      const href = /\bhref="([^"]+)"/.exec(attrs)?.[1];
      const mediaType = /\bmedia-type="([^"]+)"/.exec(attrs)?.[1];
      const properties = /\bproperties="([^"]+)"/.exec(attrs)?.[1];
      if (id && href && mediaType) {
        items.push({ id, href: decodeURIComponent(href), mediaType, properties });
      }
    }
    return items;
  }

  private parseSpine(opfXml: string): SpineItem[] {
    const items: SpineItem[] = [];
    const section = opfXml.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i)?.[1] ?? '';
    const re = /<itemref\s([^>]+?)\s*\/?>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(section)) !== null) {
      const idref = /\bidref="([^"]+)"/.exec(m[1])?.[1];
      if (idref) items.push({ idref });
    }
    return items;
  }

  private extractTocNcxId(opfXml: string): string | undefined {
    const spineTag = opfXml.match(/<spine[^>]*>/i)?.[0] ?? '';
    return /\btoc="([^"]+)"/.exec(spineTag)?.[1];
  }

  private extractNavItemId(opfXml: string): string | undefined {
    const section = opfXml.match(/<manifest[^>]*>([\s\S]*?)<\/manifest>/i)?.[1] ?? '';
    const re = /<item\s([^>]+?)\s*\/?>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(section)) !== null) {
      const attrs = m[1];
      if (/\bproperties="[^"]*\bnav\b[^"]*"/.test(attrs)) {
        return /\bid="([^"]+)"/.exec(attrs)?.[1];
      }
    }
    return undefined;
  }

  private extractDcValue(opfXml: string, element: string): string | undefined {
    return new RegExp(`<dc:${element}[^>]*>([^<]+)<\/dc:${element}>`, 'i').exec(opfXml)?.[1]?.trim();
  }

  private extractReadingProgression(opfXml: string): string {
    const spineTag = opfXml.match(/<spine[^>]*>/i)?.[0] ?? '';
    return /\bpage-progression-direction="rtl"/.test(spineTag) ? 'rtl' : 'ltr';
  }

  /**
   * Files with a `.html` extension must be served as `text/html` even when
   * the OPF manifest declares them as `application/xhtml+xml`.  Strict XML
   * parsing (used for xhtml+xml) fails on common HTML idioms such as bare `&`
   * characters, whereas the lenient HTML parser handles them correctly.
   */
  private normalizeMediaType(href: string, mediaType: string): string {
    if (mediaType === 'application/xhtml+xml' && href.toLowerCase().endsWith('.html')) {
      return 'text/html';
    }
    return mediaType;
  }

  private parseNavToc(navXml: string, makeUrl: (p: string) => string, navDir: string): TocEntry[] {
    const tocNavMatch = navXml.match(
      /<nav[^>]+(?:epub:type|type)="toc"[^>]*>([\s\S]*?)<\/nav>/i,
    );
    if (!tocNavMatch) return [];
    return this.parseOlItems(tocNavMatch[1], makeUrl, navDir);
  }

  private parseOlItems(html: string, makeUrl: (p: string) => string, baseDir: string): TocEntry[] {
    const items: TocEntry[] = [];
    // Extract top-level <ol> content
    const olContent = html.match(/<ol[^>]*>([\s\S]*)<\/ol>/i)?.[1] ?? '';
    // Match <li> elements (non-greedy, but we need to handle nesting)
    // Use a simple depth-aware extraction
    const liMatches = this.extractTopLevelLi(olContent);
    for (const liContent of liMatches) {
      const anchor = /<a[^>]+href="([^"#]+(?:#[^"]*)?)"[^>]*>([\s\S]*?)<\/a>/i.exec(liContent);
      if (!anchor) continue;
      const rawHref = anchor[1];
      const title = anchor[2].replace(/<[^>]+>/g, '').trim();
      // Resolve href relative to nav file's directory
      const resolvedHref = rawHref.startsWith('http') ? rawHref : makeUrl(baseDir + rawHref);
      const children = liContent.includes('<ol') ? this.parseOlItems(liContent, makeUrl, baseDir) : undefined;
      items.push({ href: resolvedHref, title, ...(children?.length && { children }) });
    }
    return items;
  }

  private extractTopLevelLi(html: string): string[] {
    const results: string[] = [];
    let depth = 0;
    let start = -1;
    let i = 0;
    while (i < html.length) {
      if (html.slice(i).match(/^<li[\s>]/i)) {
        if (depth === 0) start = i;
        depth++;
      } else if (html.slice(i).match(/^<\/li>/i)) {
        depth--;
        if (depth === 0 && start !== -1) {
          results.push(html.slice(start, i + 5));
          start = -1;
        }
      }
      i++;
    }
    return results;
  }

  private parseNcxToc(ncxXml: string, makeUrl: (p: string) => string, ncxDir: string): TocEntry[] {
    const navMapMatch = ncxXml.match(/<navMap[^>]*>([\s\S]*?)<\/navMap>/i);
    if (!navMapMatch) return [];
    return this.parseNavPoints(navMapMatch[1], makeUrl, ncxDir);
  }

  private parseNavPoints(
    xml: string,
    makeUrl: (p: string) => string,
    baseDir: string,
  ): TocEntry[] {
    const items: TocEntry[] = [];
    const re = /<navPoint\b[^>]*>([\s\S]*?)<\/navPoint>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const content = m[1];
      const title = /<text[^>]*>([\s\S]*?)<\/text>/i.exec(content)?.[1]?.trim() ?? '';
      const src = /<content[^>]+src="([^"]+)"/.exec(content)?.[1];
      if (!src) continue;
      const href = makeUrl(baseDir + src);
      // Avoid double-recursing the full string by removing the outer navPoint match
      const innerXml = content.replace(/<navPoint\b[\s\S]*?<\/navPoint>/g, '');
      const children = this.parseNavPoints(innerXml, makeUrl, baseDir);
      items.push({ href, title, ...(children.length && { children }) });
    }
    return items;
  }
}
