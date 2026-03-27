export interface IDuplicateScanQueue {
  enqueueScan(): Promise<void>;
}
