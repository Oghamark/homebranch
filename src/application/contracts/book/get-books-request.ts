import { PaginatedQuery } from 'src/core/paginated-query';

export class GetBooksRequest extends PaginatedQuery {
  userId?: string;
  viewerUserId?: string;
  isbn?: string;
  genre?: string;
  series?: string;
  author?: string;
}
