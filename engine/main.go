package main

import (
	"context"
	"fmt"
	"io/ioutil"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/google/gops/agent"
	"github.com/spf13/cobra"
	_ "github.com/spf13/viper/remote"
	"github.com/yesnault/go-toml"
	"go.opencensus.io/tag"

	"github.com/ovh/cds/engine/api"
	"github.com/ovh/cds/engine/api/observability"
	"github.com/ovh/cds/engine/elasticsearch"
	"github.com/ovh/cds/engine/hatchery/kubernetes"
	"github.com/ovh/cds/engine/hatchery/local"
	"github.com/ovh/cds/engine/hatchery/marathon"
	"github.com/ovh/cds/engine/hatchery/openstack"
	"github.com/ovh/cds/engine/hatchery/swarm"
	"github.com/ovh/cds/engine/hatchery/vsphere"
	"github.com/ovh/cds/engine/hooks"
	"github.com/ovh/cds/engine/migrateservice"
	"github.com/ovh/cds/engine/repositories"
	"github.com/ovh/cds/engine/service"
	"github.com/ovh/cds/engine/ui"
	"github.com/ovh/cds/engine/vcs"
	"github.com/ovh/cds/sdk"
	"github.com/ovh/cds/sdk/doc"
	"github.com/ovh/cds/sdk/log"
	"github.com/ovh/cds/sdk/namesgenerator"
)

var (
	cfgFile      string
	remoteCfg    string
	remoteCfgKey string
	vaultAddr    string
	vaultToken   string
	vaultConfKey = "/secret/cds/conf"
	conf         = &Configuration{}
	output       string
)

func init() {
	startCmd.Flags().StringVar(&cfgFile, "config", "", "config file")
	startCmd.Flags().StringVar(&remoteCfg, "remote-config", "", "(optional) consul configuration store")
	startCmd.Flags().StringVar(&remoteCfgKey, "remote-config-key", "cds/config.api.toml", "(optional) consul configuration store key")
	startCmd.Flags().StringVar(&vaultAddr, "vault-addr", "", "(optional) Vault address to fetch secrets from vault (example: https://vault.mydomain.net:8200)")
	startCmd.Flags().StringVar(&vaultToken, "vault-token", "", "(optional) Vault token to fetch secrets from vault")
	//Version  command
	mainCmd.AddCommand(versionCmd)
	//Update  command
	mainCmd.AddCommand(updateCmd)
	updateCmd.Flags().BoolVar(&updateFromGithub, "from-github", false, "Update binary from latest github release")
	updateCmd.Flags().StringVar(&updateURLAPI, "api", "", "Update binary from a CDS Engine API")

	mainCmd.AddCommand(uptodateCmd)
	uptodateCmd.Flags().BoolVar(&updateFromGithub, "from-github", false, "Update binary from latest github release")
	uptodateCmd.Flags().StringVar(&updateURLAPI, "api", "", "Update binary from a CDS Engine API")

	//Database command
	mainCmd.AddCommand(databaseCmd)
	//Start command
	mainCmd.AddCommand(startCmd)
	//Config command
	mainCmd.AddCommand(configCmd)
	configNewCmd.Flags().BoolVar(&configNewAsEnvFlag, "env", false, "Print configuration as environment variable")

	configCmd.AddCommand(configNewCmd)
	configCmd.AddCommand(configCheckCmd)
	configEditCmd.Flags().StringVar(&output, "output", "", "output file")
	configCmd.AddCommand(configEditCmd)

	//Download command
	mainCmd.AddCommand(downloadCmd)

	// doc command (hidden command)
	mainCmd.AddCommand(docCmd)
}

func main() {
	mainCmd.Execute()
}

var mainCmd = &cobra.Command{
	Use:   "engine",
	Short: "CDS Engine",
	Long: `
CDS

Continuous Delivery Service

Enterprise-Grade Continuous Delivery & DevOps Automation Open Source Platform

https://ovh.github.io/cds/

## Download

You will find lastest release of CDS ` + "`engine`" + ` on [Github Releases](https://github.com/ovh/cds/releases/latest).
`,
}

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Display CDS version",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Println(sdk.VersionString())
	},
}

var docCmd = &cobra.Command{
	Use:    "doc <generation-path> <git-directory>",
	Short:  "generate hugo doc for building http://ovh.github.com/cds",
	Hidden: true,
	Run: func(cmd *cobra.Command, args []string) {
		if len(args) != 2 {
			cmd.Usage()
			os.Exit(1)
		}
		if err := doc.GenerateDocumentation(mainCmd, args[0], args[1]); err != nil {
			sdk.Exit(err.Error())
		}
	},
}

var configCmd = &cobra.Command{
	Use:   "config",
	Short: "Manage CDS Configuration",
}

var configNewAsEnvFlag bool

var configNewCmd = &cobra.Command{
	Use:   "new",
	Short: "CDS configuration file assistant",
	Long: `
Generate the whole configuration file
	$ engine config new > conf.toml

you can compose your file configuration
this will generate a file configuration containing
api and hatchery:local µService
	$ engine config new api hatchery:local

For advanced usage, Debug and Tracing section can be generated as:
	$ engine config new debug tracing [µService(s)...]

All options
	$ engine config new [debug] [tracing] [api] [ui] [hatchery:local] [hatchery:marathon] [hatchery:openstack] [hatchery:swarm] [hatchery:vsphere] [elasticsearch] [hooks] [vcs] [repositories] [migrate]

`,
	Run: func(cmd *cobra.Command, args []string) {
		configBootstrap(args)
		configSetDefaults()

		var sharedInfraToken = sdk.RandomString(128)

		if conf.API != nil {
			conf.API.Auth.SharedInfraToken = sharedInfraToken
			conf.API.Secrets.Key = sdk.RandomString(32)
			conf.API.Providers = append(conf.API.Providers, api.ProviderConfiguration{
				Name:  "sample-provider",
				Token: sdk.RandomString(32),
			})
			conf.API.Services = append(conf.API.Services, api.ServiceConfiguration{
				Name:       "sample-service",
				URL:        "https://ovh.github.io",
				Port:       "443",
				Path:       "/cds",
				HealthPath: "/cds",
				HealthPort: "443",
				HealthURL:  "https://ovh.github.io",
				Type:       "doc",
			})
		} else {
			sharedInfraToken = "enter sharedInfraToken from section [api.auth] here"
		}

		if h := conf.Hatchery; h != nil {
			if h.Local != nil {
				h.Swarm.Name = "local" + namesgenerator.GetRandomNameCDS(10)
				h.Local.API.Token = sharedInfraToken
			}
			if h.Openstack != nil {
				h.Swarm.Name = "openstack" + namesgenerator.GetRandomNameCDS(10)
				h.Openstack.API.Token = sharedInfraToken
			}
			if h.VSphere != nil {
				h.Swarm.Name = "vsphere" + namesgenerator.GetRandomNameCDS(10)
				h.VSphere.API.Token = sharedInfraToken
			}
			if h.Swarm != nil {
				h.Swarm.Name = "swarm_" + namesgenerator.GetRandomNameCDS(10)
				h.Swarm.API.Token = sharedInfraToken
			}
			if h.Marathon != nil {
				h.Swarm.Name = "marathon" + namesgenerator.GetRandomNameCDS(10)
				conf.Hatchery.Marathon.API.Token = sharedInfraToken
			}
		}

		if conf.UI != nil {
			conf.UI.Name = "ui" + namesgenerator.GetRandomNameCDS(10)
			conf.UI.API.Token = sharedInfraToken
		}

		if conf.Hooks != nil {
			conf.Hooks.Name = "hooks" + namesgenerator.GetRandomNameCDS(10)
			conf.Hooks.API.Token = sharedInfraToken
		}

		if conf.Repositories != nil {
			conf.Repositories.Name = "repositories" + namesgenerator.GetRandomNameCDS(10)
			conf.Repositories.API.Token = sharedInfraToken
		}

		if conf.DatabaseMigrate != nil {
			conf.DatabaseMigrate.Name = "dbmigrate" + namesgenerator.GetRandomNameCDS(10)
			conf.DatabaseMigrate.API.Token = sharedInfraToken
		}

		if conf.VCS != nil {
			conf.VCS.Name = "vcs" + namesgenerator.GetRandomNameCDS(10)
			conf.VCS.API.Token = sharedInfraToken
		}

		if !configNewAsEnvFlag {
			btes, err := toml.Marshal(*conf)
			if err != nil {
				sdk.Exit("%v", err)
			}
			fmt.Println(string(btes))
		} else {
			m := asEnvVariables(conf)
			keys := []string{}

			for k := range m {
				keys = append(keys, k)
			}

			sort.Strings(keys)
			for _, k := range keys {
				fmt.Printf("export %s=\"%s\"\n", k, m[k])
			}
		}
	},
}

var configCheckCmd = &cobra.Command{
	Use:   "check",
	Short: "Check CDS configuration file",
	Long:  `$ engine config check <path>`,
	Run: func(cmd *cobra.Command, args []string) {
		if len(args) != 1 {
			cmd.Help()
			sdk.Exit("Wrong usage")
		}

		cfgFile = args[0]
		//Initialize config
		configBootstrap(args)
		config([]string{})

		var hasError bool
		if conf.API != nil && conf.API.URL.API != "" {
			fmt.Printf("checking api configuration...\n")
			if err := api.New().CheckConfiguration(*conf.API); err != nil {
				fmt.Printf("api Configuration: %v\n", err)
				hasError = true
			}
		}

		if conf.DatabaseMigrate != nil && conf.DatabaseMigrate.API.HTTP.URL != "" {
			fmt.Printf("checking migrate configuration...\n")
			if err := api.New().CheckConfiguration(*conf.DatabaseMigrate); err != nil {
				fmt.Printf("migrate Configuration: %v\n", err)
				hasError = true
			}
		}

		if conf.Hatchery != nil && conf.Hatchery.Local != nil && conf.Hatchery.Local.API.HTTP.URL != "" {
			fmt.Printf("checking hatchery:local configuration...\n")
			if err := local.New().CheckConfiguration(*conf.Hatchery.Local); err != nil {
				fmt.Printf("hatchery:local Configuration: %v\n", err)
				hasError = true
			}
		}

		if conf.Hatchery != nil && conf.Hatchery.Marathon != nil && conf.Hatchery.Marathon.API.HTTP.URL != "" {
			fmt.Printf("checking hatchery:marathon configuration...\n")
			if err := marathon.New().CheckConfiguration(*conf.Hatchery.Marathon); err != nil {
				fmt.Printf("hatchery:marathon Configuration: %v\n", err)
				hasError = true
			}
		}

		if conf.Hatchery != nil && conf.Hatchery.Openstack != nil && conf.Hatchery.Openstack.API.HTTP.URL != "" {
			fmt.Printf("checking hatchery:openstack configuration...\n")
			if err := openstack.New().CheckConfiguration(*conf.Hatchery.Openstack); err != nil {
				fmt.Printf("hatchery:openstack Configuration: %v\n", err)
				hasError = true
			}
		}

		if conf.Hatchery != nil && conf.Hatchery.Kubernetes != nil && conf.Hatchery.Kubernetes.API.HTTP.URL != "" {
			fmt.Printf("checking hatchery:kubernetes configuration...\n")
			if err := kubernetes.New().CheckConfiguration(*conf.Hatchery.Kubernetes); err != nil {
				fmt.Printf("hatchery:kubernetes Configuration: %v\n", err)
				hasError = true
			}
		}

		if conf.Hatchery != nil && conf.Hatchery.Swarm != nil && conf.Hatchery.Swarm.API.HTTP.URL != "" {
			fmt.Printf("checking hatchery:swarm configuration...\n")
			if err := swarm.New().CheckConfiguration(*conf.Hatchery.Swarm); err != nil {
				fmt.Printf("hatchery:swarm Configuration: %v\n", err)
				hasError = true
			}
		}

		if conf.Hatchery != nil && conf.Hatchery.VSphere != nil && conf.Hatchery.VSphere.API.HTTP.URL != "" {
			fmt.Printf("checking hatchery:vsphere configuration...\n")
			if err := vsphere.New().CheckConfiguration(*conf.Hatchery.VSphere); err != nil {
				fmt.Printf("hatchery:vsphere Configuration: %v\n", err)
				hasError = true
			}
		}

		if conf.UI != nil && conf.UI.API.HTTP.URL != "" {
			fmt.Printf("checking UI configuration...\n")
			if err := ui.New().CheckConfiguration(*conf.UI); err != nil {
				fmt.Printf("ui Configuration: %v\n", err)
				hasError = true
			}
		}

		if conf.VCS != nil && conf.VCS.API.HTTP.URL != "" {
			fmt.Printf("checking vcs configuration...\n")
			if err := vcs.New().CheckConfiguration(*conf.VCS); err != nil {
				fmt.Printf("vcs Configuration: %v\n", err)
				hasError = true
			}
		}

		if conf.Hooks != nil && conf.Hooks.API.HTTP.URL != "" {
			fmt.Printf("checking hooks configuration...\n")
			if err := hooks.New().CheckConfiguration(*conf.Hooks); err != nil {
				fmt.Printf("hooks Configuration: %v\n", err)
				hasError = true
			}
		}

		if !hasError {
			fmt.Println("Configuration file OK")
		}
	},
}

var configEditCmd = &cobra.Command{
	Use:     "edit",
	Short:   "Edit a CDS configuration file",
	Long:    `$ engine config edit --output <path-toml-file-dst> <path-toml-file-src> key=value key=value`,
	Example: `$ engine config edit --output new.conf conf.toml log.level=debug hatchery.swarm.commonConfiguration.name=hatchery-swarm-name`,
	Run: func(cmd *cobra.Command, args []string) {
		if len(args) < 2 {
			cmd.Help()
			sdk.Exit("Wrong usage")
		}

		cfgFile = args[0]

		if _, err := os.Stat(cfgFile); os.IsNotExist(err) {
			sdk.Exit("File %s doesn't exist", cfgFile)
		}

		btes, err := ioutil.ReadFile(cfgFile)
		if err != nil {
			sdk.Exit("Error while read content of file %s - err:%v", cfgFile, err)
		}

		tomlConf, err := toml.Load(string(btes))
		if err != nil {
			sdk.Exit("Error while load toml content of file %s - err:%v", cfgFile, err)
		}

		for _, vk := range args[1:] {
			t := strings.Split(vk, "=")
			if len(t) != 2 {
				sdk.Exit("Invalid key=value: %v", vk)
			}
			// check if value is bool, int or else string
			if v, err := strconv.ParseBool(t[1]); err == nil {
				tomlConf.Set(t[0], "", false, v)
			} else if v, err := strconv.ParseInt(t[1], 10, 64); err == nil {
				tomlConf.Set(t[0], "", false, v)
			} else {
				tomlConf.Set(t[0], "", false, t[1])
			}
		}

		writer := os.Stdout
		if output != "" {
			if _, err := os.Stat(output); err == nil {
				if err := os.Remove(output); err != nil {
					sdk.Exit("%v", err)
				}
			}
			writer, err = os.Create(output)
			if err != nil {
				sdk.Exit("%v", err)
			}
		}
		defer writer.Close()

		fmt.Fprint(writer, tomlConf.String())
	},
}

var startCmd = &cobra.Command{
	Use:   "start",
	Short: "Start CDS",
	Long: `
Start CDS Engine Services

#### API

This is the core component of CDS.

#### UI

This is the CDS Web UI.

#### Hatcheries

They are the components responsible for spawning workers. Supported integrations/orchestrators are:

* Local machine
* Openstack
* Docker Swarm
* Openstack
* Vsphere

#### Hooks
This component operates CDS workflow hooks

#### Repositories
This component operates CDS workflow repositories

#### VCS
This component operates CDS VCS connectivity

Start all of this with a single command:

	$ engine start [api] [hatchery:local] [hatchery:marathon] [hatchery:openstack] [hatchery:swarm] [hatchery:vsphere] [elasticsearch] [hooks] [vcs] [repositories] [migrate] [ui]

All the services are using the same configuration file format.

You have to specify where the toml configuration is. It can be a local file, provided by consul or vault.

You can also use or override toml file with environment variable.

See $ engine config command for more details.

`,
	Run: func(cmd *cobra.Command, args []string) {
		if len(args) == 0 {
			args = strings.Split(os.Getenv("CDS_SERVICE"), " ")
		}

		if len(args) == 0 {
			cmd.Help()
			return
		}

		//Initialize config
		configBootstrap(args)
		configSetDefaults()
		config(args)

		// gops debug
		if conf.Debug.Enable {
			if conf.Debug.RemoteDebugURL != "" {
				log.Info("Starting gops agent on %s", conf.Debug.RemoteDebugURL)
				if err := agent.Listen(&agent.Options{Addr: conf.Debug.RemoteDebugURL}); err != nil {
					log.Error("Error on starting gops agent: %v", err)
				}
			} else {
				log.Info("Starting gops agent locally")
				if err := agent.Listen(nil); err != nil {
					log.Error("Error on starting gops agent locally: %v", err)
				}
			}
		}

		ctx, cancel := context.WithCancel(context.Background())

		// initialize context
		instance := "cdsinstance"
		if conf.Tracing != nil && conf.Tracing.Name != "" {
			instance = conf.Tracing.Name
		}
		tagCDSInstance, _ := tag.NewKey("cds")
		ctx, _ = tag.New(ctx, tag.Upsert(tagCDSInstance, instance))

		defer cancel()

		// gracefully shutdown all
		c := make(chan os.Signal, 1)
		signal.Notify(c, os.Interrupt, syscall.SIGTERM, syscall.SIGKILL)
		go func() {
			<-c
			signal.Stop(c)
			cancel()
		}()

		type serviceConf struct {
			arg     string
			service service.Service
			cfg     interface{}
		}
		services := []serviceConf{}

		names := []string{}
		for _, a := range args {
			fmt.Printf("Starting service %s\n", a)
			switch a {
			case "api":
				services = append(services, serviceConf{arg: a, service: api.New(), cfg: *conf.API})
				names = append(names, instance)
			case "ui":
				services = append(services, serviceConf{arg: a, service: ui.New(), cfg: *conf.UI})
				names = append(names, instance)
			case "migrate":
				services = append(services, serviceConf{arg: a, service: migrateservice.New(), cfg: *conf.DatabaseMigrate})
				names = append(names, conf.DatabaseMigrate.Name)
			case "hatchery:local":
				services = append(services, serviceConf{arg: a, service: local.New(), cfg: *conf.Hatchery.Local})
				names = append(names, conf.Hatchery.Local.Name)
			case "hatchery:kubernetes":
				services = append(services, serviceConf{arg: a, service: kubernetes.New(), cfg: *conf.Hatchery.Kubernetes})
				names = append(names, conf.Hatchery.Kubernetes.Name)
			case "hatchery:marathon":
				services = append(services, serviceConf{arg: a, service: marathon.New(), cfg: *conf.Hatchery.Marathon})
				names = append(names, conf.Hatchery.Marathon.Name)
			case "hatchery:openstack":
				services = append(services, serviceConf{arg: a, service: openstack.New(), cfg: *conf.Hatchery.Openstack})
				names = append(names, conf.Hatchery.Openstack.Name)
			case "hatchery:swarm":
				services = append(services, serviceConf{arg: a, service: swarm.New(), cfg: *conf.Hatchery.Swarm})
				names = append(names, conf.Hatchery.Swarm.Name)
			case "hatchery:vsphere":
				services = append(services, serviceConf{arg: a, service: vsphere.New(), cfg: *conf.Hatchery.VSphere})
				names = append(names, conf.Hatchery.VSphere.Name)
			case "hooks":
				services = append(services, serviceConf{arg: a, service: hooks.New(), cfg: *conf.Hooks})
				names = append(names, conf.Hooks.Name)
			case "vcs":
				services = append(services, serviceConf{arg: a, service: vcs.New(), cfg: *conf.VCS})
				names = append(names, conf.VCS.Name)
			case "repositories":
				services = append(services, serviceConf{arg: a, service: repositories.New(), cfg: *conf.Repositories})
				names = append(names, conf.Repositories.Name)
			case "elasticsearch":
				services = append(services, serviceConf{arg: a, service: elasticsearch.New(), cfg: *conf.ElasticSearch})
				names = append(names, conf.ElasticSearch.Name)
			default:
				fmt.Printf("Error: service '%s' unknown\n", a)
				os.Exit(1)
			}
		}

		//Initialize logs
		log.Initialize(&log.Conf{
			Level:                  conf.Log.Level,
			GraylogProtocol:        conf.Log.Graylog.Protocol,
			GraylogHost:            conf.Log.Graylog.Host,
			GraylogPort:            fmt.Sprintf("%d", conf.Log.Graylog.Port),
			GraylogExtraKey:        conf.Log.Graylog.ExtraKey,
			GraylogExtraValue:      conf.Log.Graylog.ExtraValue,
			GraylogFieldCDSVersion: sdk.VERSION,
			GraylogFieldCDSOS:      sdk.GOOS,
			GraylogFieldCDSArch:    sdk.GOARCH,
			GraylogFieldCDSName:    strings.Join(names, "_"),
			Ctx:                    ctx,
		})

		//Configure the services
		for _, s := range services {
			if err := s.service.ApplyConfiguration(s.cfg); err != nil {
				sdk.Exit("Unable to init service %s: %v", s.arg, err)
			}

			if srv, ok := s.service.(service.BeforeStart); ok {
				if err := srv.BeforeStart(); err != nil {
					sdk.Exit("Unable to start service %s: %v", s.arg, err)
				}
			}

			// Initialiaze tracing
			if err := observability.Init(*conf.Tracing, "cds-"+s.arg); err != nil {
				sdk.Exit("Unable to start tracing exporter: %v", err)
			}
		}

		//Start the services
		for _, s := range services {
			go start(ctx, s.service, s.cfg, s.arg)
			//Stupid trick: when API is starting wait a bit before start the other
			if s.arg == "API" || s.arg == "api" {
				time.Sleep(2 * time.Second)
			}
		}

		//Wait for the end
		<-ctx.Done()
		if ctx.Err() != nil {
			fmt.Printf("Exiting (%v)\n", ctx.Err())
		}
	},
}

func start(c context.Context, s service.Service, cfg interface{}, serviceName string) {
	if err := serve(c, s, serviceName, cfg); err != nil {
		sdk.Exit("Service has been stopped: %s %v", serviceName, err)
	}
}

func serve(c context.Context, s service.Service, serviceName string, cfg interface{}) error {
	ctx, cancel := context.WithCancel(c)
	defer cancel()

	// first register
	if err := s.Register(s.Status, cfg); err != nil {
		log.Error("%s> Unable to register: %v", serviceName, err)
		return err
	}
	log.Info("%s> Service registered", serviceName)

	// start the heartbeat goroutine
	go func() {
		if err := s.Heartbeat(ctx, s.Status, cfg); err != nil {
			log.Error("%v", err)
			cancel()
		}
	}()

	go func() {
		if err := s.Serve(c); err != nil {
			log.Error("%s> Serve: %v", serviceName, err)
			cancel()
		}
	}()

	<-ctx.Done()

	if ctx.Err() != nil {
		log.Error("%s> Service exiting with err: %v", serviceName, ctx.Err())
	} else {
		log.Info("%s> Service exiting", serviceName)
	}
	return ctx.Err()
}
