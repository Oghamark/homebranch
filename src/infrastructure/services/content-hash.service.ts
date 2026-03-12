import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { IContentHashService } from 'src/application/interfaces/content-hash-service';

@Injectable()
export class ContentHashService implements IContentHashService {
  async computeHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath);
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
}
