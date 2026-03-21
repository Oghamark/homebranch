import { Book } from 'src/domain/entities/book.entity';

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Determines whether two books should be considered metadata-identical.
 * Uses ISBN comparison when both books have an ISBN; otherwise falls back
 * to a normalized title + author comparison.
 */
export function metadataMatches(a: Book, b: { title: string; author: string; isbn?: string }): boolean {
  if (a.isbn && b.isbn) {
    return normalize(a.isbn) === normalize(b.isbn);
  }
  return normalize(a.title) === normalize(b.title) && normalize(a.author) === normalize(b.author);
}
