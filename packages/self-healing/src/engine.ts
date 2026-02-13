import {
  FixRequest,
  FixResponse,
  ValidationResult,
  DeploymentRecord,
  DeployStatus,
  SelfHealingConfig,
  HealingEventListener,
  DEFAULT_DEPLOYMENT_CONFIG,
} from "./types.js";
import { diagnose } from "./diagnosis.js";
import { FixGenerator } from "./fix-generator.js";
import { validateFix, TestRunner } from "./fix-validator.js";
import {
  DeployPipeline,
  HealthMonitor,
  DeployExecutor,
  DeployPipelineConfig,
} from "./deploy-pipeline.js";

// ─── Engine Configuration ───────────────────────────────────────────────────

export interface SelfHealingEngineConfig extends SelfHealingConfig {
  /** Strategy for running generated tests in a sandbox. */
  readonly testRunner: TestRunner;
  /** Provider of real-time health metrics. */
  readonly healthMonitor: HealthMonitor;
  /** Executor that applies/reverts fixes to running infrastructure. */
  readonly deployExecutor: DeployExecutor;
  /** Lifecycle event listeners. */
  readonly listeners?: readonly HealingEventListener[];
  /** Override the clock for testing. */
  readonly clock?: () => number;
  /** Override sleep for testing. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Outcome of a single heal attempt. */
export interface HealResult {
  readonly fixResponse: FixResponse;
  readonly validation: ValidationResult;
  readonly deployment?: DeploymentRecord;
}

// ─── Self-Healing Engine ────────────────────────────────────────────────────

/**
 * Orchestrates the full self-healing pipeline:
 * Monitor → Diagnose → Fix (Claude) → Validate → Deploy.
 *
 * External consumers call {@link heal} when a scraper error is detected.
 * The engine handles diagnosis, LLM-powered fix generation, test validation,
 * and conditional deployment with staged rollout.
 */
export class SelfHealingEngine {
  private readonly fixGenerator: FixGenerator;
  private readonly deployPipeline: DeployPipeline;
  private readonly testRunner: TestRunner;
  private readonly listeners: readonly HealingEventListener[];

  constructor(config: SelfHealingEngineConfig) {
    this.fixGenerator = new FixGenerator({
      apiKey: config.apiKey,
      model: config.model,
      maxTokens: config.maxTokens,
    });

    const pipelineConfig: DeployPipelineConfig = {
      deployment: config.deployment ?? DEFAULT_DEPLOYMENT_CONFIG,
      healthMonitor: config.healthMonitor,
      deployExecutor: config.deployExecutor,
      clock: config.clock,
      sleep: config.sleep,
    };
    this.deployPipeline = new DeployPipeline(pipelineConfig);
    this.testRunner = config.testRunner;
    this.listeners = config.listeners ?? [];
  }

  /**
   * Attempt to automatically heal a scraper breakage.
   *
   * @param request - The error context and diagnostic data.
   * @param currentFiles - Current file contents for patch application.
   * @returns The outcome of the heal attempt.
   * @throws If the Claude API call fails (network, auth, etc.).
   */
  async heal(
    request: FixRequest,
    currentFiles: ReadonlyMap<string, string>,
  ): Promise<HealResult> {
    // 1. Diagnose
    const diagnosis = diagnose(request);
    this.emit("onDiagnosisComplete", diagnosis, request);

    // 2. Generate fix via Claude
    const fixResponse = await this.fixGenerator.generate(request, diagnosis);
    this.emit("onFixGenerated", fixResponse, request);

    // 3. Validate the fix
    const validation = await validateFix(
      fixResponse,
      currentFiles,
      this.testRunner,
    );
    this.emit("onValidationComplete", validation, fixResponse);

    // 4. If validation fails, don't deploy
    if (!validation.passed) {
      return { fixResponse, validation };
    }

    // 5. Deploy (if confidence is high enough)
    const deployment = await this.deployPipeline.deploy(
      fixResponse,
      request.platform,
    );

    // 6. Emit deployment events
    if (deployment.status === DeployStatus.PENDING_REVIEW) {
      this.emit(
        "onHumanReviewRequired",
        fixResponse,
        `Confidence ${fixResponse.confidence} below auto-deploy threshold ${this.deployPipeline["config"].autoDeployThreshold}`,
      );
    } else if (deployment.status === DeployStatus.COMPLETE) {
      this.emit("onDeployStarted", deployment);
      this.emit("onDeployComplete", deployment);
    } else if (deployment.status === DeployStatus.ROLLED_BACK) {
      this.emit("onRollback", deployment, deployment.rollbackReason ?? "unknown");
    }

    return { fixResponse, validation, deployment };
  }

  /** Fire a lifecycle event to all listeners that implement the handler. */
  private emit<K extends keyof HealingEventListener>(
    event: K,
    ...args: Parameters<NonNullable<HealingEventListener[K]>>
  ): void {
    for (const listener of this.listeners) {
      const handler = listener[event];
      if (typeof handler === "function") {
        try {
          (handler as (...a: unknown[]) => void).apply(listener, args);
        } catch {
          // Listener errors must not break the pipeline.
        }
      }
    }
  }
}
