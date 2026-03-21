import { Logger } from '@nestjs/common';
import { SyncableMetadata } from 'src/domain/value-objects/syncable-metadata';

export interface MergeResult {
  merged: SyncableMetadata;
  dbUpdated: boolean;
  fileUpdated: boolean;
  conflicts: string[];
}

const SYNCABLE_FIELDS: (keyof SyncableMetadata)[] = [
  'title',
  'author',
  'language',
  'publisher',
  'publishedYear',
  'isbn',
  'summary',
  'genres',
  'series',
  'seriesPosition',
];

export class MetadataMerger {
  private static readonly logger = new Logger(MetadataMerger.name);

  static merge(
    fileMetadata: SyncableMetadata,
    dbMetadata: SyncableMetadata,
    lastSynced: SyncableMetadata | null,
  ): MergeResult {
    if (!lastSynced) {
      return {
        merged: { ...fileMetadata },
        dbUpdated: true,
        fileUpdated: false,
        conflicts: [],
      };
    }

    const merged: SyncableMetadata = { ...dbMetadata };
    let dbUpdated = false;
    let fileUpdated = false;
    const conflicts: string[] = [];

    for (const field of SYNCABLE_FIELDS) {
      const fileVal = MetadataMerger.normalize(fileMetadata[field]);
      const dbVal = MetadataMerger.normalize(dbMetadata[field]);
      const syncedVal = MetadataMerger.normalize(lastSynced[field]);

      const fileChanged = !MetadataMerger.valuesEqual(fileVal, syncedVal);
      const dbChanged = !MetadataMerger.valuesEqual(dbVal, syncedVal);

      if (fileChanged && !dbChanged) {
        MetadataMerger.setField(merged, field, fileMetadata[field]);
        dbUpdated = true;
      } else if (!fileChanged && dbChanged) {
        MetadataMerger.setField(merged, field, dbMetadata[field]);
        fileUpdated = true;
      } else if (fileChanged && dbChanged) {
        MetadataMerger.setField(merged, field, fileMetadata[field]);
        dbUpdated = true;
        conflicts.push(field);
        this.logger.warn(`Metadata conflict on "${field}": file="${String(fileVal)}" wins over db="${String(dbVal)}"`);
      }
    }

    return { merged, dbUpdated, fileUpdated, conflicts };
  }

  private static setField<K extends keyof SyncableMetadata>(
    target: SyncableMetadata,
    field: K,
    value: SyncableMetadata[K],
  ): void {
    target[field] = value;
  }

  private static normalize(value: SyncableMetadata[keyof SyncableMetadata]): unknown {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value)) return value.length === 0 ? undefined : [...value].sort();
    return value;
  }

  private static valuesEqual(a: unknown, b: unknown): boolean {
    if (a === undefined && b === undefined) return true;
    if (a === undefined || b === undefined) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      return JSON.stringify(a) === JSON.stringify(b);
    }
    return a === b;
  }
}
