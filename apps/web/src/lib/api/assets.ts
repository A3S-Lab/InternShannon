import { type ApiRequestInit, apiClient, apiRawFetch, apiRawUpload, apiUrl } from "@/lib/api/client";
import type { PageQueryParams, PaginatedResponse } from "@/lib/shared";

export type AssetCategory = "code" | "agent" | "mcp" | "knowledge" | "memory" | "skill" | "tool" | "model";

/**
 * 文档型资产（知识 / 记忆）判别。这类资产详情页直接落整页编辑器，并启用 wiki / 检索 / 知识图谱
 * 等能力。统一散落在 asset-workspace / asset-editor 等处的 `=== "knowledge" || === "memory"` 谓词。
 */
export function isDocumentAssetCategory(category: AssetCategory | undefined | null): boolean {
  return category === "knowledge" || category === "memory";
}

/**
 * 个人专属知识库判别：每位用户有且仅有一个 `category='knowledge'` 且
 * `metadata.knowledge.personal=true` 的资产（后端 GET /assets/me/knowledge 懒创建，
 * migration 093 唯一索引保证唯一）。「内核 → 知识」页打开的就是它，与普通知识资产区分。
 */
export function isPersonalKnowledgeAsset(
  asset: { category?: AssetCategory; metadata?: Record<string, unknown> } | undefined | null,
): boolean {
  if (!asset || asset.category !== "knowledge") return false;
  const knowledge = (asset.metadata as { knowledge?: { personal?: unknown } } | undefined)?.knowledge;
  return knowledge?.personal === true;
}

export type AssetVisibility = "public" | "private";
export type AssetPermission = "read" | "write" | "admin" | "maintain" | "triage";

export type CodeGraphNodeKind = "file" | "package" | "symbol";
export type CodeGraphEdgeKind = "imports" | "defines" | "calls";
export type CodeGraphSymbol = {
  name: string;
  kind: "class" | "function" | "interface" | "type" | "component" | "module" | "struct" | "enum";
  line: number;
  startIndex: number;
};
export type CodeGraphNode = {
  id: string;
  label: string;
  kind: CodeGraphNodeKind;
  path?: string;
  relativePath?: string;
  language?: string;
  symbolKind?: CodeGraphSymbol["kind"];
  line?: number;
  ownerFileId?: string;
  outgoing: number;
  incoming: number;
  loc?: number;
  symbols?: CodeGraphSymbol[];
};
export type CodeGraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: CodeGraphEdgeKind;
  specifier: string;
};
export type CodeGraphModel = {
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  indexedFiles: number;
  skippedFiles: number;
  externalPackages: number;
  symbolCount: number;
  generatedAt: number;
};
export type AssetAgentKind = "tool" | "application" | "agentic";

export interface AssetCatalogProfile {
  displayName?: string;
  summary?: string;
  tags?: string[];
  rating?: number;
  ratingCount?: number;
  downloadCount?: number;
  usageCount?: number;
  responseSpeed?: string;
  level?: string;
  status?: string;
  scenario?: string;
  ownerDisplayName?: string;
}

export interface AssetDiagnosisAck {
  lastReportId: string;
  lastSourceRevision: string;
  verdict: "passed";
  acknowledgedAt: string;
  acknowledgedBy?: string;
}

export interface Asset {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  ownerType: "user" | "organization";
  category: AssetCategory;
  visibility: AssetVisibility;
  description?: string;
  homepage?: string;
  defaultBranch: string;
  cloneUrl: string;
  starCount: number;
  forkCount: number;
  watchCount: number;
  isForked: boolean;
  sourceAssetId?: string;
  /** 智能体子类型，仅 category=agent 时返回 */
  agentKind?: AssetAgentKind;
  catalogProfile?: AssetCatalogProfile;
  lifecycleState?: "draft" | "developing" | "ready" | "building" | "packaged" | "published" | "deprecated" | "archived";
  isBuiltin?: boolean;
  readOnly?: boolean;
  deletable?: boolean;
  /** 由 AssetMapper 注入；当资产有 ack 过的诊断报告时存在。 */
  assetDiagnosis?: AssetDiagnosisAck;
  createdAt: string;
  updatedAt: string;
}

export interface AssetCreationHistorySession {
  id: string;
  sessionId: string;
  agentId: string;
  title: string;
  status: string;
  assetId: string;
  assetName?: string;
  assetCategory?: AssetCategory | string;
  agentKind?: AssetAgentKind | string;
  agentPhase?: string;
  prompt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AssetNaturalLanguageSaveResult {
  assetId: string;
  category: "agent" | "knowledge" | "skill" | "mcp" | "code" | "tool" | "model";
  branch: string;
  commitSha: string;
  blobSha: string;
  message: string;
  changelogEntry: string;
  changedFiles: string[];
  summarizedCommitShas: string[];
  savedAt: string;
}

export interface FinishedAgentRestoreResult {
  agentId: string;
  status: "published" | string;
  publishedAt: string;
}

export type AssetDevelopmentBoardStatus =
  | "idle"
  | "planning"
  | "developing"
  | "accepting"
  | "pr_opened"
  | "completed"
  | "failed";
export type AssetDevelopmentLane = "requirements" | "development" | "acceptance";
export type AssetDevelopmentItemStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped"
  | "waiting_review";

export interface AssetDevelopmentBoardItem {
  id: string;
  lane: AssetDevelopmentLane;
  title: string;
  description?: string;
  status: AssetDevelopmentItemStatus;
  sourceItemId?: string;
  agentId?: string;
  sessionId?: string;
  note?: string;
  pullRequest?: AssetDevelopmentBoardPullRequest;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AssetDevelopmentBoardTaskGroupTask {
  id: string;
  title: string;
  description?: string;
  lane?: AssetDevelopmentLane;
  status: AssetDevelopmentItemStatus;
  itemId?: string;
  agentId?: string;
  sessionId?: string;
  note?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AssetDevelopmentBoardTaskGroupProgress {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  waitingReview: number;
}

export interface AssetDevelopmentBoardTaskGroup {
  id: string;
  rootItemId: string;
  title: string;
  description?: string;
  kind?: "general" | "diagnose" | "optimize" | string;
  status: AssetDevelopmentItemStatus;
  agentId?: string;
  sessionId?: string;
  itemIds: string[];
  tasks: AssetDevelopmentBoardTaskGroupTask[];
  progress: AssetDevelopmentBoardTaskGroupProgress;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AssetDevelopmentBoardPullRequest {
  id: string;
  number: number;
  title: string;
  status: PullRequestStatus | string;
  baseRef: string;
  headRef: string;
  headCommitSha?: string;
}

export interface AssetDevelopmentBoard {
  id: string;
  assetId: string;
  status: AssetDevelopmentBoardStatus;
  items: AssetDevelopmentBoardItem[];
  taskGroups?: AssetDevelopmentBoardTaskGroup[];
  developmentSessionId?: string;
  acceptanceSessionId?: string;
  pullRequest?: AssetDevelopmentBoardPullRequest;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

type AssetListResponse<T> = T[] | PaginatedResponse<T>;

export interface CreateAssetInput {
  name: string;
  ownerType: "user" | "organization";
  ownerId?: string;
  category: AssetCategory;
  visibility: AssetVisibility;
  description?: string;
  homepage?: string;
  /** 仅 category=agent 时生效；不传时后端默认 'application' */
  agentKind?: AssetAgentKind;
  scaffoldTemplate?:
    | "a3s-code-basic-agent"
    | "a3s-code-tool-agent"
    | "a3s-code-python-basic-agent"
    | "a3s-code-python-tool-agent";
}

export interface AssetScaffoldTemplate {
  key: NonNullable<CreateAssetInput["scaffoldTemplate"]>;
  name: string;
  description: string;
  category: "agent";
  source: "a3s-code";
  sdk: "typescript" | "python";
  sdkLabel: string;
  variant: "basic" | "tool";
  recommended?: boolean;
  tags: string[];
  entrypoint: string;
  packageManager: string;
  localRunCommand: string;
  buildCommand: string;
  fileCount: number;
  sourceFileCount: number;
  configFileCount: number;
}

export interface AssetScaffoldTemplateFile {
  path: string;
  encoding: "utf8";
  content: string;
  size: number;
}

export interface AssetScaffoldTemplatePreview extends AssetScaffoldTemplate {
  files: AssetScaffoldTemplateFile[];
}

export interface Branch {
  id: string;
  assetId: string;
  name: string;
  isProtected: boolean;
  requiredApprovals: number;
  requireStatusChecks: boolean;
  commitSha: string;
  createdAt: string;
}

export interface Tag {
  id: string;
  assetId: string;
  name: string;
  commitSha: string;
  createdAt: string;
}

export interface Release {
  id: string;
  assetId: string;
  tagName: string;
  name: string;
  body?: string;
  targetCommitish: string;
  isDraft: boolean;
  isPrerelease: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Commit {
  id: string;
  assetId: string;
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  authorAvatarUrl?: string;
  parentShas: string[];
  treeSha: string;
  createdAt: string;
}

export interface CommitComment {
  id: string;
  assetId: string;
  commitSha: string;
  userId: string;
  body: string;
  line?: number;
  filePath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssetComparison {
  assetId: string;
  base: string;
  head: string;
  baseCommitSha: string;
  headCommitSha: string;
  aheadBy: number;
  behindBy: number;
  filesChanged: number;
  additions: number;
  deletions: number;
  commits: Commit[];
  diff: string;
}

export type PullRequestStatus = "open" | "closed" | "merged";
export type PullRequestMergeStrategy = "merge" | "squash" | "rebase";
export type PullRequestReviewDecision = "approved" | "changes_requested" | "commented";
export type IssueStatus = "open" | "closed";
export type ExternalProvider = "github";

export interface Issue {
  id: string;
  assetId: string;
  number: number;
  title: string;
  body?: string;
  authorId: string;
  status: IssueStatus;
  labels: string[];
  assignees: string[];
  closedBy?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
  // External sync fields
  externalId?: string;
  externalProvider?: ExternalProvider;
  externalUrl?: string;
  syncedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface IssueComment {
  id: string;
  assetId: string;
  issueId: string;
  userId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface PullRequest {
  id: string;
  assetId: string;
  number: number;
  title: string;
  body?: string;
  baseRef: string;
  headRef: string;
  baseCommitSha: string;
  headCommitSha: string;
  authorId: string;
  assignees: string[];
  requestedReviewers: string[];
  status: PullRequestStatus;
  filesChanged: number;
  additions: number;
  deletions: number;
  commitsCount: number;
  mergedBy?: string;
  mergeStrategy?: PullRequestMergeStrategy;
  mergedAt?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
  // External sync fields
  externalId?: string;
  externalProvider?: ExternalProvider;
  externalUrl?: string;
  syncedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface PullRequestComment {
  id: string;
  assetId: string;
  pullRequestId: string;
  userId: string;
  body: string;
  filePath?: string;
  line?: number;
  side?: "base" | "head";
  createdAt: string;
  updatedAt: string;
}

export interface PullRequestReview {
  id: string;
  assetId: string;
  pullRequestId: string;
  reviewerId: string;
  decision: PullRequestReviewDecision;
  body?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Collaborator {
  id: string;
  assetId: string;
  userId: string;
  permission: AssetPermission;
  createdAt: string;
  updatedAt: string;
}

export type CollaboratorInvitationStatus = "pending" | "accepted" | "declined" | "revoked" | "expired";
export type CollaboratorAccessEventAction =
  | "invitation_created"
  | "invitation_resent"
  | "invitation_accepted"
  | "invitation_declined"
  | "invitation_revoked"
  | "collaborator_permission_updated"
  | "collaborator_removed";

export interface CollaboratorInvitation {
  id: string;
  assetId: string;
  assetName?: string;
  assetOwnerId?: string;
  assetOwnerType?: "user" | "organization";
  assetCategory?: AssetCategory;
  assetVisibility?: AssetVisibility;
  inviteeUserId?: string;
  inviteeEmail?: string;
  inviteeUsername?: string;
  permission: AssetPermission;
  status: CollaboratorInvitationStatus;
  invitedBy: string;
  acceptedBy?: string;
  acceptedAt?: string;
  declinedAt?: string;
  revokedAt?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CollaboratorAccessEvent {
  id: string;
  assetId: string;
  action: CollaboratorAccessEventAction;
  actorId?: string;
  invitationId?: string;
  targetUserId?: string;
  targetEmail?: string;
  targetUsername?: string;
  permission?: AssetPermission;
  previousPermission?: AssetPermission;
  createdAt: string;
}

export interface AssetWebhook {
  id: string;
  assetId: string;
  url: string;
  hasSecret: boolean;
  events: string[];
  isActive: boolean;
  lastStatus?: "success" | "failure";
  lastStatusCode?: number;
  lastError?: string;
  lastDeliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type Webhook = AssetWebhook;

export interface CreateBranchInput {
  name: string;
  commitSha: string;
  isProtected?: boolean;
  requiredApprovals?: number;
  requireStatusChecks?: boolean;
}

export interface UpdateBranchProtectionInput {
  name: string;
  isProtected: boolean;
  requiredApprovals?: number;
  requireStatusChecks?: boolean;
}

export interface CreateTagInput {
  name: string;
  commitSha: string;
}

export interface CreateReleaseInput {
  tagName: string;
  name: string;
  body?: string;
  targetCommitish?: string;
  isDraft?: boolean;
  isPrerelease?: boolean;
}

export type UpdateReleaseInput = Partial<Pick<Release, "name" | "body" | "isDraft" | "isPrerelease">>;

export interface CreatePullRequestInput {
  title: string;
  body?: string;
  baseRef: string;
  headRef: string;
  assignees?: string[];
  requestedReviewers?: string[];
}

export type UpdatePullRequestInput = Partial<Pick<PullRequest, "title" | "body" | "assignees" | "requestedReviewers">>;

export interface CreatePullRequestCommentInput {
  body: string;
  filePath?: string;
  line?: number;
  side?: "base" | "head";
}

export interface CreatePullRequestReviewInput {
  decision: PullRequestReviewDecision;
  body?: string;
}

export interface CreateCommitCommentInput {
  body: string;
  line?: number;
  filePath?: string;
}

export interface AddCollaboratorInput {
  userId: string;
  permission: AssetPermission;
}

export interface InviteCollaboratorInput {
  invitee: string;
  permission: AssetPermission;
  expiresInDays?: number;
}

export interface UpdateCollaboratorPermissionInput {
  permission: AssetPermission;
}

export interface ResendCollaboratorInvitationInput {
  expiresInDays?: number;
}

export interface CreateWebhookInput {
  url: string;
  secret?: string;
  events?: string[];
  isActive?: boolean;
}

export type UpdateWebhookInput = Partial<{
  url: string;
  secret: string | null;
  events: string[];
  isActive: boolean;
}>;

export type AssetLifecycleState =
  | "draft"
  | "developing"
  | "ready"
  | "building"
  | "packaged"
  | "published"
  | "deprecated"
  | "archived";

export type AssetLifecycleTransition =
  | "start_development"
  | "mark_ready"
  | "start_build"
  | "build_succeeded"
  | "build_failed"
  | "publish"
  | "unpublish"
  | "deprecate"
  | "archive"
  | "restore";

export interface AssetLifecycleAllowedTransition {
  event: AssetLifecycleTransition;
  to: AssetLifecycleState;
  label: string;
  description: string;
  requiresReason: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

export interface AssetLifecycleHistoryEntry {
  id: string;
  event: AssetLifecycleTransition | "initialize";
  from?: AssetLifecycleState;
  to: AssetLifecycleState;
  actorId?: string;
  reason?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  at: string;
}

export interface AssetLifecycleStateView {
  assetId: string;
  state: AssetLifecycleState;
  label: string;
  previousState?: AssetLifecycleState;
  updatedAt: string;
  updatedBy?: string;
  allowedTransitions: AssetLifecycleAllowedTransition[];
  qualityGate: {
    status: "not_submitted" | "submitted" | "reviewing" | "passed" | "failed" | "changes_requested" | "cancelled";
    qualityStatus?: "passed" | "failed";
    latestSubmissionId?: string;
    passed: boolean;
    inProgress: boolean;
    completed: boolean;
    blockingReason?: string;
    source: "assetQuality" | "assetDiagnosis" | "none";
  };
  history: AssetLifecycleHistoryEntry[];
}

export interface AssetLifecycleCatalog {
  states: Array<{ state: AssetLifecycleState; label: string; terminal: boolean }>;
  transitions: Array<{
    event: AssetLifecycleTransition;
    from: AssetLifecycleState[];
    to: AssetLifecycleState;
    label: string;
    description: string;
    requiresReason?: boolean;
  }>;
}

export interface AssetLifecycleTransitionInput {
  event: AssetLifecycleTransition;
  expectedState?: AssetLifecycleState;
  reason?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface AssetLifecycleTransitionResult {
  assetId: string;
  event: AssetLifecycleTransition;
  from: AssetLifecycleState;
  to: AssetLifecycleState;
  state: AssetLifecycleStateView;
  transitionedAt: string;
}

export interface AssetLifecyclePublishAllResult {
  events: AssetLifecycleTransition[];
  finalState: AssetLifecycleState;
  pendingBuild: boolean;
}

export interface AssetLifecycle {
  asset: Pick<
    Asset,
    | "id"
    | "name"
    | "ownerId"
    | "ownerType"
    | "category"
    | "visibility"
    | "description"
    | "defaultBranch"
    | "starCount"
    | "forkCount"
    | "watchCount"
    | "createdAt"
    | "updatedAt"
  >;
  versions: {
    branchCount: number;
    tagCount: number;
    releaseCount: number;
    commitCount: number;
    latestCommitSha?: string;
    latestRelease?: string;
  };
  governance: {
    collaboratorCount: number;
    stargazerCount: number;
    subscriberCount: number;
    forkCount: number;
  };
  build: {
    status: "not_configured" | "ready";
    message: string;
  };
  packages: {
    count: number;
    items: Array<{
      repository: string;
      type: string;
      publisher: string;
      latestVersion: string | null;
      versionCount: number;
      sizeBytes: number;
      format: "oci" | "zip";
      distributionKind?: "hosted-oci-image" | "external-oci-image" | "oci-artifact";
      packageKind?: string;
      hostedImage?: boolean;
      externalImage?: string;
      updatedAt: string | null;
    }>;
  };
  marketplace: {
    status: "not_packaged" | "ready_to_list";
    message: string;
  };
}

export interface AssetPackage {
  id: string;
  name: string;
  assetId: string;
  version: string;
  type: AssetCategory;
  format: "oci" | "zip" | "json" | "markdown" | "pypi" | "npm";
  distributionKind?: "hosted-oci-image" | "external-oci-image" | "oci-artifact";
  packageKind?: string;
  hostedImage?: boolean;
  externalImage?: string;
  downloadUrl?: string;
  sizeBytes?: number;
  checksum?: string;
  publishedBy: string;
  publishedAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface AssetRepositoryRef {
  name: string;
  type: "branch" | "tag";
  sha: string;
}

export interface AssetRepositoryInfo {
  assetId: string;
  cloneUrl: string;
  sshUrl?: string;
  defaultBranch: string;
  refs: AssetRepositoryRef[];
}

export interface AssetRepositoryTreeItem {
  path: string;
  name: string;
  type: "tree" | "blob" | "commit";
  mode: string;
  sha: string;
  size: number | null;
}

export interface AssetRepositoryTree {
  assetId: string;
  ref: string;
  path: string;
  items: AssetRepositoryTreeItem[];
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
  hasNext?: boolean;
  hasPrevious?: boolean;
}

export interface AssetRepositoryBlob {
  assetId: string;
  ref: string;
  path: string;
  encoding: "utf8" | "base64";
  content: string;
  size: number;
}

export interface UpdateAssetBlobInput {
  content: string;
  message: string;
  branch: string;
  authorName?: string;
  authorEmail?: string;
}

export interface DeleteAssetBlobInput {
  message: string;
  branch: string;
  authorName?: string;
  authorEmail?: string;
}

export interface RenameAssetBlobInput extends DeleteAssetBlobInput {
  toPath: string;
}

export interface ImportRepositoryInput {
  remoteUrl: string;
  provider?: GitProvider;
  authType?: "none" | "token" | "connected";
  username?: string;
  token?: string;
  overwrite?: boolean;
}

export type GitProvider = "github";
export type ConnectedGitProvider = Extract<GitProvider, "github">;

export interface GitProviderConnectionStatus {
  connected: boolean;
  provider: ConnectedGitProvider;
  oauthConfigured?: boolean;
  accountLogin?: string;
  avatarUrl?: string;
  profileUrl?: string;
  scopes: string[];
  updatedAt?: string;
}

export type GitHubConnectionStatus = GitProviderConnectionStatus & { provider: "github" };

export interface StartGitProviderOAuthResponse {
  authorizationUrl: string;
}

export type StartGitHubOAuthResponse = StartGitProviderOAuthResponse;

export interface GitRepositorySummary {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  ownerLogin: string;
  ownerAvatarUrl?: string;
  description?: string;
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
  defaultBranch: string;
  language?: string;
  updatedAt?: string;
  pushedAt?: string;
}

export type GitHubRepositorySummary = GitRepositorySummary;

export interface GitRepositoryListResult {
  items: GitRepositorySummary[];
  page: number;
  hasMore: boolean;
}

export type GitHubRepositoryListResult = GitRepositoryListResult;

export interface UploadRepositoryFilesInput {
  files: Array<{
    path: string;
    contentBase64: string;
  }>;
  message?: string;
  overwrite?: boolean;
}

export interface AssetRepositoryImportProgress {
  percent: number;
  stage: "queued" | "validating" | "authenticating" | "mirroring" | "syncing" | "completed" | "failed" | string;
  message: string;
  remoteUrl?: string;
  provider?: ImportRepositoryInput["provider"];
  updatedAt: string;
}

export interface AssetRepositoryImportJob {
  jobId: string;
  assetId: string;
  status: "waiting" | "active" | "completed" | "failed" | "delayed" | "paused" | string;
  progress: boolean | string | number | AssetRepositoryImportProgress | Record<string, unknown>;
  failedReason?: string;
  result?: AssetRepositoryInfo & Record<string, unknown>;
}

export interface AssetQueryParams extends PageQueryParams {
  scope?: "mine" | "public" | "all";
  ownerType?: "user" | "organization";
  ownerId?: string;
  category?: AssetCategory;
  visibility?: AssetVisibility;
  status?: string;
  excludeStatus?: string;
  /** 'tool'/'application' 仅匹配对应子类型 agent，'none' 仅匹配非 agent 资产 */
  agentKind?: "tool" | "application" | "agentic" | "none";
}

export type ModelScopeResourceType = "mcp" | "skill" | "model";

export interface ModelScopeSyncInput {
  sourceUrl?: string;
  apiUrl?: string;
  limit?: number;
  pageSize?: number;
  cursor?: string;
  force?: boolean;
  dryRun?: boolean;
}

export interface ModelScopeSyncResult {
  provider: string;
  resourceType: ModelScopeResourceType;
  sourceUrl: string;
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
  dryRun: boolean;
  nextCursor?: string;
  lastSourceUpdatedAt?: string;
  syncedAt: string;
  logs: string[];
}

export type ModelScopeSyncStreamEvent =
  | { type: "log"; line: string }
  | { type: "result"; result: ModelScopeSyncResult }
  | { type: "error"; message: string };

// ── 一键诊断 ──────────────────────────────────────────────────────────────

export type DiagnosisFindingCategory = "bug" | "performance" | "maintainability" | "security";
export type DiagnosisFindingSeverity = "critical" | "major" | "minor" | "info";
export type DiagnosisFindingConfidence = "high" | "medium" | "low";

export interface DiagnosisFinding {
  category: DiagnosisFindingCategory;
  severity: DiagnosisFindingSeverity;
  group?: string;
  groupKey?: string;
  file: string;
  line?: number;
  title: string;
  detail: string;
  suggestion?: string;
  /** 不修复的后果 / 影响面。 */
  impact?: string;
  /** 支撑证据：触发问题的代码片段或精确位置上下文。 */
  evidence?: string;
  /** 该发现的置信度。 */
  confidence?: DiagnosisFindingConfidence;
}

export type DiagnosisPatchType = "manifest" | "code";

export interface DiagnosisProposedPatch {
  path: string;
  type: DiagnosisPatchType;
  diff: string;
  rationale: string;
}

export type DiagnosisRiskLevel = "low" | "medium" | "high" | "critical";

export interface DiagnosisSummary {
  bugCount?: number;
  performanceCount?: number;
  maintainabilityCount?: number;
  securityCount?: number;
  patchCount?: number;
  /** 执行摘要叙述（评估范围 / 整体姿态 / 首要风险 / 优先级）。 */
  overview?: string;
  /** 综合健康分 0–100。 */
  healthScore?: number;
  /** 整体风险等级。 */
  riskLevel?: DiagnosisRiskLevel;
  [key: string]: unknown;
}

export type DiagnosisStatus = "running" | "succeeded" | "failed";

/**
 * Per-worker outcome snapshot for a multi-worker diagnose run
 * (3.2.x `parallel_task` fan-out). Undefined on legacy reports —
 * frontend falls back to deriving from `planningTasks` filtering.
 */
export interface DiagnoseScopeStatusSnapshot {
  succeeded: number;
  failed: number;
  total: number;
  details: Array<{
    name: string;
    label: string;
    status: "completed" | "failed";
    error?: string;
  }>;
}

export interface AssetDiagnosisReport {
  id: string;
  assetId: string;
  status: DiagnosisStatus;
  mode?: "diagnose" | "optimize" | string;
  sourceRevision?: string;
  summary: DiagnosisSummary;
  findings: DiagnosisFinding[];
  proposedPatches: DiagnosisProposedPatch[];
  appliedPatches: string[];
  planningTasks?: DiagnosePlanningTask[];
  remediation?: DiagnosisRemediationSnapshot;
  scopeStatus?: DiagnoseScopeStatusSnapshot;
  /**
   * Times the runner's idempotent-reuse short-circuit served this row in
   * place of a fresh agent run. Older rows (pre-075 migration) default to 0.
   */
  reuseCount?: number;
  error?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiagnosePlanningTask {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | string;
  note?: string;
}

export interface DiagnoseResultPayload {
  reportId: string;
  summary: DiagnosisSummary;
  findingCount: number;
  patchCount: number;
  branch?: string;
  commitSha?: string;
  pullRequest?: DiagnosePullRequestSummary;
}

export interface DiagnosePullRequestSummary {
  id: string;
  number: number;
  title: string;
  status: PullRequestStatus;
  baseRef: string;
  headRef: string;
  headCommitSha: string;
}

export interface DiagnosisRemediationSnapshot {
  branch?: string;
  commitSha?: string;
  pullRequest?: DiagnosePullRequestSummary;
}

export interface ApplyDiagnosisPatchesResult {
  report: AssetDiagnosisReport;
  /** 非内置资产 apply 时承载分支名（如 diagnose/<reportId 前 8 位>）；内置为空 */
  branch?: string;
  commitSha?: string;
  pullRequest?: DiagnosePullRequestSummary;
}

export const assetCategories: Array<{ value: AssetCategory; label: string }> = [
  { value: "agent", label: "智能体" },
  { value: "knowledge", label: "知识" },
  { value: "skill", label: "技能" },
  { value: "mcp", label: "MCP" },
  { value: "tool", label: "工具" },
  { value: "code", label: "代码" },
  { value: "memory", label: "经验" },
  { value: "model", label: "模型" },
];

// ---- Knowledge wiki (llm_wiki-style) ----
export type WikiPageType = "entity" | "concept" | "source" | "query" | "synthesis" | "comparison";

export interface WikiSourceEntry {
  path: string;
  name: string;
  size: number;
}

export interface WikiPageEntry {
  path: string;
  title: string;
  type: WikiPageType | null;
  sources: string[];
  /** Normalized frontmatter tags[]; group pages by tag client-side. */
  tags?: string[];
}

/** A page that links INTO a given page (inbound resolved [[wikilink]]). */
export interface WikiBacklink {
  path: string;
  title: string;
  type: WikiPageType | null;
}

export interface WikiBacklinksResult {
  path: string;
  backlinks: WikiBacklink[];
}

/** A page semantically related to a given page. */
export interface WikiSimilarHit {
  path: string;
  title: string;
  type: WikiPageType | null;
  /** Cosine similarity in [0,1]; higher = more related. */
  similarity: number;
}

export interface WikiSimilarResult {
  path: string;
  hits: WikiSimilarHit[];
}

/** An aggregated frontmatter tag with the number of pages carrying it. */
export interface WikiTagCount {
  tag: string;
  count: number;
}

export interface WikiTagsResult {
  tags: WikiTagCount[];
}

/** 断链:某页面内未解析的 [[wikilink]](kind='wikilink' 且 resolved=false)。 */
export interface WikiBrokenLink {
  srcPath: string;
  srcTitle: string;
  target: string;
}

/** 孤立页面:没有任何已解析入链的内容页面(已排除 index/log/overview 与 purpose/schema)。 */
export interface WikiOrphanPage {
  path: string;
  title: string;
  type: WikiPageType | null;
}

/**
 * 知识库健康度快照(后端计算,无新表;读持久化派生索引 + 策展元数据,反映上次 reindex)。
 * lastIngestedAt 为 ISO 8601 字符串或 null(从未摄取)。
 */
export interface WikiHealth {
  pageCount: number;
  sourceCount: number;
  ingestedSourceCount: number;
  lastIngestedAt: string | null;
  taggedPageCount: number;
  brokenLinks: WikiBrokenLink[];
  orphanPages: WikiOrphanPage[];
}

export interface WikiConfig {
  purpose: string;
  schema: string;
  knowledgeType: string | null;
}

export interface WikiGraphNode {
  path: string;
  title: string;
  type: WikiPageType | null;
  sourceCount: number;
  degree: number;
}

export interface WikiGraphEdge {
  source: string;
  target: string;
  weight: number;
  signals: { directLink: number; sourceOverlap: number; adamicAdar: number; typeAffinity: number };
}

export interface WikiGraph {
  nodes: WikiGraphNode[];
  edges: WikiGraphEdge[];
}

export interface WikiSearchHit {
  path: string;
  title: string;
  type: WikiPageType | null;
  score: number;
  snippet: string;
}

export interface WikiSearchResult {
  query: string;
  hits: WikiSearchHit[];
}

export interface WikiIngestJobProgress {
  percent: number;
  stage: string;
  message: string;
  updatedAt: string;
}

export interface WikiIngestJobStatus {
  jobId: string;
  assetId: string;
  status: string;
  progress: WikiIngestJobProgress | number | string | boolean | object;
  failedReason?: string;
  result?: Record<string, unknown>;
}

export type WikiCurationStatusValue =
  | "idle"
  | "pending"
  | "ingesting"
  | "awaiting_review"
  | "synthesizing"
  | "ready";

export interface WikiCurationStatus {
  assetId: string;
  personal: boolean;
  curationStatus: WikiCurationStatusValue;
  pendingCount: number;
  processedCount: number;
  lastCurationAt: string | null;
  /** 自动策展开关(默认 true);引擎是否实际在跑(LOOP_ENGINE_ENABLED)。 */
  autoCuration: boolean;
  engineEnabled: boolean;
}

/**
 * 知识库编辑审计动作。覆盖 wiki 页面 / 源文档 / 摄取 / 域治理的变更类型;
 * 前端将其映射为友好中文标签 + 图标。后端未知动作降级为原始字符串展示。
 */
export type WikiAuditAction =
  | "page.save"
  | "page.delete"
  | "page.rename"
  | "source.upload"
  | "source.delete"
  | "ingest.complete"
  | "domain.create"
  | "domain.update"
  | "domain.archive"
  | "maintainer.set";

/**
 * 知识库编辑审计流的一条记录:谁(actor)在何时(at,ISO 8601)对哪个目标(target,如 wiki 页面路径
 * 或源文档名)做了何种动作(action)。actorName 由后端经 AUTH_SERVICE 解析回显,无法解析时退回 actorId。
 */
export interface WikiAuditEntry {
  id: string;
  action: WikiAuditAction | string;
  /** 动作目标:wiki 页面路径 / 源文档名 / 域名等;无关动作可省略。 */
  target?: string | null;
  /** 重命名等动作的旧目标(如原页面路径),供前端展示 “A → B”。 */
  fromTarget?: string | null;
  actorId?: string | null;
  /** 解析后的用户名(优先展示);后端无法解析时为 null,前端退回 actorId。 */
  actorName?: string | null;
  /** ISO 8601 / RFC3339(带时区)。 */
  at: string;
  metadata?: Record<string, unknown>;
}

/**
 * 全局知识库(多域)的一项。全局知识库 = 面向【所有用户】公开共享的 category='knowledge' 资产,
 * 按域(domain,小写 kebab-case)区分;平台文档中心(os-docs)即域 'platform-docs'。
 * 任意登录用户只读可达,超级管理员可创建新域并在线编辑(后端 GET/POST /assets/docs/knowledge)。
 */
export interface GlobalKnowledgeDomain {
  id: string;
  domain: string | null;
  name: string;
  description: string | null;
  /** 是否已软归档(metadata.knowledge.archived=true)。列表默认排除归档域,超管可显式包含。 */
  archived?: boolean;
}

/** 跨域全局知识库检索的一条命中:带其来源域,供前端/InternShannon按域标注出处。 */
export interface GlobalKnowledgeSearchAllHit {
  domain: string;
  assetId: string;
  path: string;
  title: string;
  type: WikiPageType | null;
  snippet: string;
  score: number;
}

/** 跨域全局知识库检索结果:合并去重、按相关度排序的命中数组。 */
export interface GlobalKnowledgeSearchAllResult {
  q: string;
  hits: GlobalKnowledgeSearchAllHit[];
}

/** 全局知识库管理总览中的一项(某域的页数 / 来源 / 健康指标)。 */
export interface GlobalKnowledgeOverviewDomain {
  id: string;
  domain: string | null;
  name: string;
  archived: boolean;
  pageCount: number;
  sourceCount: number;
  ingestedSourceCount: number;
  lastIngestedAt: string | null;
  brokenLinkCount: number;
  orphanCount: number;
}

/**
 * 某域全局知识库的一名域管理员 / steward:在 super-admin 之外被授权【在线编辑该域】的普通用户。
 * username / email 由后端经 AUTH_SERVICE 解析回显(无法解析时为 null)。
 */
export interface GlobalKnowledgeMaintainer {
  userId: string;
  username: string | null;
  email: string | null;
}

/** 某域全局知识库域管理员名单的响应(GET / PUT :domain/maintainers 同形)。 */
export interface GlobalKnowledgeMaintainersResult {
  id: string;
  domain: string | null;
  maintainers: GlobalKnowledgeMaintainer[];
}

/** 全局知识库管理看板的聚合总览:各域统计 + 跨域总计(总计仅含未归档域)。 */
export interface GlobalKnowledgeOverview {
  totals: {
    domainCount: number;
    pageCount: number;
    sourceCount: number;
    brokenLinkCount: number;
    orphanCount: number;
  };
  domains: GlobalKnowledgeOverviewDomain[];
}

export const assetsApi = {
  list: (params?: AssetQueryParams, options?: ApiRequestInit) => {
    const search = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== "") {
        search.set(key, String(value));
      }
    });
    const query = search.toString();
    return apiClient.get<PaginatedResponse<Asset>>(`/api/assets${query ? `?${query}` : ""}`, options);
  },
  get: (id: string) => apiClient.get<Asset>(`/api/assets/${id}`),
  /** 解析当前用户的专属知识库(首次访问时后端懒创建,每用户唯一)。 */
  getMyKnowledge: () => apiClient.get<Asset>(`/api/assets/me/knowledge`),
  /** 把源文档直接沉淀进当前用户的专属知识库(默认捕获入口),可选立即摄取。 */
  addToMyKnowledge: (input: {
    sources: Array<{ path: string; content: string }>;
    ingest?: boolean;
  }) =>
    apiClient.post<{ assetId: string; paths: string[]; job?: unknown }>(
      `/api/assets/me/knowledge/sources`,
      input,
    ),
  /**
   * 播种/重新摄取 InternShannon 文档知识库(os-docs,本地 Desktop 用于文档问答)。
   * 超管专属(后端 platform:runtime:access 把关)。幂等:重复同步以文件名覆盖、不产生副本。
   */
  syncDocsKnowledge: (options?: ApiRequestInit) =>
    apiClient.post<{ assetId: string; uploaded: number; job: { jobId?: string } & Record<string, unknown> }>(
      `/api/assets/docs/knowledge/sync`,
      undefined,
      options,
    ),
  /**
   * 列出所有面向全体用户公开共享的全局知识库(按域)。任意登录用户可见(全局知识库本就公开),
   * 供超级管理员管理多域并在线编辑。返回每个域的 {id, domain, name, description, archived}。
   * 默认排除已软归档的域;传 includeArchived=true 时一并返回(超管管理视图用)。
   */
  listGlobalKnowledge: (params?: { includeArchived?: boolean }) =>
    apiClient.get<{ items: GlobalKnowledgeDomain[] }>(
      `/api/assets/docs/knowledge${params?.includeArchived ? "?includeArchived=true" : ""}`,
    ),
  /**
   * 为某个领域创建一条公开共享的全局知识库(超管专属,后端 platform:runtime:access 把关)。
   * 同一域已存在则后端返回 400(每域单例)。返回 {id, domain, name, description}。
   */
  createGlobalKnowledge: (
    input: { domain: string; name?: string; description?: string },
    options?: ApiRequestInit,
  ) => apiClient.post<GlobalKnowledgeDomain>(`/api/assets/docs/knowledge`, input, options),
  /**
   * 更新某域全局知识库的展示名 / 描述(超管专属,后端 platform:runtime:access 把关)。
   * 域不存在返回 404。返回 {id, domain, name, description}。
   */
  updateGlobalKnowledge: (
    domain: string,
    input: { name?: string; description?: string },
    options?: ApiRequestInit,
  ) =>
    apiClient.put<GlobalKnowledgeDomain>(
      `/api/assets/docs/knowledge/${encodeURIComponent(domain)}`,
      input,
      options,
    ),
  /**
   * 软归档 / 取消归档某域全局知识库(超管专属;archived=true 后该域默认从列表隐藏)。
   * 后端仅写 metadata.knowledge.archived(无迁移)。返回 {id, domain, archived}。
   */
  archiveGlobalKnowledge: (domain: string, archived: boolean, options?: ApiRequestInit) =>
    apiClient.post<{ id: string; domain: string | null; archived: boolean }>(
      `/api/assets/docs/knowledge/${encodeURIComponent(domain)}/archive`,
      { archived },
      options,
    ),
  /**
   * 列出某域全局知识库的域管理员 / steward 名单(超管专属,后端 platform:runtime:access 把关)。
   * 域管理员是 super-admin 之外被授权【在线编辑该域】的普通用户。返回带 username/email 解析回显。
   * 域不存在返回 404。
   */
  listGlobalKnowledgeMaintainers: (domain: string, options?: ApiRequestInit) =>
    apiClient.get<GlobalKnowledgeMaintainersResult>(
      `/api/assets/docs/knowledge/${encodeURIComponent(domain)}/maintainers`,
      options,
    ),
  /**
   * 整列覆盖设置某域全局知识库的域管理员 / steward 名单(超管专属,后端 platform:runtime:access 把关)。
   * identifiers 为 userId / email / 用户名混合数组,后端解析为 userId;传 [] 清空名单(回到仅超管可编辑)。
   * 域不存在返回 404。返回带 username/email 的解析回显(与 list 同形)。
   */
  setGlobalKnowledgeMaintainers: (domain: string, identifiers: string[], options?: ApiRequestInit) =>
    apiClient.put<GlobalKnowledgeMaintainersResult>(
      `/api/assets/docs/knowledge/${encodeURIComponent(domain)}/maintainers`,
      { identifiers },
      options,
    ),
  /**
   * 跨域检索【所有未归档】全局知识库(平台文档 + 各领域),合并去重后按相关度排序,每条命中带其来源域。
   * 无需指定域 —— 这是InternShannon结合官方/领域全局知识作答时的首选接地方式。
   */
  searchAllGlobalKnowledge: (q: string, limit?: number, options?: ApiRequestInit) => {
    const search = new URLSearchParams({ q });
    if (limit !== undefined) search.set("limit", String(limit));
    return apiClient.get<GlobalKnowledgeSearchAllResult>(
      `/api/assets/docs/knowledge/search-all?${search.toString()}`,
      options,
    );
  },
  /**
   * 全局知识库管理看板的聚合总览:各域统计(页数 / 来源 / 已摄取 / 最近摄取 / 断链 / 孤儿)+ 跨域总计。
   * 归档域计入 domains 列表(带 archived 标记)但不计入 totals。
   */
  globalKnowledgeOverview: (options?: ApiRequestInit) =>
    apiClient.get<GlobalKnowledgeOverview>(`/api/assets/docs/knowledge/overview`, options),
  developmentBoard: (id: string) => apiClient.get<AssetDevelopmentBoard>(`/api/assets/${id}/development-board`),
  addDevelopmentRequirement: (
    id: string,
    input: {
      title: string;
      description?: string;
      kind?: "general" | "diagnose" | "optimize";
      /** Pass true to bypass the runner's idempotent reuse (set by "重新诊断"). */
      forceRerun?: boolean;
      /**
       * Interactive optimize (WebIDE click-to-fix): produce patches but leave
       * them pending instead of auto-applying, so the report can offer per-item
       * / all "修复" buttons. Only honored for kind='optimize'.
       */
      deferRemediation?: boolean;
    },
  ) => apiClient.post<AssetDevelopmentBoard>(`/api/assets/${id}/development-board/requirements`, input),
  retryDevelopmentRequirement: (id: string, requirementId: string) =>
    apiClient.post<AssetDevelopmentBoard>(`/api/assets/${id}/development-board/requirements/${requirementId}/retry`),
  cancelDevelopmentRequirement: (id: string, requirementId: string) =>
    apiClient.post<AssetDevelopmentBoard>(`/api/assets/${id}/development-board/requirements/${requirementId}/cancel`),
  archiveDevelopmentRequirement: (id: string, requirementId: string) =>
    apiClient.post<AssetDevelopmentBoard>(`/api/assets/${id}/development-board/requirements/${requirementId}/archive`),
  /**
   * Re-run a single failed scope worker inside a diagnosis report and merge
   * the result back into that report (does NOT re-run the whole 30-60min
   * diagnose). Returns the board snapshot with the new scope-retry card.
   */
  retryDiagnosisScope: (id: string, reportId: string, scopeName: string) =>
    apiClient.post<AssetDevelopmentBoard>(`/api/assets/${id}/development-board/diagnose-scope-retry`, {
      reportId,
      scopeName,
    }),
  listCreationSessions: (id: string) =>
    apiClient.get<AssetCreationHistorySession[]>(`/api/assets/${id}/creation-sessions`),
  listMyCreationSessions: (limit = 100, category?: AssetCategory) =>
    apiClient.get<AssetCreationHistorySession[]>(`/api/assets/creation-sessions${toQuery({ limit, category })}`),
  saveNaturalLanguageCreation: (
    id: string,
    input?: { sessionId?: string; branch?: string; note?: string; source?: string },
  ) => apiClient.post<AssetNaturalLanguageSaveResult>(`/api/assets/${id}/natural-language-save`, input ?? {}),
  compare: (id: string, params: { base: string; head: string }) =>
    apiClient.get<AssetComparison>(`/api/assets/${id}/compare${toQuery(params)}`),
  listScaffoldTemplates: (params?: {
    category?: AssetCategory;
    source?: AssetScaffoldTemplate["source"];
    sdk?: AssetScaffoldTemplate["sdk"];
    variant?: AssetScaffoldTemplate["variant"];
  }) => apiClient.get<AssetScaffoldTemplate[]>(`/api/assets/scaffold-templates${toQuery(params)}`),
  getScaffoldTemplate: (
    key: NonNullable<CreateAssetInput["scaffoldTemplate"]>,
    params?: { name?: string; description?: string },
  ) =>
    apiClient.get<AssetScaffoldTemplatePreview>(
      `/api/assets/scaffold-templates/${encodeURIComponent(key)}${toQuery(params)}`,
    ),
  create: (input: CreateAssetInput) => apiClient.post<Asset>("/api/assets", input),
  applyScaffoldTemplate: (
    id: string,
    input: { templateKey: NonNullable<CreateAssetInput["scaffoldTemplate"]>; overwrite?: boolean },
  ) => apiClient.post<Asset>(`/api/assets/${id}/repository/scaffold`, input),
  lifecycle: (id: string) => apiClient.get<AssetLifecycle>(`/api/assets/${id}/lifecycle`),
  lifecycleState: (id: string) => apiClient.get<AssetLifecycleStateView>(`/api/assets/${id}/lifecycle/state`),
  lifecycleCatalog: (id: string, category?: "agent") =>
    apiClient.get<AssetLifecycleCatalog>(
      `/api/assets/${id}/lifecycle/catalog${category ? `?category=${category}` : ""}`,
    ),
  lifecycleTransition: (id: string, input: AssetLifecycleTransitionInput) =>
    apiClient.post<AssetLifecycleTransitionResult>(`/api/assets/${id}/lifecycle/transitions`, input),
  lifecyclePublishAll: (id: string) =>
    apiClient.post<AssetLifecyclePublishAllResult>(`/api/assets/${id}/lifecycle/publish-all`),
  listPackages: (id: string, params?: PageQueryParams) =>
    apiClient.get<AssetListResponse<AssetPackage>>(`/api/assets/${id}/packages${toQuery(params)}`).then(assetItems),
  uploadPackage: (id: string, file: File, input?: { name?: string; version?: string }) =>
    uploadAssetPackage(id, file, input),
  /**
   * 上传资产 Logo（PNG / JPEG / WebP / SVG，≤1MB）。Logo 以 assetId 为键存放在对象存储,
   * 无需数据库迁移；展示侧用 {@link assetLogoUrl} 拼出 <img> 地址,缺省时回退分类图标。
   */
  uploadLogo: (id: string, file: File) => uploadAssetLogo(id, file),
  initializeRepository: (id: string) => apiClient.post<AssetRepositoryInfo>(`/api/assets/${id}/repository/initialize`),
  importRepository: (id: string, input: ImportRepositoryInput) =>
    apiClient.post<AssetRepositoryInfo>(`/api/assets/${id}/repository/import`, input),
  enqueueRepositoryImport: (id: string, input: ImportRepositoryInput) =>
    apiClient.post<AssetRepositoryImportJob>(`/api/assets/${id}/repository/import-jobs`, input),
  repositoryImportJob: (id: string, jobId: string) =>
    apiClient.get<AssetRepositoryImportJob>(`/api/assets/${id}/repository/import-jobs/${encodeURIComponent(jobId)}`),
  githubConnectionStatus: () => apiClient.get<GitHubConnectionStatus>("/api/assets/git-providers/github/status"),
  startGithubOAuth: (input: { redirectUrl?: string }) =>
    apiClient.post<StartGitHubOAuthResponse>("/api/assets/git-providers/github/oauth/start", input),
  githubRepositories: (params?: { search?: string; page?: number }) =>
    apiClient.get<GitHubRepositoryListResult>(`/api/assets/git-providers/github/repositories${toQuery(params)}`),
  disconnectGithub: () => apiClient.delete<void>("/api/assets/git-providers/github"),
  uploadRepositoryFiles: (id: string, input: UploadRepositoryFilesInput) =>
    apiClient.post<AssetRepositoryInfo>(`/api/assets/${id}/repository/files`, input),
  /**
   * 与 uploadRepositoryFiles 等价,但走 XHR 上传以暴露上传字节进度(onUploadProgress)。
   * 用于本地文件夹导入时展示每个文件的上传进度(由整体字节进度按文件体积派生)。
   */
  uploadRepositoryFilesWithProgress: async (
    id: string,
    input: UploadRepositoryFilesInput,
    onUploadProgress?: (loaded: number, total: number) => void,
  ): Promise<AssetRepositoryInfo> => {
    const response = await apiRawUpload(`/api/assets/${id}/repository/files`, {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      onUploadProgress,
    });
    const text = await response.text();
    // 解析统一信封;非 JSON(如 413/502 的 HTML、nginx 错误页)时 payload 为 undefined。
    let payload: { code?: number; message?: string; data?: AssetRepositoryInfo } | undefined;
    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      payload = undefined;
    }
    // 业务码优先(后端可能 HTTP 200 但 code>=400);其次 HTTP 状态。apiClient.post 等价的错误判定。
    const businessCode = typeof payload?.code === "number" ? payload.code : undefined;
    const failed = !response.ok || (businessCode !== undefined && businessCode >= 400);
    if (failed) {
      const status = businessCode ?? response.status;
      const serverMessage = typeof payload?.message === "string" ? payload.message.trim() : "";
      // 大文件夹一次性 base64 上传易触发 413/网关体积上限——给出可操作提示而非裸状态码。
      const hint =
        status === 413 || status === 502
          ? "(文件过大或过多,请减少文件数量/体积,或改用 Git 导入)"
          : "";
      const detail =
        serverMessage ||
        (text && !payload ? `服务器返回非预期响应(HTTP ${response.status} ${response.statusText})` : "") ||
        response.statusText ||
        "请稍后重试";
      throw new Error(`上传失败 (${status})${hint}：${detail}`);
    }
    return (payload?.data ?? (payload as AssetRepositoryInfo)) as AssetRepositoryInfo;
  },
  /**
   * 二进制上传单个仓库文件:请求体即文件原始字节(application/octet-stream,无 base64,无 JSON 体积限制),
   * path / message / overwrite 走查询参数。文件夹上传按文件逐个调用,XHR 暴露字节进度。
   */
  uploadRepositoryFileBinary: async (
    id: string,
    input: { path: string; content: Blob; message?: string; overwrite?: boolean },
    onUploadProgress?: (loaded: number, total: number) => void,
  ): Promise<AssetRepositoryInfo> => {
    const query = toQuery({
      path: input.path,
      message: input.message,
      overwrite: input.overwrite ? "true" : undefined,
    });
    const response = await apiRawUpload(`/api/assets/${id}/repository/files/binary${query}`, {
      method: "POST",
      body: input.content,
      headers: { "Content-Type": "application/octet-stream" },
      onUploadProgress,
    });
    const text = await response.text();
    let payload: { code?: number; message?: string; data?: AssetRepositoryInfo } | undefined;
    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      payload = undefined;
    }
    const businessCode = typeof payload?.code === "number" ? payload.code : undefined;
    const failed = !response.ok || (businessCode !== undefined && businessCode >= 400);
    if (failed) {
      const status = businessCode ?? response.status;
      const serverMessage = typeof payload?.message === "string" ? payload.message.trim() : "";
      const hint = status === 413 || status === 502 ? "(文件过大或网关体积上限,可改用 Git 导入)" : "";
      const detail =
        serverMessage ||
        (text && !payload ? `服务器返回非预期响应(HTTP ${response.status} ${response.statusText})` : "") ||
        response.statusText ||
        "请稍后重试";
      throw new Error(`上传失败 (${status})${hint}：${detail}`);
    }
    return (payload?.data ?? (payload as AssetRepositoryInfo)) as AssetRepositoryInfo;
  },
  repository: (id: string) => apiClient.get<AssetRepositoryInfo>(`/api/assets/${id}/repository`),
  repositoryTree: (id: string, params?: { ref?: string; path?: string } & PageQueryParams) =>
    apiClient.get<AssetRepositoryTree>(`/api/assets/${id}/repository/tree${toQuery(params)}`),
  repositoryBlob: (id: string, params: { path: string; ref?: string }, options?: { timeoutMs?: number }) =>
    apiClient.get<AssetRepositoryBlob>(`/api/assets/${id}/repository/blob${toQuery(params)}`, options),
  /**
   * 服务端构建的代码知识图谱:一次拉回小体积 JSON(节点/边),替代浏览器端逐文件读取构建。
   * 返回结构与前端 `CodeGraphModel` 一致,供图谱面板直接消费;失败时调用方回退到客户端 buildCodeGraph。
   */
  repositoryCodeGraph: (id: string, params?: { ref?: string }, options?: ApiRequestInit) =>
    apiClient.get<CodeGraphModel>(`/api/assets/${id}/repository/code-graph${toQuery(params)}`, options),
  downloadSourceArchive: (id: string, ref?: string) =>
    getAssetBlob(`/api/assets/${id}/repository/archive${toQuery({ ref })}`),
  // ---- knowledge wiki ----
  wikiListSources: (id: string) => apiClient.get<WikiSourceEntry[]>(`/api/assets/${id}/wiki/sources`),
  /** 知识库策展循环状态摘要（纯元数据派生）。 */
  wikiCurationStatus: (id: string) => apiClient.get<WikiCurationStatus>(`/api/assets/${id}/wiki/curation`),
  /** 配置知识库自动策展开关。 */
  wikiSetCurationConfig: (id: string, autoCuration: boolean) =>
    apiClient.put<{ assetId: string; autoCuration: boolean }>(`/api/assets/${id}/wiki/curation/config`, { autoCuration }),
  /** 手动执行内核循环(策展):为该知识库立即入队一条 curation 运行。 */
  runKnowledgeCuration: (assetId: string) =>
    apiClient.post<{ enqueued: boolean; runId?: string; reason?: string; engineEnabled: boolean }>(
      `/api/loops/knowledge/runs`,
      { assetId },
    ),
  wikiUploadSources: (
    id: string,
    input: { sources: Array<{ name: string; contentBase64: string }>; ingest?: boolean },
  ) => apiClient.post<{ paths: string[]; job?: WikiIngestJobStatus }>(`/api/assets/${id}/wiki/sources`, input),
  wikiDeleteSource: (id: string, path: string) =>
    apiClient.delete<{ deleted: boolean; path: string }>(`/api/assets/${id}/wiki/sources${toQuery({ path })}`),
  wikiListPages: (id: string, options?: ApiRequestInit) =>
    apiClient.get<WikiPageEntry[]>(`/api/assets/${id}/wiki/pages`, options),
  wikiSavePage: (id: string, input: { path: string; content: string }) =>
    apiClient.patch<{ saved: boolean; path: string }>(`/api/assets/${id}/wiki/pages`, input),
  wikiDeletePage: (id: string, path: string) =>
    apiClient.delete<{ deleted: boolean; path: string }>(`/api/assets/${id}/wiki/pages${toQuery({ path })}`),
  wikiRenamePage: (id: string, input: { fromPath: string; toPath: string }) =>
    apiClient.post<{ renamed: boolean; fromPath: string; toPath: string }>(
      `/api/assets/${id}/wiki/pages/rename`,
      input,
    ),
  wikiGraph: (id: string) => apiClient.get<WikiGraph>(`/api/assets/${id}/wiki/graph`),
  wikiSearch: (id: string, q: string, limit?: number, options?: ApiRequestInit) =>
    apiClient.get<WikiSearchResult>(`/api/assets/${id}/wiki/search${toQuery({ q, limit })}`, options),
  /** 反向链接:所有通过已解析 [[wikilink]] 指向该页面的页面(入链)。 */
  wikiBacklinks: (id: string, path: string) =>
    apiClient.get<WikiBacklinksResult>(`/api/assets/${id}/wiki/backlinks${toQuery({ path })}`),
  /** 相关页面(语义):基于本地语义索引返回与该页面最相关的其它页面。 */
  wikiSimilar: (id: string, path: string, limit?: number, options?: ApiRequestInit) =>
    apiClient.get<WikiSimilarResult>(`/api/assets/${id}/wiki/similar${toQuery({ path, limit })}`, options),
  /** 标签聚合:frontmatter tags 及其页面数。 */
  wikiTags: (id: string) => apiClient.get<WikiTagsResult>(`/api/assets/${id}/wiki/tags`),
  /** 知识库健康度快照(页面/源/断链/孤立页面,后端计算、反映上次 reindex)。 */
  wikiHealth: (id: string, options?: ApiRequestInit) =>
    apiClient.get<WikiHealth>(`/api/assets/${id}/wiki/health`, options),
  wikiGetConfig: (id: string) => apiClient.get<WikiConfig>(`/api/assets/${id}/wiki/config`),
  wikiUpdateConfig: (id: string, input: { purpose?: string; schema?: string; knowledgeType?: string }) =>
    apiClient.put<WikiConfig>(`/api/assets/${id}/wiki/config`, input),
  wikiReindex: (id: string) =>
    apiClient.post<{ nodeCount: number; linkCount: number }>(`/api/assets/${id}/wiki/reindex`),
  wikiStartIngest: (id: string, sourcePaths: string[]) =>
    apiClient.post<WikiIngestJobStatus>(`/api/assets/${id}/wiki/ingest-jobs`, { sourcePaths }),
  wikiIngestStatus: (id: string, jobId: string) =>
    apiClient.get<WikiIngestJobStatus>(`/api/assets/${id}/wiki/ingest-jobs/${jobId}`),
  wikiListIngestJobs: (id: string, limit?: number) =>
    apiClient.get<WikiIngestJobStatus[]>(`/api/assets/${id}/wiki/ingest-jobs${toQuery({ limit })}`),
  /** 知识库编辑审计流:最近的页面/源文档/摄取/域治理变更记录(谁 / 动作 / 目标 / 时间)。 */
  wikiAuditLog: (id: string, limit?: number) =>
    apiClient.get<WikiAuditEntry[]>(`/api/assets/${id}/wiki/audit-log${toQuery({ limit })}`),
  updateBlob: (id: string, path: string, input: UpdateAssetBlobInput) =>
    apiClient.post<{ commitSha: string; blobSha: string }>(
      `/api/assets/${id}/blobs/update${toQuery({ path })}`,
      input,
    ),
  deleteBlob: (id: string, path: string, input: DeleteAssetBlobInput) =>
    apiClient.post<{ commitSha: string; deleted: boolean }>(
      `/api/assets/${id}/blobs/delete${toQuery({ path })}`,
      input,
    ),
  renameBlob: (id: string, path: string, input: RenameAssetBlobInput) =>
    apiClient.post<{ commitSha: string; blobSha: string; fromPath: string; toPath: string }>(
      `/api/assets/${id}/blobs/rename${toQuery({ path })}`,
      input,
    ),
  update: (id: string, input: Partial<Pick<Asset, "description" | "homepage" | "defaultBranch" | "agentKind">>) =>
    apiClient.patch<Asset>(`/api/assets/${id}`, input),
  delete: (id: string) => apiClient.delete<void>(`/api/assets/${id}`),
  restoreFinishedAgent: (id: string) =>
    apiClient.post<FinishedAgentRestoreResult>(`/api/super-factory/agents/${id}/restore`, {}),
  star: (id: string) => apiClient.post<void>(`/api/assets/${id}/star`),
  unstar: (id: string) => apiClient.delete<void>(`/api/assets/${id}/star`),
  listStargazers: (id: string, params?: PageQueryParams) =>
    apiClient.get<AssetListResponse<string>>(`/api/assets/${id}/stargazers${toQuery(params)}`).then(assetItems),
  watch: (id: string) => apiClient.post<void>(`/api/assets/${id}/subscribe`),
  unwatch: (id: string) => apiClient.delete<void>(`/api/assets/${id}/subscribe`),
  listSubscribers: (id: string, params?: PageQueryParams) =>
    apiClient.get<AssetListResponse<string>>(`/api/assets/${id}/subscribers${toQuery(params)}`).then(assetItems),
  fork: (id: string) => apiClient.post<Asset>(`/api/assets/${id}/fork`),
  listBranches: (assetId: string, params?: PageQueryParams) =>
    apiClient.get<AssetListResponse<Branch>>(`/api/assets/${assetId}/branches${toQuery(params)}`).then(assetItems),
  createBranch: (assetId: string, input: CreateBranchInput) =>
    apiClient.post<Branch>(`/api/assets/${assetId}/branches`, input),
  updateBranchProtection: (assetId: string, input: UpdateBranchProtectionInput) =>
    apiClient.patch<Branch>(`/api/assets/${assetId}/branches/protection`, input),
  deleteBranch: (assetId: string, name: string) =>
    apiClient.delete<void>(`/api/assets/${assetId}/branches/${encodeURIComponent(name)}`),
  listTags: (assetId: string, params?: PageQueryParams) =>
    apiClient.get<AssetListResponse<Tag>>(`/api/assets/${assetId}/tags${toQuery(params)}`).then(assetItems),
  createTag: (assetId: string, input: CreateTagInput) => apiClient.post<Tag>(`/api/assets/${assetId}/tags`, input),
  deleteTag: (assetId: string, name: string) =>
    apiClient.delete<void>(`/api/assets/${assetId}/tags/${encodeURIComponent(name)}`),
  listReleases: (assetId: string, params?: PageQueryParams) =>
    apiClient.get<AssetListResponse<Release>>(`/api/assets/${assetId}/releases${toQuery(params)}`).then(assetItems),
  createRelease: (assetId: string, input: CreateReleaseInput) =>
    apiClient.post<Release>(`/api/assets/${assetId}/releases`, input),
  updateRelease: (assetId: string, releaseId: string, input: UpdateReleaseInput) =>
    apiClient.patch<Release>(`/api/assets/${assetId}/releases/${releaseId}`, input),
  deleteRelease: (assetId: string, releaseId: string) =>
    apiClient.delete<void>(`/api/assets/${assetId}/releases/${releaseId}`),
  listIssues: (assetId: string, params?: PageQueryParams & { status?: IssueStatus }) =>
    apiClient.get<AssetListResponse<Issue>>(`/api/assets/${assetId}/issues${toQuery(params)}`).then(assetItems),
  createIssue: (assetId: string, input: Pick<Issue, "title"> & Partial<Pick<Issue, "body" | "labels" | "assignees">>) =>
    apiClient.post<Issue>(`/api/assets/${assetId}/issues`, input),
  updateIssue: (
    assetId: string,
    issueId: string,
    input: Partial<Pick<Issue, "title" | "body" | "labels" | "assignees">>,
  ) => apiClient.patch<Issue>(`/api/assets/${assetId}/issues/${issueId}`, input),
  closeIssue: (assetId: string, issueId: string) =>
    apiClient.post<Issue>(`/api/assets/${assetId}/issues/${issueId}/close`, {}),
  reopenIssue: (assetId: string, issueId: string) =>
    apiClient.post<Issue>(`/api/assets/${assetId}/issues/${issueId}/reopen`, {}),
  listIssueComments: (assetId: string, issueId: string, params?: PageQueryParams) =>
    apiClient
      .get<AssetListResponse<IssueComment>>(`/api/assets/${assetId}/issues/${issueId}/comments${toQuery(params)}`)
      .then(assetItems),
  createIssueComment: (assetId: string, issueId: string, input: { body: string }) =>
    apiClient.post<IssueComment>(`/api/assets/${assetId}/issues/${issueId}/comments`, input),
  deleteIssueComment: (assetId: string, issueId: string, commentId: string) =>
    apiClient.delete<void>(`/api/assets/${assetId}/issues/${issueId}/comments/${commentId}`),
  listPullRequests: (assetId: string, params?: PageQueryParams & { status?: PullRequestStatus }) =>
    apiClient
      .get<AssetListResponse<PullRequest>>(`/api/assets/${assetId}/pull-requests${toQuery(params)}`)
      .then(assetItems),
  createPullRequest: (assetId: string, input: CreatePullRequestInput) =>
    apiClient.post<PullRequest>(`/api/assets/${assetId}/pull-requests`, input),
  updatePullRequest: (assetId: string, pullRequestId: string, input: UpdatePullRequestInput) =>
    apiClient.patch<PullRequest>(`/api/assets/${assetId}/pull-requests/${pullRequestId}`, input),
  closePullRequest: (assetId: string, pullRequestId: string) =>
    apiClient.post<PullRequest>(`/api/assets/${assetId}/pull-requests/${pullRequestId}/close`, {}),
  reopenPullRequest: (assetId: string, pullRequestId: string) =>
    apiClient.post<PullRequest>(`/api/assets/${assetId}/pull-requests/${pullRequestId}/reopen`, {}),
  mergePullRequest: (assetId: string, pullRequestId: string, input?: { strategy?: PullRequestMergeStrategy }) =>
    apiClient.post<PullRequest>(`/api/assets/${assetId}/pull-requests/${pullRequestId}/merge`, input ?? {}),
  listPullRequestComments: (assetId: string, pullRequestId: string, params?: PageQueryParams) =>
    apiClient
      .get<AssetListResponse<PullRequestComment>>(
        `/api/assets/${assetId}/pull-requests/${pullRequestId}/comments${toQuery(params)}`,
      )
      .then(assetItems),
  createPullRequestComment: (assetId: string, pullRequestId: string, input: CreatePullRequestCommentInput) =>
    apiClient.post<PullRequestComment>(`/api/assets/${assetId}/pull-requests/${pullRequestId}/comments`, input),
  deletePullRequestComment: (assetId: string, pullRequestId: string, commentId: string) =>
    apiClient.delete<void>(`/api/assets/${assetId}/pull-requests/${pullRequestId}/comments/${commentId}`),
  listPullRequestReviews: (assetId: string, pullRequestId: string, params?: PageQueryParams) =>
    apiClient
      .get<AssetListResponse<PullRequestReview>>(
        `/api/assets/${assetId}/pull-requests/${pullRequestId}/reviews${toQuery(params)}`,
      )
      .then(assetItems),
  createPullRequestReview: (assetId: string, pullRequestId: string, input: CreatePullRequestReviewInput) =>
    apiClient.post<PullRequestReview>(`/api/assets/${assetId}/pull-requests/${pullRequestId}/reviews`, input),
  listCommits: (assetId: string, params?: PageQueryParams) =>
    apiClient.get<AssetListResponse<Commit>>(`/api/assets/${assetId}/commits${toQuery(params)}`).then(assetItems),
  getCommit: (assetId: string, sha: string) =>
    apiClient.get<Commit>(`/api/assets/${assetId}/commits/${encodeURIComponent(sha)}`),
  getCommitDiff: (assetId: string, sha: string) => getCommitDiff(assetId, sha),
  listCommitComments: (assetId: string, sha: string, params?: PageQueryParams) =>
    apiClient
      .get<AssetListResponse<CommitComment>>(
        `/api/assets/${assetId}/commits/${encodeURIComponent(sha)}/comments${toQuery(params)}`,
      )
      .then(assetItems),
  createCommitComment: (assetId: string, sha: string, input: CreateCommitCommentInput) =>
    apiClient.post<CommitComment>(`/api/assets/${assetId}/commits/${encodeURIComponent(sha)}/comments`, input),
  deleteCommitComment: (assetId: string, commentId: string) =>
    apiClient.delete<void>(`/api/assets/${assetId}/commits/comments/${commentId}`),
  listCollaborators: (assetId: string, params?: PageQueryParams) =>
    apiClient
      .get<AssetListResponse<Collaborator>>(`/api/assets/${assetId}/collaborators${toQuery(params)}`)
      .then(assetItems),
  addCollaborator: (assetId: string, input: AddCollaboratorInput) =>
    apiClient.post<Collaborator>(`/api/assets/${assetId}/collaborators`, input),
  removeCollaborator: (assetId: string, userId: string) =>
    apiClient.delete<void>(`/api/assets/${assetId}/collaborators/${encodeURIComponent(userId)}`),
  updateCollaboratorPermission: (assetId: string, userId: string, input: UpdateCollaboratorPermissionInput) =>
    apiClient.patch<Collaborator>(`/api/assets/${assetId}/collaborators/${encodeURIComponent(userId)}`, input),
  listCollaboratorAccessEvents: (assetId: string, params?: PageQueryParams) =>
    apiClient
      .get<AssetListResponse<CollaboratorAccessEvent>>(
        `/api/assets/${assetId}/collaborators/events${toQuery(params)}`,
      )
      .then(assetItems),
  listCollaboratorInvitations: (
    assetId: string,
    params?: PageQueryParams & { status?: CollaboratorInvitationStatus },
  ) =>
    apiClient
      .get<AssetListResponse<CollaboratorInvitation>>(
        `/api/assets/${assetId}/collaborators/invitations${toQuery(params)}`,
      )
      .then(assetItems),
  inviteCollaborator: (assetId: string, input: InviteCollaboratorInput) =>
    apiClient.post<CollaboratorInvitation>(`/api/assets/${assetId}/collaborators/invitations`, input),
  resendCollaboratorInvitation: (
    assetId: string,
    invitationId: string,
    input?: ResendCollaboratorInvitationInput,
  ) =>
    apiClient.post<CollaboratorInvitation>(
      `/api/assets/${assetId}/collaborators/invitations/${encodeURIComponent(invitationId)}/resend`,
      input ?? {},
    ),
  revokeCollaboratorInvitation: (assetId: string, invitationId: string) =>
    apiClient.delete<CollaboratorInvitation>(
      `/api/assets/${assetId}/collaborators/invitations/${encodeURIComponent(invitationId)}`,
    ),
  acceptCollaboratorInvitation: (assetId: string, invitationId: string) =>
    apiClient.post<CollaboratorInvitation>(
      `/api/assets/${assetId}/collaborators/invitations/${encodeURIComponent(invitationId)}/accept`,
      {},
    ),
  declineCollaboratorInvitation: (assetId: string, invitationId: string) =>
    apiClient.post<CollaboratorInvitation>(
      `/api/assets/${assetId}/collaborators/invitations/${encodeURIComponent(invitationId)}/decline`,
      {},
    ),
  listMyCollaboratorInvitations: (params?: PageQueryParams) =>
    apiClient
      .get<AssetListResponse<CollaboratorInvitation>>(
        `/api/assets/collaborator-invitations/me${toQuery(params)}`,
      )
      .then(assetItems),
  listWebhooks: (assetId: string, params?: PageQueryParams) =>
    apiClient
      .get<AssetListResponse<AssetWebhook>>(`/api/assets/${assetId}/webhooks${toQuery(params)}`)
      .then(assetItems),
  createWebhook: (assetId: string, input: CreateWebhookInput) =>
    apiClient.post<AssetWebhook>(`/api/assets/${assetId}/webhooks`, input),
  updateWebhook: (assetId: string, webhookId: string, input: UpdateWebhookInput) =>
    apiClient.patch<AssetWebhook>(`/api/assets/${assetId}/webhooks/${webhookId}`, input),
  testWebhook: (assetId: string, webhookId: string) =>
    apiClient.post<AssetWebhook>(`/api/assets/${assetId}/webhooks/${webhookId}/test`),
  deleteWebhook: (assetId: string, webhookId: string) =>
    apiClient.delete<void>(`/api/assets/${assetId}/webhooks/${webhookId}`),
  getModelScopeSyncState: (resourceType: ModelScopeResourceType) =>
    apiClient.get<Record<string, unknown>>(`/api/assets/modelscope/${resourceType}/sync-state`),
  syncModelScope: (resourceType: ModelScopeResourceType, input?: ModelScopeSyncInput) =>
    apiClient.post<ModelScopeSyncResult>(`/api/assets/modelscope/${resourceType}/sync`, input ?? {}),
  streamModelScopeSync: (
    resourceType: ModelScopeResourceType,
    input: ModelScopeSyncInput | undefined,
    onEvent: (event: ModelScopeSyncStreamEvent) => void,
  ) => streamModelScopeSync(resourceType, input ?? {}, onEvent),

  listDiagnosisReports: (owner: string, name: string) =>
    apiClient.get<AssetDiagnosisReport[]>(
      `/api/assets/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/diagnose/reports`,
    ),
  getDiagnosisReport: (owner: string, name: string, reportId: string) =>
    apiClient.get<AssetDiagnosisReport>(
      `/api/assets/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/diagnose/reports/${encodeURIComponent(
        reportId,
      )}`,
    ),
  getLatestDiagnosisReport: (owner: string, name: string, mode?: "diagnose" | "optimize") =>
    apiClient.get<AssetDiagnosisReport | null>(
      `/api/assets/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/diagnose/latest${toQuery({ mode })}`,
    ),
  applyDiagnosisPatches: (owner: string, name: string, reportId: string, paths: string[]) =>
    apiClient.post<ApplyDiagnosisPatchesResult>(
      `/api/assets/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/diagnose/reports/${encodeURIComponent(
        reportId,
      )}/apply`,
      { paths },
    ),
  acknowledgeDiagnosisReport: (owner: string, name: string, reportId: string) =>
    apiClient.post<AssetDiagnosisReport>(
      `/api/assets/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/diagnose/reports/${encodeURIComponent(
        reportId,
      )}/acknowledge`,
      {},
    ),
  /**
   * 一键自动化(止于 PR):为报告每条 finding 建 git issue,应用全部待修复补丁生成
   * 修复 PR 并以 Closes #N 关联;不自动合并,PR 等人审阅。
   */
  automateDiagnosisRemediation: (owner: string, name: string, reportId: string) =>
    apiClient.post<{
      report: AssetDiagnosisReport;
      issues: Array<{ number: number; title: string }>;
      pullRequest?: DiagnosePullRequestSummary;
      branch?: string;
      commitSha?: string;
    }>(
      `/api/assets/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/diagnose/reports/${encodeURIComponent(
        reportId,
      )}/automate`,
      {},
    ),
  countPartialDiagnosisReports: (owner: string, name: string) =>
    apiClient.get<{ partialCount: number }>(
      `/api/assets/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/diagnose/reports/partial-count`,
    ),
  cleanupPartialDiagnosisReports: (owner: string, name: string) =>
    apiClient.post<{ deletedCount: number; deletedIds: string[] }>(
      `/api/assets/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/diagnose/reports/cleanup-partial`,
      {},
    ),
};

async function getCommitDiff(assetId: string, sha: string): Promise<string> {
  const response = await apiRawFetch(`/api/assets/${assetId}/commits/${encodeURIComponent(sha)}/diff`, {
    headers: {
      Accept: "application/json, text/plain",
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `加载提交差异失败：${response.status} ${response.statusText}`);
  }

  try {
    const parsed = JSON.parse(text) as { data?: unknown; diff?: unknown };
    const value = parsed.data ?? parsed.diff ?? parsed;
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return text;
  }
}

async function getAssetBlob(path: string): Promise<Blob> {
  const response = await apiRawFetch(path, {
    headers: {
      Accept: "application/octet-stream, application/zip, application/gzip",
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `下载文件失败：${response.status} ${response.statusText}`);
  }
  return response.blob();
}

/**
 * 资产 Logo 的展示地址（GET /api/assets/:id/logo），相对 api base 解析,
 * 自适配 cloud / desktop / 自定义 PUBLIC_API_BASE_URL。未设置 Logo 时该地址
 * 返回 404,调用方应在 <img onError> 中回退到分类图标。
 */
export function assetLogoUrl(id: string): string {
  return apiUrl(`/api/assets/${id}/logo`);
}

/**
 * 上传资产 Logo —— 与 uploadAssetPackage 同构,走原始二进制 body(Content-Type 即图片类型),
 * 不引入 multipart/FormData 依赖。后端按 repo:write 鉴权,以 assetId 为键写入对象存储。
 */
async function uploadAssetLogo(assetId: string, file: File): Promise<void> {
  const response = await apiRawFetch(`/api/assets/${assetId}/logo`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  const text = await response.text();
  let businessCode: number | undefined;
  try {
    businessCode = text ? (JSON.parse(text) as { code?: number }).code : undefined;
  } catch {
    businessCode = undefined;
  }
  const failed = !response.ok || (typeof businessCode === "number" && businessCode >= 400);
  if (failed) {
    throw new Error(parseUploadErrorMessage(text, `上传 Logo 失败：${response.status} ${response.statusText}`));
  }
}

async function uploadAssetPackage(
  assetId: string,
  file: File,
  input?: { name?: string; version?: string },
): Promise<AssetPackage> {
  const params = new URLSearchParams();
  if (input?.name) params.set("name", input.name);
  if (input?.version) params.set("version", input.version);
  const response = await apiRawFetch(`/api/assets/${assetId}/packages/upload${params.toString() ? `?${params}` : ""}`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Package-Name": input?.name || file.name,
      ...(input?.version ? { "X-Package-Version": input.version } : {}),
    },
    body: file,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(parseUploadErrorMessage(text, `上传 Package 失败：${response.status} ${response.statusText}`));
  }
  try {
    const parsed = JSON.parse(text) as { data?: AssetPackage } | AssetPackage;
    return "data" in parsed && parsed.data ? parsed.data : (parsed as AssetPackage);
  } catch {
    throw new Error("上传成功但响应格式无法解析");
  }
}

function parseUploadErrorMessage(text: string, fallback: string): string {
  return parseResponseErrorMessage(text, fallback);
}

function parseResponseErrorMessage(text: string, fallback: string): string {
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text) as {
      message?: unknown;
      error?: unknown;
      details?: unknown;
      data?: { message?: unknown };
    };
    const message = parsed.message ?? parsed.data?.message ?? parsed.error ?? parsed.details;
    if (Array.isArray(message)) return message.filter(Boolean).join("；") || fallback;
    if (typeof message === "string" && message.trim()) return message;
  } catch {
    // The upload endpoint may return plain text for proxy or storage errors.
  }
  return text || fallback;
}

async function streamModelScopeSync(
  resourceType: ModelScopeResourceType,
  input: ModelScopeSyncInput,
  onEvent: (event: ModelScopeSyncStreamEvent) => void,
): Promise<ModelScopeSyncResult> {
  const response = await apiRawFetch(`/api/assets/modelscope/${resourceType}/sync/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `同步请求失败：${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error("浏览器不支持读取同步日志流");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ModelScopeSyncResult | undefined;

  const consumeBlock = (block: string) => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    const event = JSON.parse(data) as ModelScopeSyncStreamEvent;
    onEvent(event);
    if (event.type === "result") {
      result = event.result;
    }
    if (event.type === "error") {
      throw new Error(event.message);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    blocks.forEach(consumeBlock);
    if (done) break;
  }

  if (buffer.trim()) {
    consumeBlock(buffer);
  }
  if (!result) {
    throw new Error("同步结束但没有返回结果");
  }
  return result;
}

function toQuery(params?: PageQueryParams | Record<string, unknown>) {
  const search = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}

function assetItems<T>(response: AssetListResponse<T>): T[] {
  return Array.isArray(response) ? response : response.items;
}
