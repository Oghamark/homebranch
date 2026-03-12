import { IsUUID, IsOptional } from 'class-validator';

export class AssignBookOwnerRequest {
  @IsUUID()
  id: string;

  @IsUUID()
  @IsOptional()
  ownerId: string | null;

  requestingUserRole: string;
}
