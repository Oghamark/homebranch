import { OpdsV1Builder } from 'src/modules/opds/opds-v1.builder';
import { OpdsV2Builder } from 'src/modules/opds/opds-v2.builder';

describe('OPDS builders', () => {
  const baseUrl = 'https://catalog.example/api';

  test('includes the external base URL in v1 catalog links', () => {
    const catalog = new OpdsV1Builder().buildCatalogFeed(baseUrl);

    expect(catalog).toContain('href="https://catalog.example/api/opds/v1/catalog"');
    expect(catalog).toContain('href="https://catalog.example/api/opds/v1/opensearch.xml"');
    expect(catalog).toContain('href="https://catalog.example/api/opds/v1/books"');
    expect(catalog).toContain('href="https://catalog.example/api/opds/v1/books/new"');
    expect(catalog).toContain('href="https://catalog.example/api/opds/v1/bookshelves"');
  });

  test('includes the external base URL in v2 catalog links', () => {
    const catalog = JSON.parse(new OpdsV2Builder().buildCatalogFeed(baseUrl)) as {
      links: Array<{ href: string }>;
      navigation: Array<{ href: string }>;
    };

    expect(catalog.links.map((link) => link.href)).toEqual([
      'https://catalog.example/api/opds/v2/catalog',
      'https://catalog.example/api/opds/v2/catalog',
      'https://catalog.example/api/opds/v2/search{?q}',
    ]);
    expect(catalog.navigation.map((link) => link.href)).toEqual([
      'https://catalog.example/api/opds/v2/books',
      'https://catalog.example/api/opds/v2/books/new',
      'https://catalog.example/api/opds/v2/bookshelves',
    ]);
  });
});
