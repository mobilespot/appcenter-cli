import * as chalk from "chalk";
import { inspect } from "util";
import { AppCenterClient, clientRequest, models } from "../../../util/apis";
import {
  AppCommand,
  CommandArgs,
  CommandResult,
  ErrorCodes,
  failure,
  help,
  longName,
  shortName,
  success,
  hasArg,
} from "../../../util/commandline";
import { formatIsJson, out } from "../../../util/interaction";
import { scriptName } from "../../../util/misc";
import { promiseMap } from "../../../util/misc/promise-map";
import { formatDate } from "./lib/date-helper";

const debug = require("debug")("appcenter-cli:commands:codepush:deployments:list");
const PROMISE_CONCURRENCY = 30;

@help("List the deployments associated with an app")
export default class CodePushDeploymentListListCommand extends AppCommand {
  @help("Specifies whether to display the deployment key")
  @shortName("k")
  @longName("displayKey")
  public displayKey: boolean;

  @help("Specifies the deployment name")
  @shortName("d")
  @longName("deploymentName")
  @hasArg
  public deploymentName: string;

  constructor(args: CommandArgs) {
    super(args);
  }

  async run(client: AppCenterClient): Promise<CommandResult> {
    const app = this.app;
    const deploymentName = this.deploymentName;
    let deployments: models.Deployment[];
    try {
      const httpRequest = await out.progress(
        "Getting CodePush deployments...",
        clientRequest<models.Deployment[]>((cb) => client.codePushDeployments.list(app.ownerName, app.appName, cb))
      );
      deployments = httpRequest.result;
      const deployment = deployments.find((deployment) => deployment.name === deploymentName);
      if (!deploymentName || deploymentName === undefined || deploymentName === "") {
        return failure(ErrorCodes.Exception, "Deployment name is missing provide a value for -d|--deploymentName option");
      } else if (!deployment) {
        return failure(ErrorCodes.Exception, "Deployment not found, please check the value of -d|--deploymentName option");
      } else if (this.displayKey) {
        out.text(deployment.key);
      } else {
        out.text("Note: To display deployment keys add -k|--displayKey option");
        out.table(
          out.getCommandOutputTableOptions(this.generateColoredTableTitles(["Name", "Update Metadata", "Install Metrics"])),
          await this.generateInfo([deployment], client)
        );
      }
      return success();
    } catch (error) {
      debug(`Failed to get list of Codepush deployments - ${inspect(error)}`);
      if (error.statusCode === 404) {
        const appNotFoundErrorMsg = `The app ${
          this.identifier
        } does not exist. Please double check the name, and provide it in the form owner/appname. \nRun the command ${chalk.bold(
          `${scriptName} apps list`
        )} to see what apps you have access to.`;
        return failure(ErrorCodes.InvalidParameter, appNotFoundErrorMsg);
      } else {
        return failure(ErrorCodes.Exception, "Failed to get list of deployments for the app");
      }
    }
  }

  private generateColoredTableTitles(tableTitles: string[]): string[] {
    return tableTitles.map((title) => chalk.cyan(title));
  }

  private async generateInfo(deployments: models.Deployment[], client: AppCenterClient) {
    return await promiseMap(
      deployments,
      async (deployment) => {
        if (formatIsJson()) {
          const metricsJSON: models.CodePushReleaseMetric = await this.generateMetricsJSON(deployment, client);

          if (metricsJSON && deployment.latestRelease) {
            deployment.latestRelease.metrics = metricsJSON;
          }

          return deployment;
        }

        let metadataString: string = "";
        let metricsString: string = "";

        if (deployment.latestRelease) {
          metadataString = this.generateMetadataString(deployment.latestRelease);
          metricsString = await this.getMetricsString(deployment, client);
        } else {
          metadataString = chalk.magenta("No updates released");
          metricsString = chalk.magenta("No installs recorded");
        }

        return [deployment.name, metadataString, metricsString];
      },
      PROMISE_CONCURRENCY
    );
  }

  private async generateMetricsJSON(deployment: models.Deployment, client: AppCenterClient): Promise<models.CodePushReleaseMetric> {
    const metrics: models.CodePushReleaseMetric[] = await this.getMetrics(deployment, client);

    if (metrics.length) {
      let releasesTotalActive: number = 0;
      metrics.forEach((metric) => (releasesTotalActive += metric.active));

      const latestMetric = metrics.pop();
      latestMetric.totalActive = releasesTotalActive;
      delete latestMetric.label;
      return latestMetric;
    }

    return null;
  }

  private async getMetrics(deployment: models.Deployment, client: AppCenterClient): Promise<models.CodePushReleaseMetric[]> {
    const httpRequest = await out.progress(
      "Getting CodePush deployments metrics...",
      clientRequest<models.CodePushReleaseMetric[]>((cb) =>
        client.codePushDeploymentMetrics.get(deployment.name, this.app.ownerName, this.app.appName, cb)
      )
    );
    const metrics: models.CodePushReleaseMetric[] = httpRequest.result;

    return metrics;
  }

  private async getMetricsString(deployment: models.Deployment, client: AppCenterClient): Promise<string> {
    const metrics: models.CodePushReleaseMetric[] = await this.getMetrics(deployment, client);

    let releasesTotalActive: number = 0;
    metrics.forEach((metric) => (releasesTotalActive += metric.active));

    const releaseMetrics: models.CodePushReleaseMetric = metrics.find((metric) => metric.label === deployment.latestRelease.label);

    return this.generateMetricsString(releaseMetrics, releasesTotalActive);
  }

  private generateMetricsString(releaseMetrics: models.CodePushReleaseMetric, releasesTotalActive: number): string {
    if (releaseMetrics) {
      let metricsString: string = "";

      const activePercent: number = releasesTotalActive ? (releaseMetrics.active / releasesTotalActive) * 100 : 0.0;
      let percentString: string;
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

      const pending: number = releaseMetrics.downloaded - releaseMetrics.installed - releaseMetrics.failed;
      if (pending) {
        metricsString += ` (${pending} pending)`;
      }

      return metricsString;
    } else {
      return chalk.magenta("No installs recorded");
    }
  }

  private generateMetadataString(release: models.CodePushRelease): string {
    let metadataString: string = "";
    const lineFeed: string = "\n";

    metadataString += chalk.green("Label: ") + release.label + lineFeed;
    metadataString += chalk.green("App Version: ") + release.targetBinaryRange + lineFeed;
    metadataString += chalk.green("Mandatory: ") + (release.isMandatory ? "Yes" : "No") + lineFeed;
    metadataString += chalk.green("Release Time: ") + formatDate(release.uploadTime) + lineFeed;
    metadataString += chalk.green("Released By: ") + release.releasedBy;

    return metadataString;
  }
}
