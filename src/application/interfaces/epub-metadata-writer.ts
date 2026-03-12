import { SyncableMetadata } from 'src/domain/value-objects/syncable-metadata';

export interface IEpubMetadataWriter {
  writeMetadata(epubPath: string, metadata: SyncableMetadata): Promise<void>;
}
