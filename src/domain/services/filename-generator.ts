export class FileNameGenerator {
  static generate(author: string, title: string): string {
    const sanitized = `${this.sanitize(author)} - ${this.sanitize(title)}.epub`;
    return this.truncate(sanitized, 200);
  }

  static isLegacyUuidFileName(fileName: string): boolean {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.epub$/i;
    return uuidPattern.test(fileName);
  }

  static disambiguate(baseName: string, existingNames: Set<string>): string {
    if (!existingNames.has(baseName)) return baseName;

    const ext = '.epub';
    const nameWithoutExt = baseName.replace(/\.epub$/i, '');
    let counter = 2;
    let candidate = `${nameWithoutExt} (${counter})${ext}`;
    while (existingNames.has(candidate)) {
      counter++;
      candidate = `${nameWithoutExt} (${counter})${ext}`;
    }
    return candidate;
  }

  private static sanitize(input: string): string {
    return input
      .replace(/[/\\]/g, '-')
      .replace(/[<>:"|?*]/g, '_')
      .replace(/\.\./g, '.')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private static truncate(fileName: string, maxLength: number): string {
    if (fileName.length <= maxLength) return fileName;
    const ext = '.epub';
    return fileName.slice(0, maxLength - ext.length) + ext;
  }
}
