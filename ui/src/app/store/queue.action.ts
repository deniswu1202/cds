import { EventWorkflowNodeJobRunPayload } from 'app/model/event.model';


export class GetQueue {
    static readonly type = '[Queue] Get Job Queue';
    constructor(public payload: { status: Array<string> }) { }
}

export class UpdateQueue {
    static readonly type = '[Queue] Update Queue';
    constructor(public payload: { job: EventWorkflowNodeJobRunPayload }) { }
}
