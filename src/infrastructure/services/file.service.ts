import { Injectable } from '@nestjs/common';
import { writeFile, unlink, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { IFileService } from 'src/application/interfaces/file-service';

@Injectable()
export class FileService implements IFileService {
  async writeFile(filePath: string, data: Buffer): Promise<void> {
    await writeFile(filePath, data);
  }

  async deleteFile(filePath: string): Promise<void> {
    await unlink(filePath);
  }

  async moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    await rename(sourcePath, destinationPath);
  }

  fileExists(filePath: string): boolean {
    return existsSync(filePath);
  }
}
