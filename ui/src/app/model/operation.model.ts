import {VCSStrategy} from './vcs.model';

export class PerformAsCodeResponse {
    workflowName: string;
    msgs: any;

    constructor() {
    }
}
export class Operation {
    date: string;
    uuid: string;
    url: string;
    strategy: VCSStrategy;
    vcs_server: string;
    repo_fullname: string;
    repository_info: OperationRepositoryInfo;
    setup: OperationSetup;
    load_files: OperationLoadFiles;
    status: number;
    error: string;

    static FromWS(payload: {}) {
        let ope = new Operation();
        ope.error = payload['Error'];
        ope.date = payload['Date'];
        ope.load_files = new OperationLoadFiles();
        let olf = payload['LoadFiles'];
        ope.load_files.pattern = olf['Pattern'];
        ope.load_files.results = olf['Results'];
        ope.repo_fullname = payload['RepoFullName'];
        ope.status = payload['Status'];
        ope.uuid = payload['UUID'];
        ope.url = payload['URL'];
        ope.vcs_server = payload['VCSServer'];
        ope.setup = new OperationSetup();
        let os = payload['Setup'];
        ope.setup.push = new OperationPush();
        let push = os['Push'];
        ope.setup.push.from_branch = push['FromBranch'];
        ope.setup.push.message = push['Message'];
        ope.setup.push.pr_link = push['PRLink'];
        ope.setup.push.to_branch = push['ToBranch'];
        return ope;
    }

    constructor() {
        this.strategy = new VCSStrategy();
        this.repository_info = new OperationRepositoryInfo();
    }
}

// response from api
export class OperationRepositoryInfo {
    name: string;
    fetch_url: string;
    default_branch: string;
}

// Response from api
export class OperationLoadFiles {
    pattern: string;
    results: {};
}

// from hook
export class OperationSetup {
    checkout: OperationCheckout;
    push: OperationPush;
}

// from hook
export class OperationCheckout {
    branch: string;
    commit: string;
}

export class OperationPush {
    from_branch: string;
    to_branch: string;
    message: string;
    pr_link: string;
}

