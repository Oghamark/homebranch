import { IsUUID } from 'class-validator';

export class DeleteBookRequest {
  @IsUUID()
  id: string;

  requestingUserId: string;
  requestingUserRole: string;
}
