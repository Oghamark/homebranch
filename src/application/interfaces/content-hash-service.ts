export interface IContentHashService {
  computeHash(filePath: string): Promise<string>;
}
