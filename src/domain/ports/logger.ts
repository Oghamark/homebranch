export interface IDomainLogger {
  warn(message: string): void;
  log(message: string): void;
}
