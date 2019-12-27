import { Action, createSelector, State, StateContext } from '@ngxs/store';
import { EventWorkflowNodeJobRunPayload } from 'app/model/event.model';
import { WorkflowRunService } from 'app/service/workflow/run/workflow.run.service';
import { GetQueue, UpdateQueue } from 'app/store/queue.action';
import { cloneDeep } from 'lodash-es';
import { tap } from 'rxjs/operators';


export class QueueStateModel {
    queue: Array<EventWorkflowNodeJobRunPayload>;
    loading: boolean;
}

export function getInitialQueueState(): QueueStateModel {
    return {
        queue: new Array<EventWorkflowNodeJobRunPayload>(),
        loading: false
    };
}

@State<QueueStateModel>({
    name: 'queue',
    defaults: getInitialQueueState()
})
export class QueueState {

    static getCurrent() {
        return createSelector(
            [QueueState],
            (state: QueueStateModel): QueueStateModel => state
        );
    }

    constructor(private _workflowRunService: WorkflowRunService) {
    }

    @Action(GetQueue)
    get(ctx: StateContext<QueueStateModel>, action: GetQueue) {
        const state = ctx.getState();
        ctx.setState({
            ...state,
            queue: new Array<EventWorkflowNodeJobRunPayload>(),
            loading: true
        });
        return this._workflowRunService.queue(action.payload.status).pipe(tap( (jobs) => {
            ctx.setState({
                ...state,
                queue: jobs,
                loading: false
            });
        }));
    }

    @Action(UpdateQueue)
    update(ctx: StateContext<QueueStateModel>, action: UpdateQueue) {
        const state = ctx.getState();
        let currentQueue = cloneDeep(state.queue);

        let jobIndex = currentQueue.findIndex(j => j.ID === action.payload.job.ID);
        if (jobIndex !== -1) {
            if (action.payload.job.Status === 'Waiting' || action.payload.job.Status === 'Building') {
                currentQueue[jobIndex] = action.payload.job
            } else {
                currentQueue.splice(jobIndex, 1);
            }
        } else {
            if (action.payload.job.Status === 'Waiting' || action.payload.job.Status === 'Building') {
                currentQueue.push(action.payload.job);
            }
        }
        ctx.setState({
            ...state,
            queue: currentQueue,
        });
    }
}
