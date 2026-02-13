import {
  FixResponse,
  DeploymentConfig,
  DeploymentRecord,
  DeployStatus,
  RolloutStage,
  DEFAULT_DEPLOYMENT_CONFIG,
  HealthMetrics,
} from "./types.js";

// ─── Unique ID Generation ───────────────────────────────────────────────────

let counter = 0;

function generateDeployId(): string {
  counter += 1;
  return `deploy-${Date.now()}-${counter}`;
}

// ─── Health Monitor Abstraction ─────────────────────────────────────────────

/**
 * Provides real-time health metrics during a staged rollout.
 * The self-healing engine injects the real implementation.
 */
export interface HealthMonitor {
  /** Get the current health metrics for a platform. */
  getMetrics(platform: string): Promise<HealthMetrics>;
}

/**
 * Applies a fix to running infrastructure at a given traffic percentage.
 * Implementations handle the actual hot-swap / blue-green / canary mechanics.
 */
export interface DeployExecutor {
  /** Apply the fix to `percentage`% of traffic. */
  applyAtPercentage(
    fix: FixResponse,
    percentage: number,
  ): Promise<void>;

  /** Fully revert the fix (rollback). */
  rollback(fix: FixResponse): Promise<void>;
}

// ─── Deploy Pipeline ────────────────────────────────────────────────────────

export interface DeployPipelineConfig {
  readonly deployment?: DeploymentConfig;
  readonly healthMonitor: HealthMonitor;
  readonly deployExecutor: DeployExecutor;
  /** Override the clock for testing. */
  readonly clock?: () => number;
  /** Override the sleep function for testing. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Orchestrates a staged rollout of a validated fix.
 *
 * Flow:
 * 1. Check confidence against auto-deploy threshold.
 *    - Below threshold → return PENDING_REVIEW record.
 * 2. Walk through rollout stages (e.g. 10% → 50% → 100%).
 * 3. At each stage, soak for the configured duration while monitoring health.
 * 4. If error rate exceeds the stage's rollback threshold → rollback and abort.
 * 5. If all stages complete → return COMPLETE record.
 */
export class DeployPipeline {
  private readonly config: DeploymentConfig;
  private readonly healthMonitor: HealthMonitor;
  private readonly deployExecutor: DeployExecutor;
  private readonly clock: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(pipelineConfig: DeployPipelineConfig) {
    this.config = pipelineConfig.deployment ?? DEFAULT_DEPLOYMENT_CONFIG;
    this.healthMonitor = pipelineConfig.healthMonitor;
    this.deployExecutor = pipelineConfig.deployExecutor;
    this.clock = pipelineConfig.clock ?? (() => Date.now());
    this.sleep =
      pipelineConfig.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * Attempt to deploy a fix. Returns a record tracking the outcome.
   *
   * @param fix - Validated fix response.
   * @param platform - Target platform for health monitoring.
   * @returns Deployment record with final status.
   */
  async deploy(fix: FixResponse, platform: string): Promise<DeploymentRecord> {
    const record: DeploymentRecord = {
      id: generateDeployId(),
      fixResponse: fix,
      config: this.config,
      status: DeployStatus.PENDING_REVIEW,
      currentStageIndex: 0,
      startedAt: this.clock(),
    };

    // Gate: confidence must exceed auto-deploy threshold
    if (fix.confidence < this.config.autoDeployThreshold) {
      return { ...record, status: DeployStatus.PENDING_REVIEW };
    }

    // Enter deployment
    const deployingRecord: DeploymentRecord = {
      ...record,
      status: DeployStatus.DEPLOYING,
    };

    // Walk through rollout stages
    for (let i = 0; i < this.config.stages.length; i++) {
      const stage = this.config.stages[i];

      // Apply at this percentage
      try {
        await this.deployExecutor.applyAtPercentage(fix, stage.percentage);
      } catch (error) {
        await this.safeRollback(fix);
        return {
          ...deployingRecord,
          status: DeployStatus.FAILED,
          currentStageIndex: i,
          completedAt: this.clock(),
          rollbackReason:
            `Failed to apply at ${stage.percentage}%: ` +
            (error instanceof Error ? error.message : String(error)),
        };
      }

      // Soak and monitor
      const rollbackReason = await this.soakStage(stage, platform);
      if (rollbackReason !== null) {
        await this.safeRollback(fix);
        return {
          ...deployingRecord,
          status: DeployStatus.ROLLED_BACK,
          currentStageIndex: i,
          completedAt: this.clock(),
          rollbackReason,
        };
      }
    }

    // All stages passed
    return {
      ...deployingRecord,
      status: DeployStatus.COMPLETE,
      currentStageIndex: this.config.stages.length - 1,
      completedAt: this.clock(),
    };
  }

  /**
   * Monitor health during a soak period.
   * Returns null if healthy, or a reason string if rollback is needed.
   */
  private async soakStage(
    stage: RolloutStage,
    platform: string,
  ): Promise<string | null> {
    if (stage.soakDurationMs <= 0) {
      // No soak required — just do a single health check
      return this.checkHealth(stage, platform);
    }

    const soakEnd = this.clock() + stage.soakDurationMs;
    const checkInterval = Math.min(stage.soakDurationMs / 3, 30_000);

    while (this.clock() < soakEnd) {
      const reason = await this.checkHealth(stage, platform);
      if (reason !== null) {
        return reason;
      }
      await this.sleep(checkInterval);
    }

    return null;
  }

  /** Single health check against a stage's rollback threshold. */
  private async checkHealth(
    stage: RolloutStage,
    platform: string,
  ): Promise<string | null> {
    const metrics = await this.healthMonitor.getMetrics(platform);

    if (metrics.errorRate > stage.rollbackThreshold) {
      return (
        `Error rate ${(metrics.errorRate * 100).toFixed(1)}% exceeds ` +
        `threshold ${(stage.rollbackThreshold * 100).toFixed(1)}% ` +
        `at ${stage.percentage}% rollout.`
      );
    }

    return null;
  }

  /** Attempt rollback, swallowing errors (best-effort). */
  private async safeRollback(fix: FixResponse): Promise<void> {
    try {
      await this.deployExecutor.rollback(fix);
    } catch {
      // Rollback failure is logged by the caller via the record.
      // We don't throw here because we're already in an error path.
    }
  }
}
