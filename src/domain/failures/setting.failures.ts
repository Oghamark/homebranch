import { Failure } from 'src/core/result';

export class SettingNotFoundFailure extends Failure {
  constructor() {
    super('NOT_FOUND', 'Setting not found');
  }
}
