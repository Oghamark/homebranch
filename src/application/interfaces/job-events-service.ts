import { Observable } from 'rxjs';

export interface IJobEventsService {
  getStream(): Observable<MessageEvent>;
}
