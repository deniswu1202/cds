import {HttpClient, HttpParams} from '@angular/common/http';
import {Injectable} from '@angular/core';
import { EventWorkflowNodeJobRunPayload } from 'app/model/event.model';
import { ParameterEventPayload } from 'app/model/parameter.model';
import {Commit} from 'app/model/repositories.model';
import { RequirementEventPayload } from 'app/model/requirement.model';
import {Workflow} from 'app/model/workflow.model';
import {
    RunNumber,
    WorkflowNodeJobRun,
    WorkflowNodeRun,
    WorkflowRun,
    WorkflowRunRequest
} from 'app/model/workflow.run.model';
import {Observable} from 'rxjs';
import {map} from 'rxjs/operators';

@Injectable()
export class WorkflowRunService {

    constructor(private _http: HttpClient) {
    }

    queue(status: Array<string>): Observable<Array<EventWorkflowNodeJobRunPayload>> {
        let url = '/queue/workflows';
        let params = new HttpParams();
        if (status) {
            status.forEach(s => {
                params = params.append('status', s);
            });
        }
        return this._http.get<Array<WorkflowNodeJobRun>>(url, {params: params}).map(rs => {
            return rs.map(j => {
                let job = new EventWorkflowNodeJobRunPayload();
                job.ID = j.id;
                if (j.bookedby) {
                    job.BookByName = j.bookedby.name;
                }
                job.Done = new Date(j.done).getTime();
                job.Start = new Date(j.start).getTime();
                if (j.job.action.requirements) {
                    job.Requirements = j.job.action.requirements.map(r => {
                        let req = new RequirementEventPayload();
                        req.Name = r.name;
                        req.Opts = r.opts;
                        req.Type = r.type;
                        req.Value = r.value;
                        return req;
                    });
                }
                if (j.parameters) {
                    job.Parameters = j.parameters.map(r => {
                        let p = new ParameterEventPayload();
                        p.Name = r.name;
                        p.Type = r.type;
                        p.Value = r.value;
                        return p;
                    });
                }

                job.Status = j.status;
                job.WorkerName = j.job.worker_name;
                return job;
            });
        });
    }

    /**
     * List workflow runs for the given workflow
     */
    runs(key: string, workflowName: string, limit: string, offset?: string, filters?: {}): Observable<Array<WorkflowRun>> {
        let url = '/project/' + key + '/workflows/' + workflowName + '/runs';
        let params = new HttpParams();
        params = params.append('limit', limit);
        if (offset) {
            params = params.append('offset', offset);
        }
        if (filters) {
            Object.keys(filters).forEach((tag) => params = params.append(tag, filters[tag]));
        }

        return this._http.get<Array<WorkflowRun>>(url, {params: params});
    }

    /**
     * Call API to create a run workflow
     * @param key Project unique key
     * @param workflow Workflow to create
     */
    runWorkflow(key: string, workflowName: string, request: WorkflowRunRequest): Observable<WorkflowRun> {
        return this._http.post<WorkflowRun>('/project/' + key + '/workflows/' + workflowName + '/runs', request);
    }

    /**
     * Call API to get history from node run
     * @param {string} key Project unique key
     * @param {string} workflowName Workflow name
     * @param {number} number Workflow Run number
     * @param {number} nodeID Workflow Run node ID
     * @returns {Observable<Array<WorkflowNodeRun>>}
     */
    nodeRunHistory(key: string, workflowName: string, number: number, nodeID: number): Observable<Array<WorkflowNodeRun>> {
        return this._http.get<Array<WorkflowNodeRun>>(
            '/project/' + key + '/workflows/' + workflowName + '/runs/' + number + '/nodes/' + nodeID + '/history');
    }

    /**
     * Get workflow Run
     * @param {string} key Project unique key
     * @param {string} workflowName Workflow name to get
     * @param {number} number Number of the workflow run
     * @returns {Observable<WorkflowRun>}
     */
    getWorkflowRun(key: string, workflowName: string, number: number): Observable<WorkflowRun> {
        return this._http.get<WorkflowRun>('/project/' + key + '/workflows/' + workflowName + '/runs/' + number).map(wr => {
            return wr;
        });
    }

    /**
     * Get workflow node run
     * @param {string} key Project unique key
     * @param {string} workflowName Workflow name
     * @param {number} number Run number
     * @param nodeRunID Node run Identifier
     * @returns {Observable<WorkflowNodeRun>}
     */
    getWorkflowNodeRun(key: string, workflowName: string, number: number, nodeRunID): Observable<WorkflowNodeRun> {
        return this._http.get<WorkflowNodeRun>('/project/' + key + '/workflows/' + workflowName +
            '/runs/' + number + '/nodes/' + nodeRunID);
    }

    /**
     * Stop a workflow run
     * @param {string} key Project unique key
     * @param {string} workflowName Workflow name
     * @param {number} number Number of the workflow run
     * @returns {Observable<boolean>}
     */
    stopWorkflowRun(key: string, workflowName: string, num: number): Observable<boolean> {
        return this._http.post('/project/' + key + '/workflows/' + workflowName + '/runs/' + num + '/stop', null).pipe(map(() => true));
    }

    /**
     * Stop a workflow node run
     * @param {string} key Project unique key
     * @param {string} workflowName Workflow name
     * @param {number} number Number of the workflow run
     * @param {number} id of the node run to stop
     * @returns {Observable<boolean>}
     */
    stopNodeRun(key: string, workflowName: string, num: number, id: number): Observable<boolean> {
        return this._http.post('/project/' + key + '/workflows/' + workflowName + '/runs/' + num + '/nodes/' + id + '/stop', null).pipe(
            map (() => true));
    }

    /**
     * Get workflow tags
     * @param {string} key Project unique key
     * @param {string} workflowName Workflow name
     * @returns {Observable<{}>}
     */
    getTags(key: string, workflowName: string): Observable<Map<string, Array<string>>> {
        return this._http.get<Map<string, Array<string>>>('/project/' + key + '/workflows/' + workflowName + '/runs/tags');
    }

    /**
     * Resync pipeline inside workflow run
     * @param {string} key Project unique key
     * @param {Workflow} workflow Workflow
     * @param {number} workflowNum Workflow run id to resync
     */
    resync(key: string, workflow: Workflow, workflowNum: number): Observable<WorkflowRun> {
        return this._http.post<WorkflowRun>(
            '/project/' + key + '/workflows/' + workflow.name + '/runs/' + workflowNum + '/resync', null);
    }

    /**
     * Resync workflow run vcs status
     * @param {string} key Project unique key
     * @param {Workflow} workflow Workflow
     * @param {number} workflowNum Workflow run id to resync
     */
    resyncVCSStatus(key: string, workflowName: string, workflowNum: number): Observable<WorkflowRun> {
        return this._http.post<WorkflowRun>(
            '/project/' + key + '/workflows/' + workflowName + '/runs/' + workflowNum + '/vcs/resync', {});
    }

    /**
     * Get commits linked to a workflow run
     * @param {string} key Project unique key
     * @param {string} workflowName Workflow name
     * @param {number} workflowNumber Workflow number
     * @param {number} workflowNodeId Workflow node id
     */
    getCommits(key: string, workflowName: string, workflowNumber: number,
        workflowNodeName: string, branch?: string, hash?: string, remote?: string): Observable<Commit[]> {

        let params = new HttpParams();
        if (branch) {
            params = params.append('branch', branch);
        }
        if (hash) {
          params = params.append('hash', hash);
        }
        if (remote) {
          params = params.append('remote', remote);
        }
        return this._http.get<Commit[]>(
            `/project/${key}/workflows/${workflowName}/runs/${workflowNumber}/${workflowNodeName}/commits`, {params});
    }

    /**
     * Get current run number for the given workflow
     * @param {string} key Project unique key
     * @param {Workflow} workflow Workflow
     * @returns {Observable<number>}
     */
    getRunNumber(key: string, workflow: Workflow): Observable<RunNumber> {
        return this._http.get<RunNumber>('/project/' + key + '/workflows/' + workflow.name + '/runs/num');
    }

    /**
     * Update run number
     * @param {string} key Project unique key
     * @param {Workflow} workflow Workflow to update
     * @param {number} num New run number
     * @returns {Observable<boolean>}
     */
    updateRunNumber(key: string, workflow: Workflow, num: number): Observable<boolean> {
        let r = new RunNumber();
        r.num = num;
        return this._http.post<void>('/project/' + key + '/workflows/' + workflow.name + '/runs/num', r).pipe(map(() => true));
    }
}
