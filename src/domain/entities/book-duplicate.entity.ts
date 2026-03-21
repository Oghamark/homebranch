export type DuplicateResolution = 'merge' | 'keep_both' | 'replace';

export class BookDuplicate {
  constructor(
    public id: string,
    public suspectBookId: string,
    public originalBookId: string,
    public detectedAt: Date,
    public resolvedAt?: Date,
    public resolution?: DuplicateResolution,
    public resolvedByUserId?: string,
  ) {}
}
