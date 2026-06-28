import { apiClient } from "@/lib/api/client";
import type { PaginatedResponse } from "@/lib/shared";

export type PackageType = "agent" | "knowledge" | "skill" | "mcp" | "tool" | "code" | "memory" | "model";
export type PackageFormat = "oci" | "zip" | "json" | "markdown" | "pypi" | "npm";
export type PackageDistributionKind = "hosted-oci-image" | "external-oci-image" | "oci-artifact";

export interface MarketplacePackage {
  id: string;
  name: string;
  version: string;
  type: PackageType;
  format: PackageFormat;
  description?: string;
  downloadUrl?: string;
  publisher?: string;
  distributionKind?: PackageDistributionKind;
  hostedImage?: boolean;
  externalImage?: string;
  packageKind?: string;
  agentName?: string;
  agentUid?: string;
  avatarType?: "nice-avatar" | "image";
  avatarConfig?: Record<string, unknown>;
  avatarImageUrl?: string;
  downloadCount: number;
  starCount: number;
  catalogProfile?: MarketplaceCatalogProfile;
  publishedAt: string;
  /** 智能体子类型，仅 type='agent' 时返回 */
  agentKind?: "tool" | "application" | "agentic";
}

export interface MarketplaceCatalogProfile {
  displayName?: string;
  summary?: string;
  tags?: string[];
  rating?: number;
  ratingCount?: number;
  downloadCount?: number;
  usageCount?: number;
  level?: string;
  scenario?: string;
  ownerDisplayName?: string;
  skill?: {
    runtime?: string;
    entrypoint?: string;
    supportedInputs?: string[];
    supportedOutputs?: string[];
  };
}

export interface MarketplaceCategory {
  type: PackageType;
  label: string;
  count: number;
}

export interface AgentMarketplacePackageCandidate {
  repository: string;
  latestVersion?: string | null;
  versionCount: number;
  sizeBytes: number;
  distributionKind?: PackageDistributionKind;
  hostedImage?: boolean;
  externalImage?: string;
  packageKind?: string;
  updatedAt?: string | null;
}

export interface AgentMarketplaceListing {
  id: string;
  assetId: string;
  packageRepository: string;
  version: string;
  title: string;
  summary?: string;
  agentName: string;
  agentUid: string;
  avatarType: "nice-avatar" | "image";
  avatarConfig?: Record<string, unknown>;
  avatarImageUrl?: string;
  status: "listed" | "unlisted";
  publishedBy: string;
  listedAt?: string;
  unlistedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMarketplaceAssetCandidate {
  assetId: string;
  name: string;
  description?: string;
  ownerId: string;
  ownerType: "user" | "organization";
  canPublish: boolean;
  packages: AgentMarketplacePackageCandidate[];
  listing?: AgentMarketplaceListing;
}

export interface SkillMarketplaceArtifactCandidate {
  id: string;
  name: string;
  version: string;
  sizeBytes: number;
  downloadUrl?: string;
  createdAt: string;
}

export interface SkillMarketplaceListing {
  id: string;
  assetId: string;
  packageId: string;
  artifactId: string;
  title: string;
  summary?: string;
  status: "listed" | "unlisted";
  publishedBy: string;
  listedAt?: string;
  unlistedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillMarketplaceAssetCandidate {
  assetId: string;
  name: string;
  description?: string;
  ownerId: string;
  ownerType: "user" | "organization";
  canPublish: boolean;
  packageId: string;
  artifacts: SkillMarketplaceArtifactCandidate[];
  listing?: SkillMarketplaceListing;
}

export interface PublishAgentListingRequest {
  packageRepository: string;
  version?: string;
  title?: string;
  summary?: string;
  agentName: string;
  agentUid: string;
  avatarType: "nice-avatar" | "image";
  avatarConfig?: Record<string, unknown>;
  avatarImageUrl?: string;
}

export interface PublishSkillListingRequest {
  artifactId: string;
  title?: string;
  summary?: string;
}

export interface SearchMarketplaceParams {
  page?: number;
  limit?: number;
  keyword?: string;
  type?: PackageType;
  sort?: "downloads" | "stars" | "recent" | "rating" | "usage" | "calls" | "successRate" | "latency";
}

type MarketplaceListResponse = MarketplacePackage[] | PaginatedResponse<MarketplacePackage>;
type AgentPublishingCandidateListResponse = AgentMarketplaceAssetCandidate[] | PaginatedResponse<AgentMarketplaceAssetCandidate>;
type SkillPublishingCandidateListResponse = SkillMarketplaceAssetCandidate[] | PaginatedResponse<SkillMarketplaceAssetCandidate>;

function packagePath(id: string): string {
  return encodeURIComponent(id.replace(/^\/+/, ""));
}

function searchParams({ page = 1, limit = 20, keyword, type, sort }: SearchMarketplaceParams = {}): string {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (keyword) params.set("keyword", keyword);
  if (type) params.set("type", type);
  if (sort) params.set("sort", sort);
  return params.toString();
}

function candidateParams(page = 1, limit = 20, keyword?: string): string {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (keyword?.trim()) params.set("keyword", keyword.trim());
  return params.toString();
}

export const marketplaceApi = {
  search: (params?: SearchMarketplaceParams) =>
    apiClient.get<MarketplaceListResponse>(`/api/marketplace?${searchParams(params)}`).then(marketplaceItems),

  searchPage: (params?: SearchMarketplaceParams) =>
    apiClient.get<PaginatedResponse<MarketplacePackage>>(`/api/marketplace?${searchParams(params)}`),

  featured: (page = 1, limit = 12) =>
    apiClient.get<MarketplaceListResponse>(`/api/marketplace/featured?page=${page}&limit=${limit}`).then(marketplaceItems),

  trending: (page = 1, limit = 12) =>
    apiClient.get<MarketplaceListResponse>(`/api/marketplace/trending?page=${page}&limit=${limit}`).then(marketplaceItems),

  recent: (page = 1, limit = 12) =>
    apiClient.get<MarketplaceListResponse>(`/api/marketplace/recent?page=${page}&limit=${limit}`).then(marketplaceItems),

  categories: () => apiClient.get<MarketplaceCategory[]>("/api/marketplace/categories"),

  agentPublishingCandidates: (page = 1, limit = 100) =>
    apiClient.get<AgentPublishingCandidateListResponse>(`/api/marketplace/agents/assets?page=${page}&limit=${limit}`).then(agentPublishingCandidateItems),

  agentPublishingCandidatesPage: (page = 1, limit = 20, keyword?: string) =>
    apiClient.get<PaginatedResponse<AgentMarketplaceAssetCandidate>>(`/api/marketplace/agents/assets?${candidateParams(page, limit, keyword)}`),

  agentPublishingCandidate: (assetId: string) =>
    apiClient.get<AgentMarketplaceAssetCandidate>(`/api/marketplace/agents/assets/${encodeURIComponent(assetId)}`),

  publishAgentListing: (assetId: string, body: PublishAgentListingRequest) =>
    apiClient.post<AgentMarketplaceListing>(`/api/marketplace/agents/assets/${assetId}/listings`, body),

  skillPublishingCandidates: (page = 1, limit = 100) =>
    apiClient.get<SkillPublishingCandidateListResponse>(`/api/marketplace/skills/assets?page=${page}&limit=${limit}`).then(skillPublishingCandidateItems),

  skillPublishingCandidatesPage: (page = 1, limit = 20, keyword?: string) =>
    apiClient.get<PaginatedResponse<SkillMarketplaceAssetCandidate>>(`/api/marketplace/skills/assets?${candidateParams(page, limit, keyword)}`),

  skillPublishingCandidate: (assetId: string) =>
    apiClient.get<SkillMarketplaceAssetCandidate>(`/api/marketplace/skills/assets/${encodeURIComponent(assetId)}`),

  publishSkillListing: (assetId: string, body: PublishSkillListingRequest) =>
    apiClient.post<SkillMarketplaceListing>(`/api/marketplace/skills/assets/${assetId}/listings`, body),

  relistSkillListing: (id: string) =>
    apiClient.post<SkillMarketplaceListing>(`/api/marketplace/skills/listings/${id}/relist`, {}),

  unlistSkillListing: (id: string) =>
    apiClient.post<SkillMarketplaceListing>(`/api/marketplace/skills/listings/${id}/unlist`, {}),

  relistAgentListing: (id: string) =>
    apiClient.post<AgentMarketplaceListing>(`/api/marketplace/agents/listings/${id}/relist`, {}),

  unlistAgentListing: (id: string) =>
    apiClient.post<AgentMarketplaceListing>(`/api/marketplace/agents/listings/${id}/unlist`, {}),

  get: (id: string) => apiClient.get<MarketplacePackage>(`/api/marketplace/${packagePath(id)}`),

  download: (id: string) => apiClient.get<{ downloadUrl: string }>(`/api/marketplace/${packagePath(id)}/download`),
};

function marketplaceItems(response: MarketplaceListResponse): MarketplacePackage[] {
  return Array.isArray(response) ? response : response.items;
}

function agentPublishingCandidateItems(response: AgentPublishingCandidateListResponse): AgentMarketplaceAssetCandidate[] {
  return Array.isArray(response) ? response : response.items;
}

function skillPublishingCandidateItems(response: SkillPublishingCandidateListResponse): SkillMarketplaceAssetCandidate[] {
  return Array.isArray(response) ? response : response.items;
}
