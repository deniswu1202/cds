import { registerLocaleData } from '@angular/common';
import localeEN from '@angular/common/locales/en';
import localeFR from '@angular/common/locales/fr';
import { Component, ElementRef, NgZone, OnInit, ViewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, NavigationEnd, NavigationStart, ResolveEnd, ResolveStart, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { EventService } from 'app/event.service';
import { WebSocketMessage } from 'app/model/websocket.model';
import { GetCDSStatus } from 'app/store/cds.action';
import { CDSState } from 'app/store/cds.state';
import { Observable } from 'rxjs';
import { filter, map, mergeMap } from 'rxjs/operators';
import { Subscription } from 'rxjs/Subscription';
import * as format from 'string-format-obj';
import { AuthentifiedUser } from './model/user.model';
import { LanguageStore } from './service/language/language.store';
import { NotificationService } from './service/notification/notification.service';
import { ThemeStore } from './service/theme/theme.store';
import { AutoUnsubscribe } from './shared/decorator/autoUnsubscribe';
import { ToastService } from './shared/toast/ToastService';
import { CDSWebWorker } from './shared/worker/web.worker';
import { CDSWorker } from './shared/worker/worker';
import { AuthenticationState } from './store/authentication.state';

declare var PACMAN: any;

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss']
})
@AutoUnsubscribe()
export class AppComponent implements OnInit {
    open: boolean;
    isConnected: boolean;
    hideNavBar: boolean;
    versionWorker: CDSWebWorker;
    zone: NgZone;
    currentVersion = 0;
    showUIUpdatedBanner: boolean;
    languageSubscriber: Subscription;
    themeSubscriber: Subscription;
    versionWorkerSubscription: Subscription;
    _routerSubscription: Subscription;
    _routerNavEndSubscription: Subscription;
    _sseSubscription: Subscription;
    displayResolver: boolean;
    toasterConfig: any;
    eventsRouteSubscription: Subscription;
    maintenance: boolean;
    cdsstateSub: Subscription;
    user: AuthentifiedUser;

    previousURL: string;

    @ViewChild('gamification', {static: false})
    eltGamification: ElementRef;
    gameInit: boolean;

    constructor(
        _translate: TranslateService,
        private _language: LanguageStore,
        private _theme: ThemeStore,
        private _activatedRoute: ActivatedRoute,
        private _titleService: Title,
        private _router: Router,
        private _notification: NotificationService,
        private _toastService: ToastService,
        private _store: Store,
        private _eventService: EventService
    ) {
        this.zone = new NgZone({ enableLongStackTrace: false });
        this.toasterConfig = this._toastService.getConfig();
        _translate.addLangs(['en', 'fr']);
        _translate.setDefaultLang('en');
        let browserLang = navigator.language.match(/fr/) ? 'fr' : 'en';
        _translate.use(browserLang.match(/en|fr/) ? browserLang : 'en');
        registerLocaleData(browserLang.match(/fr/) ? localeFR : localeEN);

        this.languageSubscriber = this._language.get().subscribe(l => {
            if (l) {
                _translate.use(l);
            } else {
                _language.set(browserLang.match(/en|fr/) ? browserLang : 'en');
            }
        });

        this.themeSubscriber = this._theme.get().subscribe(t => {
            if (t) {
                document.body.className = t;
            } else {
                _theme.set('light');
            }
        });

        this._notification.requestPermission();

        this.eventsRouteSubscription = this._router.events.subscribe(e => {
            if (e instanceof NavigationStart) {
                this.hideNavBar = (e.url.indexOf('/auth') !== -1)
            }
        });
    }



    ngOnInit(): void {
        this._store.dispatch(new GetCDSStatus());
        this._store.select(AuthenticationState.user).subscribe(user => {
            if (!user) {
                delete this.user;
                this.isConnected = false;
            } else {
                this.user = user;
                this.isConnected = true;
                this._eventService.startWebsocket();
            }
        });
        this.startVersionWorker();

        this._routerSubscription = this._router.events
            .pipe(filter((event) => event instanceof ResolveStart || event instanceof ResolveEnd))
            .subscribe(e => {
                if (e instanceof ResolveStart) {
                    this.displayResolver = true;
                }
                if (e instanceof ResolveEnd) {
                    this.displayResolver = false;
                }
            });

        this._routerNavEndSubscription = this._router.events
            .pipe(filter((event) => event instanceof NavigationEnd))
            .pipe(map((e: NavigationEnd) => {
                if ((!this.previousURL || this.previousURL.split('?')[0] !== e.url.split('?')[0])) {
                    this.previousURL = e.url;
                    this.manageWebsocketFilterByUrl(e.url);
                    return;
                }

            }))
            .pipe(map(() => this._activatedRoute))
            .pipe(map((route) => {
                let params = {};
                while (route.firstChild) {
                    route = route.firstChild;
                    Object.assign(params, route.snapshot.params, route.snapshot.queryParams);
                }
                this._eventService.updateRoute(params);
                return { route, params: Observable.of(params) };
            }))
            .pipe(filter((event) => event.route.outlet === 'primary'))
            .pipe(mergeMap((event) => Observable.zip(event.route.data, event.params)))
            .subscribe((routeData) => {
                if (!Array.isArray(routeData) || routeData.length < 2) {
                    return;
                }
                if (routeData[0]['title']) {
                    let title = format(routeData[0]['title'], routeData[1]);
                    this._titleService.setTitle(title);
                } else {
                    this._titleService.setTitle('CDS');
                }
            });

        this.cdsstateSub = this._store.select(CDSState.getCurrentState()).subscribe( m => {
            // Switch maintenance ON
            if (!this.maintenance && m.maintenance && !this.gameInit && this.isConnected && !this.user.isAdmin()) {
                setTimeout(() => {
                    this.gameInit = true;
                    PACMAN.init(this.eltGamification.nativeElement, '/assets/js/');
                }, 1000);
            }
            this.maintenance = m.maintenance;
        });
    }

    manageWebsocketFilterByUrl(url: string) {
        let msg =  new WebSocketMessage();
        let urlSplitted = url.substr(1, url.length - 1).split('/');
        switch (urlSplitted[0]) {
            case 'home':
                msg.favorites = true;
                break;
            case 'project':
                switch (urlSplitted.length) {
                    case 1: // project creation
                        break;
                    case 2: // project view
                        msg.project_key = urlSplitted[1].split('?')[0];
                        break;
                    default: // App/pipeline/env/workflow view
                        msg.project_key = urlSplitted[1].split('?')[0];
                        this.manageWebsocketFilterProjectPath(urlSplitted, msg);
                }
                break;
            case 'settings':
                if (urlSplitted.length === 2 && urlSplitted[1] === 'queue') {
                    msg.queue = true;
                }
                break;
        }
        this._eventService.updateFilter(msg);
    }

    manageWebsocketFilterProjectPath(urlSplitted: Array<string>, msg: WebSocketMessage) {
        switch (urlSplitted[2]) {
            case 'pipeline':
                if (urlSplitted.length >= 4) {
                    msg.pipeline_name = urlSplitted[3].split('?')[0];
                }
                break;
            case 'application':
                if (urlSplitted.length >= 4) {
                    msg.application_name = urlSplitted[3].split('?')[0];
                }
                break;
            case 'environment':
                if (urlSplitted.length >= 4) {
                    msg.environment_name = urlSplitted[3].split('?')[0];
                }
                break;
            case 'workflow':
                if (urlSplitted.length >= 4) {
                    msg.workflow_name = urlSplitted[3].split('?')[0];
                }
                if (urlSplitted.length >= 6) {
                    msg.workflow_run_num = Number(urlSplitted[5].split('?')[0]);
                }
                if (urlSplitted.length >= 8) {
                    msg.workflow_node_run_id = Number(urlSplitted[7].split('?')[0]);
                }
                break;
        }
    }

    stopWorker(w: CDSWorker, s: Subscription): void {
        if (w) {
            w.stop();
        }
        if (s) {
            s.unsubscribe();
        }
    }

    startVersionWorker(): void {
        this.stopWorker(this.versionWorker, this.versionWorkerSubscription);
        this.versionWorker = new CDSWebWorker('./assets/worker/web/version.js');
        this.versionWorker.start({});
        this.versionWorker.response().subscribe(msg => {
            if (msg) {
                this.zone.run(() => {
                    let versionJSON = Number(JSON.parse(msg).version);
                    if (this.currentVersion === 0) {
                        this.currentVersion = versionJSON;
                    }
                    if (this.currentVersion < versionJSON) {
                        this.showUIUpdatedBanner = true;
                    }
                });
            }
        });
    }

    refresh(): void {
        this.zone.runOutsideAngular(() => {
            location.reload(true);
        });
    }
}
