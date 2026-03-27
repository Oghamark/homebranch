export interface IFileService {
  writeFile(filePath: string, data: Buffer): Promise<void>;
  deleteFile(filePath: string): Promise<void>;
  moveFile(sourcePath: string, destinationPath: string): Promise<void>;
  fileExists(filePath: string): boolean;
}
