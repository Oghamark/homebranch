import { Observable } from 'rxjs';

export interface ILibraryEventsService {
  getStream(): Observable<MessageEvent>;
}
