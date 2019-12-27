import { ChangeDetectionStrategy, ChangeDetectorRef, Component } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { EventWorkflowNodeJobRunPayload } from 'app/model/event.model';
import { PipelineStatus } from 'app/model/pipeline.model';
import { AuthentifiedUser } from 'app/model/user.model';
import { WorkflowRunService } from 'app/service/workflow/run/workflow.run.service';
import { PathItem } from 'app/shared/breadcrumb/breadcrumb.component';
import { AutoUnsubscribe } from 'app/shared/decorator/autoUnsubscribe';
import { ToastService } from 'app/shared/toast/ToastService';
import { AuthenticationState } from 'app/store/authentication.state';
import { GetQueue } from 'app/store/queue.action';
import { QueueState, QueueStateModel } from 'app/store/queue.state';
import { cloneDeep } from 'lodash-es';
import { Subscription } from 'rxjs';
import { finalize } from 'rxjs/operators';

@Component({
    selector: 'app-queue',
    templateUrl: './queue.component.html',
    styleUrls: ['./queue.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
@AutoUnsubscribe()
export class QueueComponent {
    queueSubscription: Subscription;
    nodeJobRuns: Array<EventWorkflowNodeJobRunPayload> = [];
    filteredNodeJobRuns: Array<EventWorkflowNodeJobRunPayload> = [];
    user: AuthentifiedUser;
    parametersMaps: Array<{}> = [];
    requirementsList: Array<string> = [];
    bookedOrBuildingByList: Array<string> = [];
    loading: boolean;
    statusOptions: Array<string> = [PipelineStatus.WAITING, PipelineStatus.BUILDING];
    status: Array<string>;
    path: Array<PathItem>;

    constructor(
        private _store: Store,
        private _wfRunService: WorkflowRunService,
        private _toast: ToastService,
        private _translate: TranslateService,
        private _cd: ChangeDetectorRef
    ) {
        this.loading = true;
        this.status = [this.statusOptions[0]];
        this.user = this._store.selectSnapshot(AuthenticationState.user);

        this.queueSubscription = this._store.select(QueueState.getCurrent()).subscribe((s: QueueStateModel) => {
            this.nodeJobRuns = cloneDeep(s.queue);
            this.filterJobs();
            this.loading = s.loading;
            if (Array.isArray(this.nodeJobRuns) && this.nodeJobRuns.length > 0) {
                this.requirementsList = [];
                this.bookedOrBuildingByList = [];
                this.parametersMaps = this.nodeJobRuns.map((nj) => {
                    if (this.user.isMaintainer() && nj.Requirements) {
                        let requirements = nj.Requirements
                            .reduce((reqs, req) => `type: ${req.Type}, value: ${req.Value}; ${reqs}`, '');
                        this.requirementsList.push(requirements);
                    }
                    this.bookedOrBuildingByList.push(((): string => {
                        if (nj.Status === PipelineStatus.BUILDING) {
                            return nj.WorkerName;
                        }
                        if (nj.BookByName) {
                            return nj.BookByName;
                        }
                        return '';
                    })());
                    if (!nj.Parameters) {
                        return null;
                    }
                    return nj.Parameters.reduce((params, param) => {
                        params[param.Name] = param.Value;
                        return params;
                    }, {});
                });
            }
            this._cd.markForCheck();
        });

        this.refreshQueue();

        this.path = [<PathItem>{
            translate: 'common_settings'
        }, <PathItem>{
            translate: 'admin_queue_title'
        }];
    }

    filterJobs(): void {
        this.filteredNodeJobRuns = this.nodeJobRuns.filter(njr => this.status.find(s => s === njr.Status));
    }

    refreshQueue(): void {
        this._store.dispatch(new GetQueue({
            status: (this.status.length > 0 ? this.status : this.statusOptions)
        }));
    }

    stopNode(index: number) {
        let parameters = this.parametersMaps[index];
        this.nodeJobRuns[index].updating = true;
        this._wfRunService.stopNodeRun(
            parameters['cds.project'],
            parameters['cds.workflow'],
            parseInt(parameters['cds.run.number'], 10),
            parseInt(parameters['cds.node.id'], 10)
        ).pipe(finalize(() => {
            this.nodeJobRuns[index].updating = false;
            this._cd.markForCheck();
        }))
            .subscribe(() => this._toast.success('', this._translate.instant('pipeline_stop')))
    }
}
