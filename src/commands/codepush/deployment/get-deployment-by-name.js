"use strict";
var __decorate =
  (this && this.__decorate) ||
  function (decorators, target, key, desc) {
    var c = arguments.length,
      r = c < 3 ? target : desc === null ? (desc = Object.getOwnPropertyDescriptor(target, key)) : desc,
      d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else
      for (var i = decorators.length - 1; i >= 0; i--)
        if ((d = decorators[i])) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
  };
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
Object.defineProperty(exports, "__esModule", { value: true });
const chalk = require("chalk");
const util_1 = require("util");
const apis_1 = require("../../../util/apis");
const commandline_1 = require("../../../util/commandline");
const interaction_1 = require("../../../util/interaction");
const misc_1 = require("../../../util/misc");
const promise_map_1 = require("../../../util/misc/promise-map");
const date_helper_1 = require("./lib/date-helper");
const debug = require("debug")("appcenter-cli:commands:codepush:deployments:get-deployment-by-name");
const PROMISE_CONCURRENCY = 30;
let CodePushDeploymentGetDeploymentByNameCommand = class CodePushDeploymentGetDeploymentByNameCommand extends commandline_1.AppCommand {
  constructor(args) {
    super(args);
  }
  run(client) {
    return __awaiter(this, void 0, void 0, function* () {
      const app = this.app;
      const deploymentName = this.deploymentName;
      let deployments;
      try {
        const httpRequest = yield interaction_1.out.progress(
          "Getting CodePush deployments...",
          (0, apis_1.clientRequest)((cb) => client.codePushDeployments.getDeploymentByName(app.ownerName, app.appName, cb))
        );
        deployments = httpRequest.result;
        const deployment = deployments.find((deployment) => deployment.name === deploymentName);
        if (!deploymentName || deploymentName === undefined || deploymentName === "") {
          return (0, commandline_1.failure)(
            commandline_1.ErrorCodes.Exception,
            "Deployment name is missing provide a value for -d|--deploymentName option"
          );
        } else if (!deployment) {
          return (0, commandline_1.failure)(
            commandline_1.ErrorCodes.Exception,
            "Deployment not found, please check the value of -d|--deploymentName option"
          );
        } else if (this.displayKey) {
          interaction_1.out.text(deployment.key);
        } else {
          interaction_1.out.text("Note: To display deployment key add -k|--displayKey option");
          interaction_1.out.table(
            interaction_1.out.getCommandOutputTableOptions(
              this.generateColoredTableTitles(["Name", "Update Metadata", "Install Metrics"])
            ),
            yield this.generateInfo([deployment], client)
          );
        }
        return (0, commandline_1.success)();
      } catch (error) {
        debug(`Failed to get list of Codepush deployments - ${(0, util_1.inspect)(error)}`);
        if (error.statusCode === 404) {
          const appNotFoundErrorMsg = `The app ${
            this.identifier
          } does not exist. Please double check the name, and provide it in the form owner/appname. \nRun the command ${chalk.bold(
            `${misc_1.scriptName} apps list`
          )} to see what apps you have access to.`;
          return (0, commandline_1.failure)(commandline_1.ErrorCodes.InvalidParameter, appNotFoundErrorMsg);
        } else {
          return (0, commandline_1.failure)(commandline_1.ErrorCodes.Exception, "Failed to get list of deployments for the app");
        }
      }
    });
  }
  generateColoredTableTitles(tableTitles) {
    return tableTitles.map((title) => chalk.cyan(title));
  }
  generateInfo(deployments, client) {
    return __awaiter(this, void 0, void 0, function* () {
      return yield (0, promise_map_1.promiseMap)(
        deployments,
        (deployment) =>
          __awaiter(this, void 0, void 0, function* () {
            if ((0, interaction_1.formatIsJson)()) {
              const metricsJSON = yield this.generateMetricsJSON(deployment, client);
              if (metricsJSON && deployment.latestRelease) {
                deployment.latestRelease.metrics = metricsJSON;
              }
              return deployment;
            }
            let metadataString = "";
            let metricsString = "";
            if (deployment.latestRelease) {
              metadataString = this.generateMetadataString(deployment.latestRelease);
              metricsString = yield this.getMetricsString(deployment, client);
            } else {
              metadataString = chalk.magenta("No updates released");
              metricsString = chalk.magenta("No installs recorded");
            }
            return [deployment.name, metadataString, metricsString];
          }),
        PROMISE_CONCURRENCY
      );
    });
  }
  generateMetricsJSON(deployment, client) {
    return __awaiter(this, void 0, void 0, function* () {
      const metrics = yield this.getMetrics(deployment, client);
      if (metrics.length) {
        let releasesTotalActive = 0;
        metrics.forEach((metric) => (releasesTotalActive += metric.active));
        const latestMetric = metrics.pop();
        latestMetric.totalActive = releasesTotalActive;
        delete latestMetric.label;
        return latestMetric;
      }
      return null;
    });
  }
  getMetrics(deployment, client) {
    return __awaiter(this, void 0, void 0, function* () {
      const httpRequest = yield interaction_1.out.progress(
        "Getting CodePush deployments metrics...",
        (0, apis_1.clientRequest)((cb) =>
          client.codePushDeploymentMetrics.get(deployment.name, this.app.ownerName, this.app.appName, cb)
        )
      );
      const metrics = httpRequest.result;
      return metrics;
    });
  }
  getMetricsString(deployment, client) {
    return __awaiter(this, void 0, void 0, function* () {
      const metrics = yield this.getMetrics(deployment, client);
      let releasesTotalActive = 0;
      metrics.forEach((metric) => (releasesTotalActive += metric.active));
      const releaseMetrics = metrics.find((metric) => metric.label === deployment.latestRelease.label);
      return this.generateMetricsString(releaseMetrics, releasesTotalActive);
    });
  }
  generateMetricsString(releaseMetrics, releasesTotalActive) {
    if (releaseMetrics) {
      let metricsString = "";
      const activePercent = releasesTotalActive ? (releaseMetrics.active / releasesTotalActive) * 100 : 0.0;
      let percentString;
      if (activePercent === 100.0) {
        percentString = "100%";
      } else if (activePercent === 0.0) {
        percentString = "0%";
      } else {
        percentString = activePercent.toPrecision(2) + "%";
      }
      metricsString += chalk.green("Active: ") + percentString + ` (${releaseMetrics.active} of ${releasesTotalActive})\n`;
      if (releaseMetrics.installed != null) {
        metricsString += chalk.green("Installed: ") + releaseMetrics.installed;
      }
      const pending = releaseMetrics.downloaded - releaseMetrics.installed - releaseMetrics.failed;
      if (pending) {
        metricsString += ` (${pending} pending)`;
      }
      return metricsString;
    } else {
      return chalk.magenta("No installs recorded");
    }
  }
  generateMetadataString(release) {
    let metadataString = "";
    const lineFeed = "\n";
    metadataString += chalk.green("Label: ") + release.label + lineFeed;
    metadataString += chalk.green("App Version: ") + release.targetBinaryRange + lineFeed;
    metadataString += chalk.green("Mandatory: ") + (release.isMandatory ? "Yes" : "No") + lineFeed;
    metadataString += chalk.green("Release Time: ") + (0, date_helper_1.formatDate)(release.uploadTime) + lineFeed;
    metadataString += chalk.green("Released By: ") + release.releasedBy;
    return metadataString;
  }
};
__decorate(
  [
    (0, commandline_1.help)("Specifies the deployment name"),
    (0, commandline_1.shortName)("d"),
    (0, commandline_1.longName)("deploymentName"),
    commandline_1.hasArg,
  ],
  CodePushDeploymentGetDeploymentByNameCommand.prototype,
  "deploymentName",
  void 0
);
__decorate(
  [
    (0, commandline_1.help)("Specifies whether to display the deployment key"),
    (0, commandline_1.shortName)("k"),
    (0, commandline_1.longName)("displayKey"),
  ],
  CodePushDeploymentGetDeploymentByNameCommand.prototype,
  "displayKey",
  void 0
);
CodePushDeploymentGetDeploymentByNameCommand = __decorate(
  [(0, commandline_1.help)("List the deployments associated with an app")],
  CodePushDeploymentGetDeploymentByNameCommand
);
exports.default = CodePushDeploymentGetDeploymentByNameCommand;
