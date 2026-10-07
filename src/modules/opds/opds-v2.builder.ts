import { Injectable } from '@nestjs/common';
import { Book } from 'src/modules/book/book.model';
import { BookShelfEntity } from 'src/modules/book-shelf/book-shelf.entity';
import { PaginationResult } from 'src/common/core/pagination_result';
import { OPDS_LINK_REL, OPDS_MEDIA_TYPE } from 'src/modules/opds/opds-link.helper';

interface OpdsLink {
  rel: string;
  href: string;
  type: string;
  title?: string;
}

interface OpdsV2Feed {
  metadata: Record<string, unknown>;
  links: OpdsLink[];
  navigation?: Array<{ title: string; href: string; type: string; rel: string }>;
  publications?: Array<Record<string, unknown>>;
}

@Injectable()
export class OpdsV2Builder {
  private externalUrl(baseUrl: string, path: string): string {
    return baseUrl ? `${baseUrl}${path}` : path;
  }

  private baseLinks(selfHref: string, baseUrl: string): OpdsLink[] {
    return [
      { rel: OPDS_LINK_REL.SELF, href: selfHref, type: OPDS_MEDIA_TYPE.OPDS_JSON },
      {
        rel: OPDS_LINK_REL.START,
        href: this.externalUrl(baseUrl, '/opds/v2/catalog'),
        type: OPDS_MEDIA_TYPE.OPDS_JSON,
      },
      {
        rel: OPDS_LINK_REL.SEARCH,
        href: this.externalUrl(baseUrl, '/opds/v2/search{?q}'),
        type: OPDS_MEDIA_TYPE.OPDS_JSON,
        title: 'Search',
      },
    ];
  }

  private paginationLinks(basePath: string, result: PaginationResult<unknown[]>): OpdsLink[] {
    const links: OpdsLink[] = [];
    const lim = result.limit ?? 20;
    const off = result.offset ?? 0;
    if (off > 0) {
      const prevOffset = Math.max(0, off - lim);
      links.push({
        rel: OPDS_LINK_REL.PREVIOUS,
        href: `${basePath}?limit=${lim}&offset=${prevOffset}`,
        type: OPDS_MEDIA_TYPE.OPDS_JSON,
      });
    }
    if (result.total !== undefined && result.total > off + lim) {
      links.push({
        rel: OPDS_LINK_REL.NEXT,
        href: `${basePath}?limit=${lim}&offset=${off + lim}`,
        type: OPDS_MEDIA_TYPE.OPDS_JSON,
      });
    }
    return links;
  }

  private bookPublication(book: Book, baseUrl: string): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      '@type': 'http://schema.org/Book',
      title: book.title,
      author: [{ name: book.author }],
    };
    if (book.language) metadata.language = book.language;
    if (book.publisher) metadata.publisher = book.publisher;
    if (book.publishedYear) metadata.published = String(book.publishedYear);
    if (book.isbn) metadata.identifier = `urn:isbn:${book.isbn}`;
    if (book.summary) metadata.description = book.summary;
    if (book.pageCount) metadata.numberOfPages = book.pageCount;
    if (book.genres?.length) metadata.subject = book.genres.filter(Boolean);

    const links: OpdsLink[] = [
      {
        rel: OPDS_LINK_REL.ACQUISITION,
        href: this.externalUrl(baseUrl, `/opds/v1/download/${book.id}`),
        type: OPDS_MEDIA_TYPE.EPUB,
      },
    ];

    const images: Array<{ href: string; type: string }> = [];
    if (book.coverImageFileName) {
      images.push({
        href: this.externalUrl(baseUrl, `/uploads/cover-images/${book.coverImageFileName}`),
        type: OPDS_MEDIA_TYPE.JPEG,
      });
    }

    return { metadata, links, images };
  }

  buildCatalogFeed(baseUrl = ''): string {
    const feed: OpdsV2Feed = {
      metadata: { title: 'Homebranch Catalog' },
      links: this.baseLinks(this.externalUrl(baseUrl, '/opds/v2/catalog'), baseUrl),
      navigation: [
        {
          title: 'All Books',
          href: this.externalUrl(baseUrl, '/opds/v2/books'),
          type: OPDS_MEDIA_TYPE.OPDS_JSON,
          rel: OPDS_LINK_REL.SUBSECTION,
        },
        {
          title: 'New Arrivals',
          href: this.externalUrl(baseUrl, '/opds/v2/books/new'),
          type: OPDS_MEDIA_TYPE.OPDS_JSON,
          rel: OPDS_LINK_REL.SUBSECTION,
        },
        {
          title: 'Bookshelves',
          href: this.externalUrl(baseUrl, '/opds/v2/bookshelves'),
          type: OPDS_MEDIA_TYPE.OPDS_JSON,
          rel: OPDS_LINK_REL.SUBSECTION,
        },
      ],
    };
    return JSON.stringify(feed);
  }

  buildAllBooksFeed(result: PaginationResult<Book[]>, baseUrl = ''): string {
    const path = this.externalUrl(baseUrl, '/opds/v2/books');
    const feed: OpdsV2Feed = {
      metadata: {
        title: 'All Books',
        numberOfItems: result.total,
        itemsPerPage: result.limit ?? 20,
      },
      links: [...this.baseLinks(path, baseUrl), ...this.paginationLinks(path, result)],
      publications: result.data.map((b) => this.bookPublication(b, baseUrl)),
    };
    return JSON.stringify(feed);
  }

  buildNewArrivalsFeed(result: PaginationResult<Book[]>, baseUrl = ''): string {
    const path = this.externalUrl(baseUrl, '/opds/v2/books/new');
    const feed: OpdsV2Feed = {
      metadata: {
        title: 'New Arrivals',
        numberOfItems: result.total,
        itemsPerPage: result.limit ?? 20,
      },
      links: [...this.baseLinks(path, baseUrl), ...this.paginationLinks(path, result)],
      publications: result.data.map((b) => this.bookPublication(b, baseUrl)),
    };
    return JSON.stringify(feed);
  }

  buildBookShelvesFeed(result: PaginationResult<BookShelfEntity[]>, baseUrl = ''): string {
    const path = this.externalUrl(baseUrl, '/opds/v2/bookshelves');
    const feed: OpdsV2Feed = {
      metadata: {
        title: 'Bookshelves',
        numberOfItems: result.total,
        itemsPerPage: result.limit ?? 20,
      },
      links: [...this.baseLinks(path, baseUrl), ...this.paginationLinks(path, result)],
      navigation: result.data.map((shelf) => ({
        title: shelf.title,
        href: this.externalUrl(baseUrl, `/opds/v2/bookshelves/${shelf.id}`),
        type: OPDS_MEDIA_TYPE.OPDS_JSON,
        rel: OPDS_LINK_REL.SUBSECTION,
      })),
    };
    return JSON.stringify(feed);
  }

  buildBookShelfFeed(shelf: BookShelfEntity, result: PaginationResult<Book[]>, baseUrl = ''): string {
    const path = this.externalUrl(baseUrl, `/opds/v2/bookshelves/${shelf.id}`);
    const feed: OpdsV2Feed = {
      metadata: {
        title: shelf.title,
        numberOfItems: result.total,
        itemsPerPage: result.limit ?? 20,
      },
      links: [...this.baseLinks(path, baseUrl), ...this.paginationLinks(path, result)],
      publications: result.data.map((b) => this.bookPublication(b, baseUrl)),
    };
    return JSON.stringify(feed);
  }

  buildSearchFeed(result: PaginationResult<Book[]>, query: string, baseUrl = ''): string {
    const searchHref = this.externalUrl(baseUrl, `/opds/v2/search?q=${encodeURIComponent(query)}`);
    const feed: OpdsV2Feed = {
      metadata: {
        title: `Search: ${query}`,
        numberOfItems: result.total,
        itemsPerPage: result.limit ?? 20,
      },
      links: [...this.baseLinks(searchHref, baseUrl), ...this.paginationLinks(searchHref, result)],
      publications: result.data.map((b) => this.bookPublication(b, baseUrl)),
    };
    return JSON.stringify(feed);
  }
}
