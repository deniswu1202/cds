import { ChangeDetectionStrategy, Component, Input, ViewChild } from '@angular/core';
import { Store } from '@ngxs/store';
import { ModalTemplate, SuiActiveModal, SuiModalService, TemplateModalConfig } from '@richardlt/ng2-semantic-ui';
import { EventService } from 'app/event.service';
import { Operation } from 'app/model/operation.model';
import { Project } from 'app/model/project.model';
import { Workflow } from 'app/model/workflow.model';
import { AutoUnsubscribe } from 'app/shared/decorator/autoUnsubscribe';
import { WorkflowState, WorkflowStateModel } from 'app/store/workflow.state';
import { Subscription } from 'rxjs';

@Component({
    selector: 'app-workflow-save-as-code-modal',
    templateUrl: './save.as.code.html',
    styleUrls: ['./save.as.code.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
@AutoUnsubscribe()
export class WorkflowSaveAsCodeComponent {

    @Input() project: Project;
    @Input() workflow: Workflow;
    ope: Operation;

    @ViewChild('saveAsCodeModal', { static: false })
    public saveAsCodeModal: ModalTemplate<boolean, boolean, void>;
    modalConfig: TemplateModalConfig<boolean, boolean, void>;
    modal: SuiActiveModal<boolean, boolean, void>;

    stateSub: Subscription;

    constructor(
        private _modalService: SuiModalService,
        private _eventService: EventService,
        private _store: Store
    ) { }

    show(ope: Operation): void {
        if (this.saveAsCodeModal) {
            this.ope = ope;
            this.modalConfig = new TemplateModalConfig<boolean, boolean, void>(this.saveAsCodeModal);
            this.modalConfig.mustScroll = true;
            this.modal = this._modalService.open(this.modalConfig);
            this._eventService.addOperationFilter(this.ope.uuid);
            this.stateSub = this._store.select(WorkflowState.getCurrent()).subscribe((s: WorkflowStateModel) => {
                if (s.operation && s.operation.uuid === this.ope.uuid) {
                    this.ope = s.operation;
                }
            });
        }
    }

}
