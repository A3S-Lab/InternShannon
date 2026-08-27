interface TableRelationLike {
    sourceColumn?: unknown;
    targetPath?: unknown;
    targetColumn?: unknown;
    confidence?: unknown;
}

interface TableSummaryLike {
    assetId?: unknown;
    path?: unknown;
    title?: unknown;
    columns?: unknown;
    primaryKey?: unknown;
    recordIds?: unknown;
    resource?: unknown;
    aliases?: unknown;
    relations?: unknown;
    recordCount?: unknown;
}

export interface KnowledgeGroundingPlan {
    identifiers: string[];
    sources: Record<string, unknown>[];
    diagnostics: Array<{ path: string; score: number; reasons: string[] }>;
    obligations: KnowledgeRetrievalObligation[];
}

export type KnowledgeRetrievalObligationKind =
    | "catalog_inventory"
    | "exact_identifier"
    | "foreign_key_filter"
    | "route_topology"
    | "route_support"
    | "exhaustive_list"
    | "semantic_facet";

export interface KnowledgeRetrievalObligation {
    id: string;
    kind: KnowledgeRetrievalObligationKind;
    query: string;
    identifiers: string[];
    sourcePaths: string[];
    /** Catalog-bound source identities (`assetId:path`). */
    sourceKeys?: string[];
    filters?: Array<{
        column: string;
        value: string;
        targetPath?: string;
        targetColumn?: string;
        confidence: "primary_key" | "declared" | "high";
    }>;
    /** Mechanical two-stage contract for a scope-specific route state source. */
    routeScope?: KnowledgeRouteScopeContract;
    completion:
        | "catalog_verified"
        | "record_verified"
        | "all_sources_verified"
        | "cursor_exhausted"
        | "readable_evidence";
}

export interface KnowledgeRouteScopeBinding {
    overlaySourcePath: string;
    overlaySourceKey?: string;
    overlayScopeColumn: string;
    ownerSourcePath: string;
    ownerSourceKey?: string;
    ownerPrimaryKey: string;
    descriptorColumns: string[];
    selectors?: Array<{
        sourcePath: string;
        sourceKey?: string;
        primaryKey: string;
        scopeColumn: string;
        identifier: string;
    }>;
}

export interface KnowledgeRouteScopeResolution {
    bindingIndex: number;
    value: string;
    method: "exact_identifier" | "exact_relation" | "unique_descriptor";
}

export interface KnowledgeRouteScopeContract {
    role: "state_overlay" | "descriptor_owner";
    /** Natural-language scopes stay unresolved until the owner read is verified. */
    requiresUniqueResolution: boolean;
    bindings: KnowledgeRouteScopeBinding[];
    /** Added by the runner only after a verified owner row resolves uniquely. */
    resolution?: KnowledgeRouteScopeResolution;
}

export type KnowledgeStructuredScalar = string | number | boolean;

export interface KnowledgeStructuredGroundingRequest {
    assetId?: string;
    from: string;
    select?: string[];
    filters?: Array<{
        column: string;
        op: "eq" | "in" | "contains" | "gt" | "gte" | "lt" | "lte";
        value: KnowledgeStructuredScalar | KnowledgeStructuredScalar[];
    }>;
    aggregates?: Array<{ op: "count" | "sum" | "min" | "max"; column?: string; as: string }>;
    joins?: Array<{
        targetPath: string;
        sourceColumn: string;
        targetColumn: string;
        type: "inner";
    }>;
    orderBy?: Array<{ column: string; direction: "asc" | "desc" }>;
    limit: number;
}

export interface KnowledgeStructuredGroundingPlan {
    confidence: "high";
    kind: "aggregate" | "filter" | "join" | "enumeration";
    reasons: string[];
    request: KnowledgeStructuredGroundingRequest;
    /** True when the catalog has more columns than the bounded projection sent to the query service. */
    projectionTruncated: boolean;
    /** True when the user explicitly requested an exhaustive result. */
    exhaustive: boolean;
    /** Bounded catalog evidence proves the non-aggregate result fits one complete page. */
    exhaustiveWithinKnownBounds: boolean;
    /** Non-aggregate exhaustive results close only after the signed cursor is exhausted. */
    completion: "single_result" | "cursor_exhausted";
}

const STRUCTURED_AGGREGATE_SIGNALS = [
    /(?:总和|合计|加总|\bsum\b)/iu,
    /(?:最大|最高|\bmax(?:imum)?\b)/iu,
    /(?:最小|最低|\bmin(?:imum)?\b)/iu,
    /(?:符合.{0,16}多少|共有|总共|总数|记录数|\bcount\b|\bhow\s+many\b)/iu,
] as const;

function escapedLiteral(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const KNOWLEDGE_OUTPUT_ONLY_CLAUSE = [
    /^(?:(?:答案|回答|结果|正文|篇幅|字数)\s*)?(?:请\s*)?(?:控制|限制)在?\s*\d+\s*(?:个)?字(?:以内|之内|以下|内)?$/iu,
    /^(?:(?:答案|回答|结果|正文|篇幅|字数)\s*)?(?:请\s*)?(?:不超过|少于|最多)\s*\d+\s*(?:个)?字$/iu,
    /^(?:请\s*)?(?:保持|尽量)?(?:简洁|简短|精简| concise|brief)$/iu,
    // A top-level splitter can separate a conditional presentation guard from
    // its checklist instruction. Both closed fragments remain output-only;
    // any factual tail falls outside these anchors and stays retrievable.
    /^(?:(?:若|如果)(?:无|没有|未发现|不存在)(?:上述|以上|相关)?(?:问题|异常|遗漏|缺失|风险|情况)?|(?:if|when)\s+(?:none|nothing|no\s+(?:issue|problem|omission|gap|risk)s?)(?:\s+(?:is|are)\s+found)?)$/iu,
    /^(?:(?:(?:若|如果)(?:无|没有|未发现|不存在)(?:上述|以上|相关)?(?:问题|异常|遗漏|缺失|风险|情况)?[\s，,]*)?(?:(?:也要|则|请|需要|必须)\s*)?(?:给出|提供|列出|生成)(?:一份)?(?:检查|核对|审计)?清单(?:及|以及|和|与|并附)(?:逐项)?(?:结论|结果)(?:即可)?|(?:(?:if|when)\s+(?:none|nothing|no\s+(?:issue|problem|omission|gap|risk)s?)(?:\s+(?:is|are)\s+found)?[,\s]*)?(?:please\s+)?(?:provide|give|list|produce)\s+(?:a\s+)?(?:review\s+|audit\s+|check\s+)?checklist\s+(?:and|with)\s+(?:item[-\s]by[-\s]item\s+)?(?:conclusions?|results?))$/iu,
    /^(?:请\s*)?(?:提供|附上|给出)?\s*(?:准确|对应|可打开|可点击|可定位)?\s*(?:的)?\s*(?:来源|引用|来源卡片)$/iu,
    /^(?:每(?:一)?(?:点|项|条|个结论)|各(?:点|项|条)|逐(?:项|点|条)|分别)?\s*(?:请\s*)?(?:给出|提供|附上|标注|注明|保留|显示)\s*(?:(?:具体|准确|对应|可打开|可点击|可定位|离线)\s*)*(?:(?:(?:来源|记录|source|record)\s*(?:ID|编号|定位)|文件(?:名)?|来源|引用|来源卡片)(?:\s*(?:和|及|与|、|,)\s*)?)+(?:即可|就行)?$/iu,
    // A mandatory modal and a closed set of evidence referents still shape
    // presentation; they do not create another fact to retrieve.
    /^(?:(?:每(?:一)?(?:点|项|条|个结论)|各(?:点|项|条)|逐(?:项|点|条)|分别)\s*)?(?:(?:请|必须|务必|应当|应)\s*)*(?:给出|提供|附上|标注|注明|保留|显示)\s*(?:(?:(?:上述|以上|前述|此前|之前|当前|本次|本轮|最终|对应|相关|该|这些|此)\s*)?(?:限制状态|结论|事实|状态|回答|答复|结果|方案|内容)的\s*)?(?:(?:(?:具体|精确|准确|对应|可打开|可点击|可定位|离线|稳定)\s*)*(?:(?:来源|记录)\s*(?:ID|编号|定位)|文件(?:名)?|来源|引用|来源卡片)(?:\s*(?:和|及|与|、|,)\s*)?)+(?:即可|就行)?$/iu,
    /^(?:please\s+)?(?:(?:must|should)\s+)?(?:include|provide|attach|cite|preserve|retain|show|display)\s+(?:(?:the|a|an|corresponding|exact|precise|stable|openable)\s+)*(?:(?:record|source)\s+(?:id|identifier)|file\s+name|source|citation|source\s+card)(?:\s*(?:and|,)\s*(?:(?:the|a|an|corresponding|exact|precise|stable|openable)\s+)*(?:(?:record|source)\s+(?:id|identifier)|file\s+name|source|citation|source\s+card))*[.!?]?$/iu,
    /^(?:请\s*)?(?:四舍五入到|保留)\s*\d+(?:\.\d+)?\s*(?:位小数|分钟|秒)?$/iu,
    /^(?:请\s*)?(?:不要|无需)(?:展示|输出|解释|展开)?\s*(?:思维链|推理过程|检索过程|工具过程)$/iu,
] as const;

/**
 * Keep the closed presentation-only grammar shared by every planner boundary.
 * Callers that inspect raw top-level clauses must not reinterpret a clause that
 * retrieval planning has already removed as an unmodeled factual duty.
 */
export function isKnowledgeOutputOnlyClause(value: string): boolean {
    const normalized = value
        .normalize("NFKC")
        .trim()
        .replace(/[\s，,；;。！？!?]+$/u, "")
        .trim();
    return normalized.length > 0 && KNOWLEDGE_OUTPUT_ONLY_CLAUSE.some((pattern) => pattern.test(normalized));
}

// A standalone source-boundary instruction constrains where evidence may come
// from; it is not itself an information need. Keep this deliberately anchored
// to the complete English clause so a mixed request such as "find ITEM-42 using
// only my personal knowledge base" remains searchable and fail-closed.
const KNOWLEDGE_SOURCE_ONLY_CLAUSE =
    /^(?:please\s+)?(?:(?:(?:use|consult)\s+only|only\s+(?:use|consult)|rely\s+only\s+on|answer\s+only\s+(?:using|from|with|based\s+on)|answer\s+(?:using|from|with|based\s+on)\s+only)\s+(?:(?:my|the)\s+)?personal\s+knowledge\s+base)[.!?]?$/iu;

function withoutStandaloneKnowledgeSourceClauses(value: string): string {
    // The main splitter intentionally does not treat every ASCII period as a
    // boundary because filenames and decimal values contain periods. A period
    // followed by whitespace is nevertheless a safe boundary for this narrow,
    // fully anchored English instruction.
    return value
        .split(/(?<=\.)\s+/u)
        .filter((segment) => !KNOWLEDGE_SOURCE_ONLY_CLAUSE.test(segment.trim()))
        .join(" ")
        .trim();
}

const KNOWLEDGE_PURPOSE_OR_REASON_PREFIX =
    /^(?:为了|为便于|为避免|以便|旨在|出于|鉴于|考虑到|由于|因为|目标是|目的是|\b(?:because|given\s+that|in\s+order\s+to|for\s+the\s+purpose\s+of)\b)/iu;

const KNOWLEDGE_NEGATIVE_RETRIEVAL_CLAUSE =
    /^(?:请\s*)?(?:不要|不得|禁止|无需|不需要|排除)(?:使用|查询|检索|读取|搜索|计算|引用|包含|把|将)?/iu;

type KnowledgeQuerySplitMode = "clause" | "facet";

const KNOWLEDGE_GROUP_CLOSERS: Readonly<Record<string, string>> = {
    "(": ")",
    "[": "]",
    "{": "}",
    "【": "】",
    "“": "”",
    "‘": "’",
    "「": "」",
    "『": "』",
    "《": "》",
    "〈": "〉",
    '"': '"',
    "'": "'",
    "`": "`",
};

function isEscapedCharacter(value: string, index: number): boolean {
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) backslashes += 1;
    return backslashes % 2 === 1;
}

function knowledgeFacetConnectorLength(value: string, index: number): number {
    for (const connector of ["以及", "并且", "同时", "分别"] as const) {
        if (value.startsWith(connector, index)) return connector.length;
    }
    const match = /^(?:also|and)\b/iu.exec(value.slice(index));
    if (!match) return 0;
    const previous = value[index - 1];
    return !previous || !/[\p{L}\p{N}_]/u.test(previous) ? match[0].length : 0;
}

/**
 * Split only at top-level separators. Quoted questions, inline code and
 * parenthesized lists are one semantic unit even when they contain commas,
 * question marks or enumeration punctuation.
 */
function splitKnowledgeQuery(value: string, mode: KnowledgeQuerySplitMode): string[] {
    const normalized = value.normalize("NFKC");
    const segments: string[] = [];
    const closers: string[] = [];
    let buffer = "";
    const flush = () => {
        const segment = buffer.trim();
        if (segment) segments.push(segment);
        buffer = "";
    };

    for (let index = 0; index < normalized.length; ) {
        const character = normalized[index];
        const escaped = isEscapedCharacter(normalized, index);
        const apostropheInsideWord =
            character === "'" &&
            /[\p{L}\p{N}]/u.test(normalized[index - 1] ?? "") &&
            /[\p{L}\p{N}]/u.test(normalized[index + 1] ?? "");
        const activeCloser = closers.at(-1);
        if (activeCloser && character === activeCloser && !escaped && !apostropheInsideWord) {
            closers.pop();
            buffer += character;
            index += 1;
            continue;
        }
        const closer = KNOWLEDGE_GROUP_CLOSERS[character];
        if (closer && !escaped && !apostropheInsideWord) {
            closers.push(closer);
            buffer += character;
            index += 1;
            continue;
        }

        if (closers.length === 0) {
            if (character === "\r" || character === "\n") {
                flush();
                index += character === "\r" && normalized[index + 1] === "\n" ? 2 : 1;
                continue;
            }
            const isClauseSeparator = /[，,；;。！？!?]/u.test(character);
            const isFacetSeparator = mode === "facet" && character === "、";
            if (isClauseSeparator || isFacetSeparator) {
                flush();
                index += 1;
                continue;
            }
            if (mode === "facet") {
                const connectorLength = knowledgeFacetConnectorLength(normalized, index);
                if (connectorLength > 0) {
                    flush();
                    index += connectorLength;
                    continue;
                }
            }
        }

        buffer += character;
        index += 1;
    }
    flush();
    return segments;
}

/**
 * Require an explicit retrieval/enumeration action, an all-items qualifier and
 * a record-like collection in the same clause. This keeps pagination duties
 * for true complete-list requests without treating words such as "完整路线",
 * "全部撤到", a fixed item count, or a field/schema request as exhaustive.
 */
export function isKnowledgeExhaustiveRequest(value: string): boolean {
    const actionSignal =
        /(?:列出|列举|枚举|查找|找出|检索|搜索|读取|返回|展示|核对|检查|验证|\b(?:list|enumerate|find|search|retrieve|read|return|show|review|verify|check)\b)/iu;
    const allItemsSignal = /(?:全部|所有|全量|穷尽|每(?:一)?(?:条|个|份|行)|逐条|逐一|\b(?:all|every|exhaustive)\b)/iu;
    const completeActionSignal =
        /(?:完整(?:地)?\s*(?:列出|列举|枚举|查找|找出|检索|搜索|读取|返回|展示|核对|检查|验证)|\b(?:complete|full)\s+(?:list|enumeration|search|retrieval|read|review)\b)/iu;
    const collectionSignal =
        /(?:记录|数据(?:行|集)?|条目|文档|文件|资料|来源|结果|实体|对象|内容|\b(?:records?|rows?|entries|items?|documents?|files?|sources?|results?|entities|objects?|contents?|datasets?)\b|\.(?:csv|tsv|jsonl?|md|txt)\b)/iu;
    const explicitWholeIndexScope =
        /(?:知识库|knowledge\s*base)\s*[((（]\s*(?:全量|穷尽|complete|full|exhaustive)\s*[)）]/iu;

    return splitKnowledgeQuery(value, "clause").some(
        (clause) =>
            actionSignal.test(clause) &&
            (explicitWholeIndexScope.test(clause) ||
                knowledgeAllRelatedCollectionRequested(clause) ||
                (collectionSignal.test(clause) && (allItemsSignal.test(clause) || completeActionSignal.test(clause)))),
    );
}

/**
 * Keep presentation and negative-scope instructions in the model request while
 * excluding them from search, facet and completeness planning. A mixed clause
 * that still asks for records, fields or an explanation is retained verbatim.
 */
export function knowledgeRetrievalIntentText(value: string): string {
    const clauses = splitKnowledgeQuery(value, "clause").map(withoutStandaloneKnowledgeSourceClauses).filter(Boolean);
    const substantiveSignal =
        /(?:查询|检索|搜索|查找|找出|读取|说明|解释|为什么|为何|谁|什么|哪些|哪个|如何|怎么|是否|能否|多少|盘点|统计|列出|逐条|全部|所有|记录|字段|实体|对象|关系|属性|表|文档|条目|状态|关联|对应|覆盖|\b(?:find|search|read|explain|why|who|what|which|how|whether|count|list|record|field|entity|relation|join)\b)/iu;
    return clauses
        .filter((clause) => {
            if (isKnowledgeOutputOnlyClause(clause)) return false;
            if (KNOWLEDGE_SOURCE_ONLY_CLAUSE.test(clause)) return false;
            if (
                KNOWLEDGE_NEGATIVE_RETRIEVAL_CLAUSE.test(clause) &&
                !substantiveSignal.test(clause.replace(KNOWLEDGE_NEGATIVE_RETRIEVAL_CLAUSE, ""))
            ) {
                return false;
            }
            return true;
        })
        .join("。")
        .trim();
}

/**
 * Detect a request that needs evidence for a decision, state, path or action,
 * without coupling relation recall to any project vocabulary. The caller still
 * needs an explicit catalog-owned identifier before this can expand relation
 * reads.
 */
export function isKnowledgeDecisionOrActionRequest(value: string): boolean {
    const query = knowledgeRetrievalIntentText(value);
    return /(?:如何|怎么(?:做|办|处理)?|怎样|应当|应该|应否|是否需要|建议|方案|行动|操作|步骤|下一步|接下来|状态|路径|路线|决策|决定|选择|处理方式|安排|\b(?:how\s+to|what\s+should|should|recommend(?:ation)?|plan|action|steps?|next\s+step|status|path|route|decision|decide|choose)\b)/iu.test(
        query,
    );
}

/**
 * Detect requests whose answer depends on graph topology rather than one
 * independently readable fact. This intentionally uses only generic route,
 * path, node and edge vocabulary; catalog schema must still prove which
 * sources, if any, contain the graph.
 */
export function isKnowledgeRouteOrTopologyRequest(value: string): boolean {
    const query = knowledgeRetrievalIntentText(value);
    return /(?:路线|路径|通路|连通|可达|到达|怎么(?:走|到|撤|出去)|(?:从|往)?哪里出去|节点|顶点|连接边|关联边|边是否存在|\b(?:route|path|travel|navigate|destination|way\s*out|reachable|reachability|topology|graph|nodes?|vertices|edges?|links?)\b)/iu.test(
        query,
    );
}

/**
 * Prove that a structured plan covers the whole user request before allowing it
 * to suppress auxiliary search/catalog truncation. This deliberately accepts a
 * small, explicit grammar: false negatives remain safely partial, while unknown
 * prose (for example "and translate" or "and compare another file") can never
 * turn a partial retrieval into a false complete claim.
 */
export function isKnowledgeStructuredPlanSoleObligation(
    query: string,
    plan: KnowledgeStructuredGroundingPlan,
): boolean {
    const retrievalQuery = knowledgeRetrievalIntentText(query);
    const aggregateSignals = STRUCTURED_AGGREGATE_SIGNALS.filter((signal) => signal.test(retrievalQuery));
    const aggregates = plan.request.aggregates ?? [];
    const enumerationSignal =
        /(?:列出|列表|逐条|逐一|每一|全部|所有|完整|全量|穷尽|\blist\b|\ball\b|\bevery\b|\bcomplete\b)/iu.test(
            retrievalQuery,
        );
    if (aggregates.length > 1 || aggregateSignals.length > 1) return false;
    if (aggregates.length === 1 && aggregateSignals.length !== 1) return false;
    if (aggregates.length > 0 && enumerationSignal) return false;

    let remainder = retrievalQuery.toLowerCase();
    const literals = new Set<string>();
    const addLiteral = (value: unknown) => {
        if (typeof value !== "string") return;
        const normalized = value.normalize("NFKC").trim().toLowerCase();
        if (normalized) literals.add(normalized);
    };
    const addPathLiterals = (value: unknown) => {
        if (typeof value !== "string") return;
        addLiteral(value);
        const basename = value.split("/").at(-1) ?? value;
        addLiteral(basename);
        addLiteral(basename.replace(/\.csv$/iu, ""));
    };
    addPathLiterals(plan.request.from);
    for (const selected of plan.request.select ?? []) addLiteral(selected);
    for (const filter of plan.request.filters ?? []) {
        addLiteral(filter.column);
        const values = Array.isArray(filter.value) ? filter.value : [filter.value];
        for (const value of values) addLiteral(String(value));
    }
    for (const aggregate of aggregates) {
        addLiteral(aggregate.column);
        addLiteral(aggregate.as);
    }
    for (const join of plan.request.joins ?? []) {
        addPathLiterals(join.targetPath);
        addLiteral(join.sourceColumn);
        addLiteral(join.targetColumn);
    }
    for (const order of plan.request.orderBy ?? []) addLiteral(order.column);
    for (const literal of [...literals].sort((left, right) => right.length - left.length)) {
        // A plan field is evidence for consuming one structural occurrence only.
        // Global replacement could erase a second, independent obligation whose
        // text happens to equal a filter value (for example `status=分析 且分析`).
        remainder = remainder.replace(new RegExp(escapedLiteral(literal), "iu"), " ");
    }

    // Only syntax and framing already represented by the verified plan may be
    // discarded. Semantic action words such as translate/summarize/analyse are
    // intentionally absent and therefore leave a non-empty remainder.
    remainder = remainder
        .replace(
            /(?:请帮我|帮我|请|从|在|我的|个人|知识库|中|里|内|统计一下|统计|计算|求|只|仅|符合|满足|的|记录|数据|行|项|结果|数量|总数|记录数|共有|总共|多少|个|条|所有|全部|完整|全量|列出|列表|逐条|逐一|每一|联表|关联|对应|连接|匹配|与|和|以及|且|并且|同时|按|字段|排序|升序|降序|为|是|等于|包含|大于|小于|不小于|不大于|大于等于|小于等于|最大|最高|最小|最低|总和|合计|加总|以|json|格式)/giu,
            " ",
        )
        .replace(
            /\b(?:please|from|in|my|personal|knowledge|base|count|sum|max(?:imum)?|min(?:imum)?|how|many|records?|rows?|items?|data|where|with|that|are|is|equals?|contains?|greater|less|than|and|only|all|every|list|join|relate|related|match|order|by|asc|ascending|desc|descending|result|results|as|json|format)\b/giu,
            " ",
        )
        .replace(/[\s\p{P}\p{S}]+/gu, "");
    return remainder.length === 0;
}

const MAX_STRUCTURED_QUERY_COLUMNS = 12;
const STRUCTURED_QUERY_PAGE_SIZE = 25;

/** Detect questions that may use bounded table-catalog metadata. */
export function isKnowledgeCatalogInventoryQuery(value: string): boolean {
    const retrievalQuery = knowledgeRetrievalIntentText(value);
    return /(?:盘点|统计|数量|总数|多少(?:个|条|项|行|张|份)?|记录数|表结构|字段|主键|inventory|record\s*count|row\s*count|schema)/iu.test(
        retrievalQuery,
    );
}

/**
 * Distinguish a whole-catalog obligation from a count/schema operation scoped
 * to a literally named CSV. A source-scoped aggregate still uses catalog/read
 * metadata to build a revision-pinned query, but unrelated catalog pages are
 * not part of its answer. Unscoped counts and explicit all-table requests stay
 * fail-closed when the catalog is incomplete.
 */
export function isKnowledgeGlobalCatalogInventoryQuery(value: string): boolean {
    const retrievalQuery = knowledgeRetrievalIntentText(value);
    if (!isKnowledgeCatalogInventoryQuery(retrievalQuery)) return false;
    const explicitlyNamedCsv = /\.csv(?![A-Za-z0-9_.-])/iu.test(retrievalQuery);
    const explicitWholeCatalogScope =
        /(?:各|所有|全部|全量|每(?:一)?)(?:个|张|份)?(?:表|文件|来源)|(?:整个|全局|全库|整库)(?:知识库|目录|索引)?|\b(?:all|every)\s+(?:tables?|files?|sources?)\b|\b(?:whole|entire|global)\s+(?:catalog|inventory|knowledge\s*base)\b/iu.test(
            retrievalQuery,
        );
    return explicitWholeCatalogScope || !explicitlyNamedCsv;
}

/** Count independent question intents without using domain-specific keywords. */
export function knowledgeQueryIntentCount(value: string): number {
    const retrievalQuery = knowledgeRetrievalIntentText(value);
    const questionSignal =
        /(?:为什么|为何|谁|什么|哪些|哪(?:个|些)?|如何|怎么|是否|能否|多少|何时|哪里|why|who|what|which|how|when|where|whether)/iu;
    return splitKnowledgeQuery(retrievalQuery, "facet")
        .map((item) => item.trim().replace(/^(?:(?:请|再|还要|另请|并请|说明)\s*)+/u, ""))
        .filter((item) => item.length >= 3 && questionSignal.test(item)).length;
}

/**
 * Extract at most a few positive information facets for bounded secondary searches.
 * Constraints (for example, "do not use X") stay in the original query and are
 * deliberately not turned into recall-expanding searches.
 */
export function knowledgeQueryFacets(value: string, maxFacets = 3): string[] {
    const candidates = splitKnowledgeQuery(knowledgeRetrievalIntentText(value), "facet")
        .map((item) => item.trim())
        .filter((item) => !KNOWLEDGE_SOURCE_ONLY_CLAUSE.test(item))
        .filter((item) => !/^(?:不要|不得|禁止|仅|只|请按|按|逐项|逐一|依次|要求|输出|避免|排除)/u.test(item))
        .map((item) => item.replace(/^(?:(?:请|再|还要|另请|并请|说明)\s*)+/u, ""))
        .filter((item) => item.length >= 4 && item.length <= 180)
        .filter((item) => !/^(?:不要|不得|禁止|仅|只|按|逐项|逐一|依次|要求|输出|避免|排除)/u.test(item));
    const unique = Array.from(new Set(candidates));
    return unique
        .map((facet, index) => ({
            facet,
            index,
            // A standalone purpose/reason is useful fallback context when it is
            // the only clause, but must not evict an independent information
            // question from the bounded facet budget.
            score:
                Math.min(facet.length, 120) +
                genericKnowledgeIdentifierCandidates(facet).length * 20 -
                (KNOWLEDGE_PURPOSE_OR_REASON_PREFIX.test(facet) ? 200 : 0),
        }))
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .slice(0, Math.max(0, maxFacets))
        .sort((left, right) => left.index - right.index)
        .map((item) => item.facet);
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
}

function queryTokens(value: string): string[] {
    return Array.from(
        new Set(
            (value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,}/gu) ?? []).filter((token) => token.length >= 2),
        ),
    ).slice(0, 80);
}

function containsBounded(value: string, candidate: string): boolean {
    if (!candidate) return false;
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}_-])${escaped}(?=$|[^\\p{L}\\p{N}_-])`, "iu").test(value);
}

function containsCompositeIdentifier(value: string, candidate: string): boolean {
    if (!candidate || candidate.length < 3) return false;
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(value);
}

export function genericKnowledgeIdentifierCandidates(value: string): string[] {
    const retrievalValue = knowledgeRetrievalIntentText(value);
    const candidates = new Set<string>();
    for (const match of retrievalValue.matchAll(/记录\s*ID\s*[：:]\s*([^\]\n）)]+)/giu)) {
        for (const item of (match[1] ?? "").split(/[|、,，;；]/u)) {
            const trimmed = item.trim();
            if (trimmed && trimmed.length <= 160) candidates.add(trimmed);
        }
    }
    for (const match of retrievalValue.matchAll(
        /(?:记录(?:\s*(?:ID|编号|号))?|\brecord(?:[\s_-]*id)?)\s*[：:#]?\s*([A-Za-z0-9][A-Za-z0-9_-]{2,159})/giu,
    )) {
        const token = match[1] ?? "";
        // Pure words remain ordinary prose even after a loose "record" noun.
        // A hyphen/underscore is enough only in this explicit record context;
        // elsewhere the generic scanner below still requires letters+digits.
        if (/\d/u.test(token) || /[-_]/u.test(token)) candidates.add(token);
    }
    for (const match of retrievalValue.matchAll(/`([A-Za-z][A-Za-z0-9_-]{1,159})`/gu)) {
        const token = match[1] ?? "";
        // Backticks are an explicit user-side identifier boundary. Accept a
        // stable separator even when the identifier has no digit (for example
        // NODE-W), while still rejecting ordinary inline-code words and
        // filenames. Catalog ownership later decides whether this token creates
        // an exact-record duty, so this broadens recall without inventing facts.
        if (/[-_]/u.test(token) && !/\.[A-Za-z0-9]{1,12}$/u.test(token)) candidates.add(token);
    }
    for (const token of retrievalValue.match(/[A-Za-z0-9][A-Za-z0-9_-]{2,}/g) ?? []) {
        // Outside an explicit "记录 ID" label, require both letters and digits.
        // This rejects incidental counts/timestamps while keeping UUIDs and
        // domain-neutral identifiers such as AC-1042 or INV_2026_004.
        if (token.length <= 160 && /[A-Za-z]/.test(token) && /\d/.test(token)) candidates.add(token);
    }
    return Array.from(candidates).slice(0, 64);
}

function hitPath(hit: Record<string, unknown>): string {
    return typeof hit.path === "string" ? hit.path : "";
}

function sourceIdentity(hit: Record<string, unknown>): string {
    return `${typeof hit.assetId === "string" ? hit.assetId : ""}:${hitPath(hit)}`;
}

function catalogEntries(searchRecord?: Record<string, unknown> | null): TableSummaryLike[] {
    return Array.isArray(searchRecord?.tableSummaries)
        ? searchRecord.tableSummaries.filter(
              (item): item is TableSummaryLike => Boolean(item) && typeof item === "object" && !Array.isArray(item),
          )
        : [];
}

function normalizedQuery(value: string): string {
    return value.normalize("NFKC").toLowerCase();
}

function tableDescriptors(entry: TableSummaryLike): string[] {
    return [
        typeof entry.path === "string" ? entry.path : "",
        typeof entry.title === "string" ? entry.title : "",
        ...stringArray(entry.aliases),
    ].filter(Boolean);
}

type StructuredCatalogTable = TableSummaryLike & { path: string; columns: string[] };

function tableIdentity(entry: Pick<TableSummaryLike, "assetId" | "path">): string {
    return `${typeof entry.assetId === "string" ? entry.assetId : ""}:${typeof entry.path === "string" ? entry.path : ""}`;
}

function boundTableIdentities(entries: Array<Pick<TableSummaryLike, "assetId" | "path">>): string[] {
    return Array.from(
        new Set(
            entries.flatMap((entry) =>
                typeof entry.assetId === "string" &&
                entry.assetId.trim() &&
                typeof entry.path === "string" &&
                entry.path
                    ? [tableIdentity(entry)]
                    : [],
            ),
        ),
    );
}

type RouteEndpointRole = "from" | "to";

interface RouteEndpointColumn {
    column: string;
    role: RouteEndpointRole;
    entityStem: string;
}

function normalizedSchemaColumn(value: string): string {
    return value
        .normalize("NFKC")
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "_")
        .replace(/^_+|_+$/gu, "");
}

function routeEndpointColumn(value: string): RouteEndpointColumn | null {
    const normalized = normalizedSchemaColumn(value);
    const match =
        /^(from|source|origin|to|target|destination)(?:_(.*))?$/u.exec(normalized) ??
        /^(起点|始点|来源|源|终点|目标|目的地)(?:_(.*))?$/u.exec(normalized);
    if (!match) return null;
    const prefix = match[1] ?? "";
    const role: RouteEndpointRole = /^(?:from|source|origin|起点|始点|来源|源)$/u.test(prefix) ? "from" : "to";
    const entityStem = (match[2] ?? "").replace(/(?:^|_)id$/u, "").replace(/_id$/u, "");
    if (/^(?:time|date|timestamp|datetime|时间|日期)$/u.test(entityStem)) return null;
    return { column: value, role, entityStem };
}

function routeEndpointColumns(table: StructuredCatalogTable): RouteEndpointColumn[] {
    return table.columns.map(routeEndpointColumn).filter((value): value is RouteEndpointColumn => Boolean(value));
}

function routeEdgeTables(catalog: StructuredCatalogTable[]): StructuredCatalogTable[] {
    return catalog.filter((table) => {
        const endpoints = routeEndpointColumns(table);
        const from = endpoints.filter((endpoint) => endpoint.role === "from");
        const to = endpoints.filter((endpoint) => endpoint.role === "to");
        return from.some((source) =>
            to.some((target) => !source.entityStem || !target.entityStem || source.entityStem === target.entityStem),
        );
    });
}

function routeTargetTables(
    edgeTables: StructuredCatalogTable[],
    catalog: StructuredCatalogTable[],
): StructuredCatalogTable[] {
    const selected = new Map<string, StructuredCatalogTable>();
    for (const edge of edgeTables) {
        const endpointColumns = routeEndpointColumns(edge);
        const endpointColumnNames = new Set(endpointColumns.map((endpoint) => endpoint.column));
        for (const value of Array.isArray(edge.relations) ? edge.relations : []) {
            if (!value || typeof value !== "object" || Array.isArray(value)) continue;
            const relation = value as TableRelationLike;
            if (
                typeof relation.sourceColumn !== "string" ||
                typeof relation.targetPath !== "string" ||
                !endpointColumnNames.has(relation.sourceColumn) ||
                (relation.confidence !== "declared" && relation.confidence !== "high")
            ) {
                continue;
            }
            const targets = catalog.filter(
                (target) => target.assetId === edge.assetId && target.path === relation.targetPath,
            );
            if (targets.length === 1 && tableIdentity(targets[0]) !== tableIdentity(edge)) {
                selected.set(tableIdentity(targets[0]), targets[0]);
            }
        }

        const endpointStems = new Set(endpointColumns.map((endpoint) => endpoint.entityStem).filter(Boolean));
        if (endpointStems.size === 0) continue;
        for (const target of catalog) {
            if (target.assetId !== edge.assetId || tableIdentity(target) === tableIdentity(edge)) continue;
            const primaryKey = typeof target.primaryKey === "string" ? normalizedSchemaColumn(target.primaryKey) : "";
            const primaryStem = primaryKey.replace(/_id$/u, "");
            if (primaryStem && endpointStems.has(primaryStem)) selected.set(tableIdentity(target), target);
        }
    }
    return Array.from(selected.values());
}

function routeStateColumn(table: StructuredCatalogTable): string | undefined {
    return table.columns.find((column) =>
        /^(?:status|state|availability|availability_state|状态|可用性)$/u.test(normalizedSchemaColumn(column)),
    );
}

interface RouteStateOverlay {
    table: StructuredCatalogTable;
    scopeRelations: Array<{ relation: TableRelationLike; target: StructuredCatalogTable }>;
}

/**
 * Find catalog-proven state overlays for a route graph. An overlay is not
 * inferred from a filename: it must have a readable state column and a
 * declared/high-confidence relation whose source column targets the primary
 * key of a proven edge table. Any other declared/high relation to a primary
 * key is retained as a possible scope owner (for example a case/version table).
 */
function routeStateOverlays(
    edgeTables: StructuredCatalogTable[],
    catalog: StructuredCatalogTable[],
): RouteStateOverlay[] {
    const edgesByIdentity = new Map(edgeTables.map((table) => [tableIdentity(table), table] as const));
    const selected: RouteStateOverlay[] = [];
    for (const table of catalog) {
        if (!routeStateColumn(table)) continue;
        const relations = (Array.isArray(table.relations) ? table.relations : []).flatMap((value) =>
            value && typeof value === "object" && !Array.isArray(value) ? [value as TableRelationLike] : [],
        );
        const edgeRelations = relations.filter((relation) => {
            if (
                typeof relation.targetPath !== "string" ||
                typeof relation.targetColumn !== "string" ||
                (relation.confidence !== "declared" && relation.confidence !== "high")
            ) {
                return false;
            }
            const edge = edgesByIdentity.get(`${String(table.assetId ?? "")}:${relation.targetPath}`);
            const edgePrimaryKey = typeof edge?.primaryKey === "string" ? edge.primaryKey : undefined;
            return Boolean(
                edgePrimaryKey &&
                    normalizedSchemaColumn(edgePrimaryKey) === normalizedSchemaColumn(relation.targetColumn),
            );
        });
        if (edgeRelations.length === 0) continue;

        const edgeRelationKeys = new Set(
            edgeRelations.map(
                (relation) =>
                    `${String(relation.sourceColumn ?? "")}:${String(relation.targetPath ?? "")}:${String(
                        relation.targetColumn ?? "",
                    )}`,
            ),
        );
        const scopeRelations = relations.flatMap((relation) => {
            if (
                typeof relation.sourceColumn !== "string" ||
                typeof relation.targetPath !== "string" ||
                typeof relation.targetColumn !== "string" ||
                (relation.confidence !== "declared" && relation.confidence !== "high") ||
                edgeRelationKeys.has(`${relation.sourceColumn}:${relation.targetPath}:${relation.targetColumn}`)
            ) {
                return [];
            }
            const targetColumn = relation.targetColumn;
            const targets = catalog.filter(
                (target) =>
                    target.assetId === table.assetId &&
                    target.path === relation.targetPath &&
                    typeof target.primaryKey === "string" &&
                    normalizedSchemaColumn(target.primaryKey) === normalizedSchemaColumn(targetColumn),
            );
            return targets.length === 1 ? [{ relation, target: targets[0] }] : [];
        });
        selected.push({ table, scopeRelations });
    }
    return selected;
}

function requestsNegativeNodeExistence(value: string): boolean {
    const query = knowledgeRetrievalIntentText(value);
    const negative =
        /(?:没有|不存在|未建模|未记录|未找到|缺失|\b(?:no|not\s+found|missing|absent|does\s+not\s+exist)\b)/iu;
    const node = /(?:节点|顶点|位置|目的地|\b(?:node|vertex|location|destination)\b)/iu;
    return negative.test(query) && node.test(query);
}

function requestsScopedRouteState(value: string): boolean {
    const query = knowledgeRetrievalIntentText(value);
    return /(?:当.{0,40}时|在.{0,40}时|期间|场景|情况|条件|报警|告警|事件|事故|(?:^|[^\p{L}\p{N}_])(?:when|during|while|scenario|case|incident|alarm|event)(?=$|[^\p{L}\p{N}_]))/iu.test(
        query,
    );
}

function routeTopologyObligations(query: string, catalog: StructuredCatalogTable[]): KnowledgeRetrievalObligation[] {
    if (!isKnowledgeRouteOrTopologyRequest(query)) return [];
    const edgeTables = routeEdgeTables(catalog);
    if (edgeTables.length === 0) {
        return [
            {
                id: "route-topology:unresolved",
                kind: "route_topology",
                query,
                identifiers: [],
                sourcePaths: [],
                sourceKeys: [],
                completion: "all_sources_verified",
            },
        ];
    }

    const targets = routeTargetTables(edgeTables, catalog);
    const overlays = routeStateOverlays(edgeTables, catalog);
    const explicitIdentifiers = knowledgeIdentifierCandidates(query, catalog);
    const identifierOwners = knowledgeIdentifierOwners(explicitIdentifiers, catalog);
    const scopedStateRequested = requestsScopedRouteState(query);
    const boundTables = [...edgeTables, ...targets];
    const obligations = Array.from(
        new Map(boundTables.map((table) => [tableIdentity(table), table] as const)).values(),
    ).map<KnowledgeRetrievalObligation>((table) => ({
        id: `route-topology:${tableIdentity(table)}`,
        kind: "route_topology",
        query,
        identifiers: [],
        sourcePaths: [table.path],
        sourceKeys: boundTableIdentities([table]),
        completion: "all_sources_verified",
    }));

    for (const overlay of overlays) {
        const overlaySourceKey = boundTableIdentities([overlay.table])[0];
        const scopeBindings = overlay.scopeRelations.flatMap<KnowledgeRouteScopeBinding>(({ relation, target }) => {
            if (typeof relation.sourceColumn !== "string" || typeof target.primaryKey !== "string") {
                return [];
            }
            const explicitTargetScope = explicitIdentifiers.some((identifier) =>
                (identifierOwners.get(normalizedQuery(identifier)) ?? []).some(
                    (owner) => tableIdentity(owner) === tableIdentity(target),
                ),
            );
            const selectors = explicitIdentifiers.flatMap((identifier) =>
                (identifierOwners.get(normalizedQuery(identifier)) ?? []).flatMap((owner) => {
                    if (typeof owner.primaryKey !== "string") return [];
                    return (Array.isArray(owner.relations) ? owner.relations : []).flatMap((value) => {
                        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
                        const selectorRelation = value as TableRelationLike;
                        if (
                            typeof selectorRelation.sourceColumn !== "string" ||
                            selectorRelation.targetPath !== target.path ||
                            typeof selectorRelation.targetColumn !== "string" ||
                            normalizedSchemaColumn(selectorRelation.targetColumn) !==
                                normalizedSchemaColumn(target.primaryKey as string) ||
                            (selectorRelation.confidence !== "declared" && selectorRelation.confidence !== "high")
                        ) {
                            return [];
                        }
                        return [
                            {
                                sourcePath: owner.path,
                                ...(boundTableIdentities([owner])[0]
                                    ? { sourceKey: boundTableIdentities([owner])[0] }
                                    : {}),
                                primaryKey: owner.primaryKey as string,
                                scopeColumn: selectorRelation.sourceColumn,
                                identifier,
                            },
                        ];
                    });
                }),
            );
            if (!scopedStateRequested && !explicitTargetScope && selectors.length === 0) return [];
            return [
                {
                    overlaySourcePath: overlay.table.path,
                    ...(overlaySourceKey ? { overlaySourceKey } : {}),
                    overlayScopeColumn: relation.sourceColumn,
                    ownerSourcePath: target.path,
                    ...(boundTableIdentities([target])[0] ? { ownerSourceKey: boundTableIdentities([target])[0] } : {}),
                    ownerPrimaryKey: target.primaryKey,
                    descriptorColumns: target.columns
                        .filter(
                            (column) =>
                                normalizedSchemaColumn(column) !== normalizedSchemaColumn(target.primaryKey as string),
                        )
                        .slice(0, 32),
                    ...(selectors.length > 0 ? { selectors } : {}),
                },
            ];
        });
        // A scope-specific overlay is irrelevant to an unconditional base
        // topology request unless the query names the scope, expresses a
        // conditional context, or an exact entity has a catalog relation to
        // that scope. Global (unscoped) state overlays remain mandatory.
        if (overlay.scopeRelations.length > 0 && scopeBindings.length === 0) continue;
        const filters = overlay.scopeRelations.flatMap(({ relation, target }) => {
            if (typeof relation.sourceColumn !== "string" || typeof relation.targetColumn !== "string") return [];
            const sourceColumn = relation.sourceColumn;
            const targetColumn = relation.targetColumn;
            return explicitIdentifiers.flatMap((identifier) => {
                const owners = identifierOwners.get(normalizedQuery(identifier)) ?? [];
                return owners.some((owner) => tableIdentity(owner) === tableIdentity(target))
                    ? [
                          {
                              column: sourceColumn,
                              value: identifier,
                              targetPath: target.path,
                              targetColumn,
                              confidence: relation.confidence as "declared" | "high",
                          },
                      ]
                    : [];
            });
        });
        obligations.push({
            id: `route-state-overlay:${tableIdentity(overlay.table)}`,
            kind: "route_topology",
            query,
            identifiers: [],
            sourcePaths: [overlay.table.path],
            sourceKeys: boundTableIdentities([overlay.table]),
            ...(filters.length > 0 ? { filters } : {}),
            ...(scopeBindings.length > 0
                ? {
                      routeScope: {
                          role: "state_overlay" as const,
                          requiresUniqueResolution: filters.length === 0,
                          bindings: scopeBindings,
                      },
                  }
                : {}),
            completion: "all_sources_verified",
        });

        // Without an explicit catalog-owned scope ID the runtime must read the
        // descriptor owner as an independent duty. Coverage may close only
        // after the query uniquely resolves one owner row; merely reading every
        // overlay row never makes an unscoped base graph complete.
        if (filters.length === 0) {
            for (const { relation, target } of overlay.scopeRelations) {
                const binding = scopeBindings.find(
                    (candidate) =>
                        candidate.overlayScopeColumn === relation.sourceColumn &&
                        candidate.ownerSourcePath === target.path,
                );
                if (!binding) continue;
                obligations.push({
                    id: `route-scope-owner:${tableIdentity(overlay.table)}:${normalizedSchemaColumn(
                        String(relation.sourceColumn ?? ""),
                    )}:${tableIdentity(target)}`,
                    kind: "route_topology",
                    query,
                    identifiers: [],
                    sourcePaths: [target.path],
                    sourceKeys: boundTableIdentities([target]),
                    routeScope: {
                        role: "descriptor_owner" as const,
                        requiresUniqueResolution: true,
                        bindings: [binding],
                    },
                    completion: "all_sources_verified",
                });
            }
        }
    }
    if (requestsNegativeNodeExistence(query) && targets.length === 0) {
        obligations.push({
            id: "route-topology:nodes-unresolved",
            kind: "route_topology",
            query,
            identifiers: [],
            sourcePaths: [],
            sourceKeys: [],
            completion: "all_sources_verified",
        });
    }
    return obligations;
}

function requestsRouteSupportResources(query: string): boolean {
    return /(?:设备|器材|资源|工具|(?:^|[^\p{L}\p{N}_])(?:equipment|devices?|resources?|tools?)(?=$|[^\p{L}\p{N}_]))/iu.test(
        knowledgeRetrievalIntentText(query),
    );
}

function stableRouteSupportIdColumn(table: StructuredCatalogTable): string | undefined {
    return table.columns.find((column) =>
        /^(?:(?:equipment|device|resource|tool|asset)_?id|设备_?(?:id|编号)|器材_?(?:id|编号)|资源_?(?:id|编号)|工具_?(?:id|编号))$/iu.test(
            normalizedSchemaColumn(column),
        ),
    );
}

function routeSupportObligations(query: string, catalog: StructuredCatalogTable[]): KnowledgeRetrievalObligation[] {
    if (!isKnowledgeRouteOrTopologyRequest(query) || !requestsRouteSupportResources(query)) return [];
    const edgeTables = routeEdgeTables(catalog);
    const targetKeys = new Set(routeTargetTables(edgeTables, catalog).map(tableIdentity));
    const supportTables = catalog.filter((table) => {
        if (!stableRouteSupportIdColumn(table)) return false;
        return (Array.isArray(table.relations) ? table.relations : []).some((value) => {
            if (!value || typeof value !== "object" || Array.isArray(value)) return false;
            const relation = value as TableRelationLike;
            if (
                typeof relation.targetPath !== "string" ||
                (relation.confidence !== "declared" && relation.confidence !== "high")
            ) {
                return false;
            }
            return targetKeys.has(`${String(table.assetId ?? "")}:${relation.targetPath}`);
        });
    });
    if (supportTables.length === 0) {
        return [
            {
                id: "route-support:unresolved",
                kind: "route_support",
                query,
                identifiers: [],
                sourcePaths: [],
                sourceKeys: [],
                completion: "all_sources_verified",
            },
        ];
    }
    return supportTables.map((table) => ({
        id: `route-support:${tableIdentity(table)}`,
        kind: "route_support",
        query,
        identifiers: [],
        sourcePaths: [table.path],
        sourceKeys: boundTableIdentities([table]),
        completion: "all_sources_verified",
    }));
}

function csvDescriptors(path: string, title?: string): string[] {
    const basename = path.split("/").at(-1) ?? path;
    return Array.from(
        new Set(
            [path, basename, title ?? ""]
                .map((value) => normalizedQuery(value.trim()))
                .filter((value) => value.endsWith(".csv")),
        ),
    );
}

/**
 * Resolve CSV files literally named by the user from the already-authorized
 * search hits. A basename is usable only when it identifies one asset/path;
 * callers must fail closed for missing, suffix-only, or cross-asset matches.
 */
function explicitCsvHitIdentities(query: string, hits: unknown[]): Set<string> {
    const normalized = normalizedQuery(query);
    const endings = Array.from(normalized.matchAll(/\.csv(?![A-Za-z0-9_.-])/giu)).map(
        (match) => (match.index ?? 0) + match[0].length,
    );
    if (endings.length === 0) return new Set();

    const sources = hits.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const hit = value as Record<string, unknown>;
        const path = hitPath(hit).trim();
        if (!path.toLowerCase().endsWith(".csv")) return [];
        return [
            {
                identity: sourceIdentity(hit),
                descriptors: csvDescriptors(path, typeof hit.title === "string" ? hit.title : undefined),
            },
        ];
    });

    const selected = new Set<string>();
    for (const end of endings) {
        const matches = sources.flatMap((source) =>
            source.descriptors.flatMap((descriptor) =>
                descriptor.length <= end && normalized.slice(end - descriptor.length, end) === descriptor
                    ? [{ ...source, descriptorLength: descriptor.length }]
                    : [],
            ),
        );
        if (matches.length === 0) return new Set();
        const longest = Math.max(...matches.map((match) => match.descriptorLength));
        const identities = new Set(
            matches.filter((match) => match.descriptorLength === longest).map((match) => match.identity),
        );
        if (identities.size !== 1) return new Set();
        selected.add(Array.from(identities)[0]);
    }
    return selected;
}

/** Resolve literal CSV mentions without suffix-substring or cross-asset fallback. */
function explicitCsvTables(
    query: string,
    catalog: StructuredCatalogTable[],
    searchRecord?: Record<string, unknown> | null,
): { explicit: boolean; tables: StructuredCatalogTable[] } | null {
    const normalized = normalizedQuery(query);
    const endings = Array.from(normalized.matchAll(/\.csv(?![A-Za-z0-9_.-])/giu)).map(
        (match) => (match.index ?? 0) + match[0].length,
    );
    if (endings.length === 0) return { explicit: false, tables: [] };

    const sources: Array<{ identity: string; descriptors: string[] }> = catalog.map((table) => ({
        identity: tableIdentity(table),
        descriptors: csvDescriptors(table.path, typeof table.title === "string" ? table.title : undefined),
    }));
    if (Array.isArray(searchRecord?.hits)) {
        for (const value of searchRecord.hits) {
            if (!value || typeof value !== "object" || Array.isArray(value)) continue;
            const hit = value as Record<string, unknown>;
            const path = typeof hit.path === "string" ? hit.path.trim() : "";
            const assetId = typeof hit.assetId === "string" ? hit.assetId.trim() : "";
            if (!path.toLowerCase().endsWith(".csv") || !assetId) continue;
            sources.push({
                identity: `${assetId}:${path}`,
                descriptors: csvDescriptors(path, typeof hit.title === "string" ? hit.title : undefined),
            });
        }
    }

    const selected = new Map<string, StructuredCatalogTable>();
    for (const end of endings) {
        const matches = sources.flatMap((source) =>
            source.descriptors.flatMap((descriptor) =>
                descriptor.length <= end && normalized.slice(end - descriptor.length, end) === descriptor
                    ? [{ ...source, descriptorLength: descriptor.length }]
                    : [],
            ),
        );
        if (matches.length === 0) return null;
        const longest = Math.max(...matches.map((match) => match.descriptorLength));
        const exact = matches.filter((match) => match.descriptorLength === longest);
        const identities = new Set(exact.map((match) => match.identity));
        if (identities.size !== 1) return null;
        const identity = exact[0].identity;
        const catalogMatches = catalog.filter((table) => tableIdentity(table) === identity);
        if (catalogMatches.length !== 1) return null;
        selected.set(identity, catalogMatches[0]);
    }
    return { explicit: true, tables: Array.from(selected.values()) };
}

interface KnowledgeIdentifierFilterBinding {
    identifier: string;
    source: StructuredCatalogTable;
    column: string;
    confidence: "primary_key" | "declared" | "high";
    targetPath?: string;
    targetColumn?: string;
}

function knowledgeIdentifierOwners(
    identifiers: string[],
    catalog: StructuredCatalogTable[],
): Map<string, StructuredCatalogTable[]> {
    const owners = new Map<string, StructuredCatalogTable[]>();
    for (const identifier of identifiers) {
        const normalized = normalizedQuery(identifier);
        owners.set(
            normalized,
            catalog.filter((table) =>
                stringArray(table.recordIds).some((recordId) => normalizedQuery(recordId) === normalized),
            ),
        );
    }
    return owners;
}

/**
 * Extend the generic identifier scanner only with record IDs that the current
 * revision-pinned catalog proves are uniquely owned. Catalog IDs still need an
 * exact token boundary in the request; substring hits and IDs present in more
 * than one asset/path remain ordinary query text. This lets domain-neutral
 * letter-only IDs such as `NODE-A` participate in exact and relation duties
 * without weakening the global prose scanner.
 */
function catalogBoundedKnowledgeIdentifierCandidates(query: string, catalog: TableSummaryLike[]): string[] {
    const retrievalQuery = knowledgeRetrievalIntentText(query);
    const matches = new Map<string, { value: string; owners: Set<string> }>();
    for (const table of catalog) {
        for (const recordId of stringArray(table.recordIds)) {
            const value = recordId.trim();
            if (!value || value.length > 160 || !containsBounded(retrievalQuery, value)) continue;
            const normalized = normalizedQuery(value);
            const match = matches.get(normalized) ?? { value, owners: new Set<string>() };
            match.owners.add(tableIdentity(table));
            matches.set(normalized, match);
        }
    }
    return Array.from(matches.values())
        .filter((match) => match.owners.size === 1)
        .map((match) => match.value);
}

function knowledgeIdentifierCandidates(query: string, catalog: TableSummaryLike[]): string[] {
    return Array.from(
        new Set([
            ...genericKnowledgeIdentifierCandidates(query),
            ...catalogBoundedKnowledgeIdentifierCandidates(query, catalog),
        ]),
    ).slice(0, 64);
}

function knowledgeIdentifierFilterBindings(
    query: string,
    catalog: StructuredCatalogTable[],
    options: { includeForeignKeys: boolean; declaredOnly: boolean; identifiers?: string[] },
): KnowledgeIdentifierFilterBinding[] {
    const identifiers = options.identifiers ?? knowledgeIdentifierCandidates(query, catalog);
    const owners = knowledgeIdentifierOwners(identifiers, catalog);
    const bindings: KnowledgeIdentifierFilterBinding[] = [];
    for (const identifier of identifiers) {
        const normalized = normalizedQuery(identifier);
        for (const table of owners.get(normalized) ?? []) {
            if (typeof table.primaryKey !== "string" || !table.columns.includes(table.primaryKey)) continue;
            bindings.push({
                identifier,
                source: table,
                column: table.primaryKey,
                confidence: "primary_key",
            });
        }
    }
    if (!options.includeForeignKeys) return bindings;

    for (const source of catalog) {
        for (const value of Array.isArray(source.relations) ? source.relations : []) {
            if (!value || typeof value !== "object" || Array.isArray(value)) continue;
            const relation = value as TableRelationLike;
            if (
                typeof relation.sourceColumn !== "string" ||
                typeof relation.targetPath !== "string" ||
                typeof relation.targetColumn !== "string" ||
                !source.columns.includes(relation.sourceColumn) ||
                (relation.confidence !== "declared" && relation.confidence !== "high") ||
                (options.declaredOnly && relation.confidence !== "declared")
            ) {
                continue;
            }
            const targets = catalog.filter(
                (target) =>
                    target.assetId === source.assetId &&
                    target.path === relation.targetPath &&
                    target.columns.includes(relation.targetColumn as string),
            );
            if (targets.length !== 1) continue;
            const target = targets[0];
            for (const identifier of identifiers) {
                const normalized = normalizedQuery(identifier);
                if (!(owners.get(normalized) ?? []).some((owner) => tableIdentity(owner) === tableIdentity(target))) {
                    continue;
                }
                bindings.push({
                    identifier,
                    source,
                    column: relation.sourceColumn,
                    confidence: relation.confidence,
                    targetPath: target.path,
                    targetColumn: relation.targetColumn,
                });
            }
        }
    }
    return Array.from(
        new Map(
            bindings.map((binding) => [
                `${tableIdentity(binding.source)}:${binding.column}:${normalizedQuery(binding.identifier)}`,
                binding,
            ]),
        ).values(),
    );
}

function knowledgeRelationRequested(query: string): boolean {
    return /(?:关联|相关|对应|覆盖|属于|依赖|涉及|联表|连接|匹配|\bjoin\b|\brelat(?:e|ed|ion)\b)/iu.test(query);
}

function knowledgeAllRelatedCollectionRequested(query: string): boolean {
    return /(?:全部|所有|全量).{0,12}(?:相关|关联)|(?:相关|关联)(?:的)?(?:全部|所有|全量)|\ball\s+related\b/iu.test(
        query,
    );
}

function shouldIncludeKnowledgeForeignKeys(query: string, identifierCount: number): boolean {
    return (
        identifierCount >= 2 ||
        knowledgeRelationRequested(query) ||
        (identifierCount === 1 && isKnowledgeDecisionOrActionRequest(query))
    );
}

/**
 * Turn the free-form request into bounded, domain-neutral retrieval duties.
 * Catalog record IDs and schema-declared relations are the only data used to
 * create mandatory identifier obligations. High-confidence relations inferred
 * from matching column names normally remain recall/ranking hints. The narrow
 * exception is an explicit all-related request: a finite, readable exact-column
 * source becomes an all-sources evidence duty, so catalog metadata alone still
 * cannot close it. Output formatting never creates a retrieval obligation.
 */
export function planKnowledgeRetrievalObligations(
    query: string,
    searchRecord?: Record<string, unknown> | null,
): KnowledgeRetrievalObligation[] {
    const retrievalQuery = knowledgeRetrievalIntentText(query);
    if (!retrievalQuery) return [];
    const catalog = catalogEntries(searchRecord).filter(
        (entry): entry is StructuredCatalogTable =>
            typeof entry.path === "string" &&
            Array.isArray(entry.columns) &&
            entry.columns.every((item) => typeof item === "string"),
    );
    const identifiers = knowledgeIdentifierCandidates(retrievalQuery, catalog);
    const owners = knowledgeIdentifierOwners(identifiers, catalog);
    const obligations: KnowledgeRetrievalObligation[] = [];
    const exhaustive = isKnowledgeExhaustiveRequest(retrievalQuery);
    const boundedAllRelated = exhaustive && knowledgeAllRelatedCollectionRequested(retrievalQuery);

    if (isKnowledgeGlobalCatalogInventoryQuery(retrievalQuery)) {
        obligations.push({
            id: "catalog-inventory",
            kind: "catalog_inventory",
            query: retrievalQuery,
            identifiers: [],
            sourcePaths: catalog.map((table) => table.path),
            sourceKeys: boundTableIdentities(catalog),
            completion: "catalog_verified",
        });
    }
    for (const identifier of identifiers) {
        const identifierOwners = owners.get(normalizedQuery(identifier)) ?? [];
        obligations.push({
            id: `exact:${normalizedQuery(identifier)}`,
            kind: "exact_identifier",
            query: identifier,
            identifiers: [identifier],
            sourcePaths: identifierOwners.map((table) => table.path),
            sourceKeys: boundTableIdentities(identifierOwners),
            completion: "record_verified",
        });
    }

    const includeForeignKeys = shouldIncludeKnowledgeForeignKeys(retrievalQuery, identifiers.length);
    const explicitRelationRequested = knowledgeRelationRequested(retrievalQuery);
    const routeOrTopologyRequested = isKnowledgeRouteOrTopologyRequest(retrievalQuery);
    let hasBoundedRelationSources = false;
    if (includeForeignKeys) {
        const relationBindings = knowledgeIdentifierFilterBindings(retrievalQuery, catalog, {
            includeForeignKeys: true,
            // An explicit relation question may use a unique exact-column,
            // high-confidence relation as a bounded read duty. The relation is
            // only a retrieval hint: completion still requires an exact,
            // revision-pinned filtered read from the asset-bound source. Generic
            // action questions keep inferred relations as ranking hints only.
            declaredOnly: !(boundedAllRelated || explicitRelationRequested || routeOrTopologyRequested),
            identifiers,
        }).filter(
            (binding) =>
                binding.confidence !== "primary_key" &&
                (binding.confidence !== "high" || typeof binding.source.resource === "string"),
        );
        hasBoundedRelationSources = boundedAllRelated && relationBindings.length > 0;
        const grouped = new Map<string, KnowledgeIdentifierFilterBinding[]>();
        for (const binding of relationBindings) {
            const identity = tableIdentity(binding.source);
            grouped.set(identity, [...(grouped.get(identity) ?? []), binding]);
        }
        for (const [identity, bindings] of grouped) {
            const source = bindings[0]?.source;
            if (!source) continue;
            const sourceKeys = boundTableIdentities([source]);
            const filters = bindings.map((binding) => ({
                column: binding.column,
                value: binding.identifier,
                ...(binding.targetPath ? { targetPath: binding.targetPath } : {}),
                ...(binding.targetColumn ? { targetColumn: binding.targetColumn } : {}),
                confidence: binding.confidence,
            }));
            obligations.push({
                id: `foreign-key:${identity}`,
                kind: "foreign_key_filter",
                query: retrievalQuery,
                identifiers: Array.from(new Set(bindings.map((binding) => binding.identifier))),
                sourcePaths: [source.path],
                sourceKeys,
                filters,
                // A revision-pinned exact filter is an authoritative bounded
                // result, including a legitimate zero-row result. It therefore
                // closes after the uniquely asset-bound selector is read without
                // failure, staleness or truncation; it must never fabricate a
                // matching row identifier. Catalogs without an asset identity
                // retain the positive-record contract because path alone cannot
                // distinguish two assets with the same relative source path.
                completion:
                    sourceKeys.length === 1 && filters.length > 0
                        ? "all_sources_verified"
                        : boundedAllRelated || routeOrTopologyRequested
                          ? "all_sources_verified"
                          : "record_verified",
            });
        }
    }

    obligations.push(...routeTopologyObligations(retrievalQuery, catalog));
    obligations.push(...routeSupportObligations(retrievalQuery, catalog));

    if (exhaustive && !hasBoundedRelationSources) {
        const explicit = explicitCsvTables(retrievalQuery, catalog, searchRecord);
        const explicitTables = explicit?.tables ?? [];
        obligations.push({
            id: "exhaustive-list",
            kind: "exhaustive_list",
            query: retrievalQuery,
            identifiers,
            sourcePaths: explicitTables.map((table) => table.path),
            sourceKeys: boundTableIdentities(explicitTables),
            completion: "cursor_exhausted",
        });
    }

    knowledgeQueryFacets(retrievalQuery).forEach((facet, index) => {
        obligations.push({
            id: `semantic:${index + 1}`,
            kind: "semantic_facet",
            query: facet,
            identifiers: knowledgeIdentifierCandidates(facet, catalog),
            sourcePaths: [],
            sourceKeys: [],
            completion: "readable_evidence",
        });
    });
    if (obligations.length <= 16) return obligations;

    // Never let a long list of exact identifiers silently evict the
    // exhaustive or semantic duties appended after it. When the bounded
    // planner would overflow, collapse only homogeneous exact-ID duties: coverage
    // can mark that batch covered only after every ID is verified. Relation
    // duties remain source-specific whenever the resulting plan still fits;
    // heterogeneous source filters must never be flattened into one selector.
    const exact = obligations.filter((obligation) => obligation.kind === "exact_identifier");
    const foreignKeys = obligations.filter((obligation) => obligation.kind === "foreign_key_filter");
    const independent = obligations.filter(
        (obligation) => obligation.kind !== "exact_identifier" && obligation.kind !== "foreign_key_filter",
    );
    const exactBatch: KnowledgeRetrievalObligation[] = [];
    if (exact.length > 0) {
        exactBatch.push({
            id: "exact:bounded-batch",
            kind: "exact_identifier",
            query: retrievalQuery,
            identifiers: Array.from(new Set(exact.flatMap((obligation) => obligation.identifiers))),
            sourcePaths: Array.from(new Set(exact.flatMap((obligation) => obligation.sourcePaths))),
            sourceKeys: Array.from(new Set(exact.flatMap((obligation) => obligation.sourceKeys ?? []))),
            completion: "record_verified",
        });
    }
    const sourceSpecific = [...independent, ...foreignKeys, ...exactBatch];
    if (sourceSpecific.length <= 16) return sourceSpecific;

    const overflowSuffix: KnowledgeRetrievalObligation[] = [...exactBatch];
    if (foreignKeys.length > 0) {
        // Foreign-key selectors are source-specific. Flattening heterogeneous
        // columns into one batch makes every source receive every other
        // source's filter and can turn a valid zero-row response into false
        // completeness. If independently preserving them would still overflow
        // the bounded contract, expose one deliberately unbound sentinel: no
        // read can close it, so the caller receives a safe partial result and
        // can narrow the relation request. Supporting a complete overflow read
        // requires a grouped selector contract in the runner.
        const unresolvedForeignKeys: KnowledgeRetrievalObligation = {
            id: "foreign-key:overflow-unresolved",
            kind: "foreign_key_filter",
            query: retrievalQuery,
            identifiers: [],
            sourcePaths: [],
            sourceKeys: [],
            filters: [],
            completion: "all_sources_verified",
        };
        overflowSuffix.push(unresolvedForeignKeys);
    }

    // Exact and relation overflow have explicit bounded representatives above,
    // but every other duty is independent: silently slicing one route graph or
    // support table would let unrelated retained evidence report a false
    // complete result. Reserve one slot whenever those duties still overflow
    // and record the actual omitted duty categories in a deliberately unbound
    // typed sentinel. Coverage cannot close an unbound route duty, so it stays
    // fail-closed until the protocol can carry every concrete obligation.
    const capacityWithoutIndependentSentinel = Math.max(0, 16 - overflowSuffix.length);
    const needsIndependentSentinel = independent.length > capacityWithoutIndependentSentinel;
    const independentCapacity = Math.max(0, capacityWithoutIndependentSentinel - (needsIndependentSentinel ? 1 : 0));
    const retainedIndependent = independent.slice(0, independentCapacity);
    const omittedIndependent = independent.slice(independentCapacity);
    if (omittedIndependent.length > 0) {
        const omittedKinds = Array.from(new Set(omittedIndependent.map((obligation) => obligation.kind))).sort();
        const carrierKind: KnowledgeRetrievalObligationKind = omittedKinds.includes("route_support")
            ? "route_support"
            : "route_topology";
        overflowSuffix.push({
            id: `obligation-overflow:${omittedKinds.join("+")}:unresolved`,
            kind: carrierKind,
            query: retrievalQuery,
            identifiers: [],
            sourcePaths: [],
            sourceKeys: [],
            completion: "all_sources_verified",
        });
    }
    return [...retainedIndependent, ...overflowSuffix];
}

function planKnowledgeIdentifierStructuredGrounding(
    query: string,
    catalog: StructuredCatalogTable[],
): KnowledgeStructuredGroundingPlan | null {
    const identifiers = knowledgeIdentifierCandidates(query, catalog);
    if (identifiers.length === 0) return null;
    const explicitRelationRequested = knowledgeRelationRequested(query);
    const relationRequested =
        explicitRelationRequested || (identifiers.length === 1 && isKnowledgeDecisionOrActionRequest(query));
    const bindings = knowledgeIdentifierFilterBindings(query, catalog, {
        includeForeignKeys: identifiers.length >= 2 || relationRequested,
        // Exact-column inferred relations are safe bounded retrieval plans only
        // when the user explicitly asks for a relation. Generic action requests
        // continue to require a schema-declared relation.
        declaredOnly: !explicitRelationRequested,
        identifiers,
    });
    const grouped = new Map<string, KnowledgeIdentifierFilterBinding[]>();
    for (const binding of bindings) {
        if (!relationRequested && identifiers.length === 1 && binding.confidence !== "primary_key") continue;
        const identity = tableIdentity(binding.source);
        grouped.set(identity, [...(grouped.get(identity) ?? []), binding]);
    }
    const requested = new Set(identifiers.map(normalizedQuery));
    const candidates = Array.from(grouped.values()).filter((values) => {
        const covered = new Set(values.map((binding) => normalizedQuery(binding.identifier)));
        return requested.size === covered.size && Array.from(requested).every((identifier) => covered.has(identifier));
    });
    const declaredRelationCandidates = relationRequested
        ? candidates.filter((values) => values.some((binding) => binding.confidence === "declared"))
        : [];
    const boundedRelationCandidates = explicitRelationRequested
        ? candidates.filter((values) => values.some((binding) => binding.confidence !== "primary_key"))
        : [];
    const selectedBindings =
        declaredRelationCandidates.length === 1
            ? declaredRelationCandidates[0]
            : boundedRelationCandidates.length === 1
              ? boundedRelationCandidates[0]
              : candidates.length === 1
                ? candidates[0]
                : undefined;
    if (!selectedBindings) return null;
    const source = selectedBindings[0]?.source;
    if (!source || typeof source.assetId !== "string") return null;
    const byColumn = new Map<string, KnowledgeIdentifierFilterBinding>();
    for (const binding of selectedBindings) {
        const prior = byColumn.get(binding.column);
        if (prior && normalizedQuery(prior.identifier) !== normalizedQuery(binding.identifier)) return null;
        byColumn.set(binding.column, binding);
    }
    const exhaustive = isKnowledgeExhaustiveRequest(query);
    const projection = source.columns.slice(0, MAX_STRUCTURED_QUERY_COLUMNS);
    const exhaustiveWithinKnownBounds =
        exhaustive &&
        typeof source.recordCount === "number" &&
        Number.isSafeInteger(source.recordCount) &&
        source.recordCount >= 0 &&
        source.recordCount <= STRUCTURED_QUERY_PAGE_SIZE &&
        projection.length === source.columns.length;
    return {
        confidence: "high",
        kind: "filter",
        reasons: [
            "typed_exact_identifier",
            ...(selectedBindings.some((binding) => binding.confidence === "declared")
                ? ["typed_declared_foreign_key"]
                : selectedBindings.some((binding) => binding.confidence === "high")
                  ? ["typed_high_confidence_foreign_key"]
                  : []),
        ],
        request: {
            assetId: source.assetId,
            from: source.path,
            select: projection,
            filters: Array.from(byColumn.values()).map((binding) => ({
                column: binding.column,
                op: "eq" as const,
                value: binding.identifier,
            })),
            limit: STRUCTURED_QUERY_PAGE_SIZE,
        },
        projectionTruncated: projection.length < source.columns.length,
        exhaustive,
        exhaustiveWithinKnownBounds,
        completion: exhaustive && !exhaustiveWithinKnownBounds ? "cursor_exhausted" : "single_result",
    };
}

function descriptorScore(query: string, values: string[]): number {
    const normalized = normalizedQuery(query);
    return values.reduce((score, value) => {
        const candidate = normalizedQuery(value);
        const filename =
            candidate
                .split("/")
                .at(-1)
                ?.replace(/\.csv$/u, "") ?? candidate;
        return (
            score +
            (candidate && normalized.includes(candidate)
                ? 6
                : filename.length >= 2 && normalized.includes(filename)
                  ? 4
                  : 0)
        );
    }, 0);
}

function columnScore(query: string, column: string): number {
    const normalized = normalizedQuery(query);
    const candidate = normalizedQuery(column);
    if (!candidate) return 0;
    if (containsBounded(normalized, candidate)) return 5;
    const parts = candidate.split(/[_\-\s]+/u).filter((part) => part.length >= 2);
    return parts.length > 0 && parts.every((part) => normalized.includes(part)) ? 2 : 0;
}

type StructuredFilter = NonNullable<KnowledgeStructuredGroundingRequest["filters"]>[number];

interface StructuredFilterReference {
    label: string;
    requestColumn: string;
}

interface StructuredFilterParse {
    valid: boolean;
    hasSyntax: boolean;
    filters: StructuredFilter[];
}

const STRUCTURED_SUPPORTED_FILTER_OPERATOR =
    ">=|<=|==|=|>|<|不小于|不大于|大于等于|小于等于|大于|小于|is|为|等于|是|包含|contains";
const STRUCTURED_ANY_FILTER_OPERATOR = `${STRUCTURED_SUPPORTED_FILTER_OPERATOR}|!=|<>|不等于|不是|不包含|not\\s+contains|not\\s+in|in|属于`;

function tableQueryAlias(path: string): string {
    return (path.split("/").at(-1) ?? path).replace(/\.csv$/iu, "");
}

function structuredFilterReferences(
    base: StructuredCatalogTable,
    target?: StructuredCatalogTable,
): StructuredFilterReference[] | null {
    const baseAlias = tableQueryAlias(base.path);
    const targetAlias = target ? tableQueryAlias(target.path) : undefined;
    if (targetAlias && normalizedQuery(targetAlias) === normalizedQuery(baseAlias)) return null;

    const owners = new Map<string, number>();
    for (const column of [...base.columns, ...(target?.columns ?? [])]) {
        const key = normalizedQuery(column);
        owners.set(key, (owners.get(key) ?? 0) + 1);
    }
    const references: StructuredFilterReference[] = [];
    const add = (table: StructuredCatalogTable, prefix?: string) => {
        const alias = tableQueryAlias(table.path);
        const basename = table.path.split("/").at(-1) ?? table.path;
        for (const column of table.columns) {
            const requestColumn = prefix ? `${prefix}.${column}` : column;
            if (owners.get(normalizedQuery(column)) === 1) references.push({ label: column, requestColumn });
            for (const qualifier of [alias, basename, table.path]) {
                references.push({ label: `${qualifier}.${column}`, requestColumn });
            }
        }
    };
    add(base);
    if (target && targetAlias) add(target, targetAlias);

    const unique = new Map<string, StructuredFilterReference>();
    const ambiguous = new Set<string>();
    for (const reference of references) {
        const key = normalizedQuery(reference.label);
        const current = unique.get(key);
        if (current && current.requestColumn !== reference.requestColumn) ambiguous.add(key);
        else if (!current) unique.set(key, reference);
    }
    return Array.from(unique.entries())
        .filter(([key]) => !ambiguous.has(key))
        .map(([, reference]) => reference)
        .sort((left, right) => right.label.length - left.label.length);
}

function structuredScalar(raw: string): KnowledgeStructuredScalar {
    const value = raw.trim();
    if (/^(?:true|false)$/iu.test(value)) return value.toLowerCase() === "true";
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value) ? Number(value) : value;
}

function structuredFilterOperator(operator: string): StructuredFilter["op"] {
    const normalized = operator.toLowerCase();
    if (/^(?:包含|contains)$/iu.test(normalized)) return "contains";
    if (/^(?:>=|不小于|大于等于)$/u.test(normalized)) return "gte";
    if (/^(?:<=|不大于|小于等于)$/u.test(normalized)) return "lte";
    if (/^(?:>|大于)$/u.test(normalized)) return "gt";
    if (/^(?:<|小于)$/u.test(normalized)) return "lt";
    return "eq";
}

/** Parse only complete AND predicates; any unconsumed condition rejects the plan. */
function explicitFilters(query: string, references: StructuredFilterReference[]): StructuredFilterParse {
    const supportedOperator = STRUCTURED_SUPPORTED_FILTER_OPERATOR;
    const anyOperator = STRUCTURED_ANY_FILTER_OPERATOR;
    const valuePattern = `(?:\"([^\"\\r\\n]{1,120})\"|'([^'\\r\\n]{1,120})'|“([^”\\r\\n]{1,120})”|‘([^’\\r\\n]{1,120})’|([^\\s,，;；。\"'“”‘’<>=!]{1,120}?))`;
    const terminator = `(?=\\s*(?:$|且|并且|同时|\\band\\b|[,，;；。]|的?(?:全部|所有|完整)?(?:记录|行|项|数据)|(?:all\\s+)?(?:records?|rows?|items?)\\b))`;
    const candidates: Array<{
        operatorIndex: number;
        labelLength: number;
        requestColumn: string;
        filter: StructuredFilter;
    }> = [];
    const recognizedOperatorIndexes = new Set<number>();

    for (const reference of references) {
        const escaped = reference.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const expression = new RegExp(
            `(?=(^|[^A-Za-z0-9_.-])(${escaped})\\s*(${supportedOperator})\\s*${valuePattern}${terminator})`,
            "giu",
        );
        for (const match of query.matchAll(expression)) {
            const prefix = match[1] ?? "";
            const operator = match[3] ?? "";
            const afterLabel = (match.index ?? 0) + prefix.length + (match[2]?.length ?? 0);
            const operatorUse = query.slice(afterLabel).match(new RegExp(`^\\s*(${supportedOperator})`, "iu"));
            if (!operatorUse?.[1]) continue;
            const operatorIndex = afterLabel + operatorUse[0].indexOf(operatorUse[1]);
            const raw = match[4] ?? match[5] ?? match[6] ?? match[7] ?? match[8];
            if (
                !operator ||
                typeof raw !== "string" ||
                raw.trim().length === 0 ||
                /^(?:的|且|并且|同时|and)$/iu.test(raw.trim())
            ) {
                continue;
            }
            candidates.push({
                operatorIndex,
                labelLength: normalizedQuery(reference.label).length,
                requestColumn: reference.requestColumn,
                filter: {
                    column: reference.requestColumn,
                    op: structuredFilterOperator(operator),
                    value: structuredScalar(raw),
                },
            });
        }
    }
    const filters: StructuredFilter[] = [];
    for (const operatorIndex of Array.from(new Set(candidates.map((candidate) => candidate.operatorIndex))).sort(
        (left, right) => left - right,
    )) {
        const atOperator = candidates.filter((candidate) => candidate.operatorIndex === operatorIndex);
        const longest = Math.max(...atOperator.map((candidate) => candidate.labelLength));
        const exact = atOperator.filter((candidate) => candidate.labelLength === longest);
        if (new Set(exact.map((candidate) => candidate.requestColumn)).size !== 1) {
            return { valid: false, hasSyntax: true, filters: [] };
        }
        recognizedOperatorIndexes.add(operatorIndex);
        filters.push(exact[0].filter);
    }

    let hasSyntax = filters.length > 0;
    for (const match of query.matchAll(/!=|<>|>=|<=|==|=|>|</gu)) {
        hasSyntax = true;
        const index = match.index ?? -1;
        if (!recognizedOperatorIndexes.has(index)) {
            const insideRecognizedLongerOperator = Array.from(recognizedOperatorIndexes).some(
                (recognized) => index > recognized && index < recognized + 2,
            );
            if (!insideRecognizedLongerOperator) return { valid: false, hasSyntax, filters: [] };
        }
    }
    for (const reference of references) {
        const escaped = reference.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const usesOperator = new RegExp(`(^|[^A-Za-z0-9_.-])${escaped}\\s*(${anyOperator})`, "giu");
        for (const match of query.matchAll(usesOperator)) {
            const operator = match[2] ?? "";
            const index = (match.index ?? 0) + match[0].indexOf(operator, match[1]?.length ?? 0);
            hasSyntax = true;
            if (!recognizedOperatorIndexes.has(index)) return { valid: false, hasSyntax, filters: [] };
        }
    }
    const unknownAsciiComparison = new RegExp(
        `(^|[^A-Za-z0-9_.-])([A-Za-z_][A-Za-z0-9_.-]{0,79})\\s*(${anyOperator})`,
        "giu",
    );
    for (const match of query.matchAll(unknownAsciiComparison)) {
        const operator = match[3] ?? "";
        const index =
            (match.index ?? 0) + match[0].indexOf(operator, (match[1]?.length ?? 0) + (match[2]?.length ?? 0));
        hasSyntax = true;
        if (!recognizedOperatorIndexes.has(index)) return { valid: false, hasSyntax, filters: [] };
    }
    if (hasSyntax && /(?:\bor\b|或者|或是)/iu.test(query)) return { valid: false, hasSyntax, filters: [] };
    if (filters.length > 0 && /(?:排除|除外|不要|不含|\bnot\b)/iu.test(query)) {
        return { valid: false, hasSyntax, filters: [] };
    }
    if (filters.length > 16) return { valid: false, hasSyntax: true, filters: [] };
    return { valid: true, hasSyntax, filters };
}

function explicitOrder(query: string, columns: string[]) {
    const matches = columns.flatMap((column) => {
        const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = query.match(
            new RegExp(
                `(?:按|order\\s+by)\\s*${escaped}(?:\\s*字段)?\\s*(升序|降序|asc|desc)(?:排序)?|${escaped}\\s*(升序|降序|asc|desc)排序`,
                "iu",
            ),
        );
        const direction = (match?.[1] ?? match?.[2])?.toLowerCase();
        return direction
            ? [{ column, direction: /^(?:降序|desc)$/u.test(direction) ? ("desc" as const) : ("asc" as const) }]
            : [];
    });
    return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Build a deterministic structured-query plan only from verified table catalog
 * metadata and explicit user language. Ambiguous table/column/value requests
 * intentionally return null so the established search/read path remains the
 * fail-closed fallback.
 */
export function planKnowledgeStructuredGrounding(
    rawQuery: string,
    searchRecord?: Record<string, unknown> | null,
): KnowledgeStructuredGroundingPlan | null {
    const query = knowledgeRetrievalIntentText(rawQuery);
    if (!query) return null;
    const catalog = catalogEntries(searchRecord).filter(
        (entry): entry is TableSummaryLike & { path: string; columns: string[] } =>
            typeof entry.path === "string" &&
            entry.path.toLowerCase().endsWith(".csv") &&
            Array.isArray(entry.columns) &&
            entry.columns.length > 0 &&
            entry.columns.every((column) => typeof column === "string" && column.trim().length > 0),
    );
    if (catalog.length === 0) return null;

    if (!/\.csv(?![A-Za-z0-9_.-])/iu.test(query)) {
        const identifierPlan = planKnowledgeIdentifierStructuredGrounding(query, catalog);
        if (identifierPlan) return identifierPlan;
    }

    const aggregateSignal = /(?:总和|合计|加总|sum\b)/iu.test(query)
        ? ("sum" as const)
        : /(?:最大|最高|max(?:imum)?\b)/iu.test(query)
          ? ("max" as const)
          : /(?:最小|最低|min(?:imum)?\b)/iu.test(query)
            ? ("min" as const)
            : /(?:符合.{0,16}多少|共有|总共|总数|记录数|count\b|how\s+many)/iu.test(query)
              ? ("count" as const)
              : undefined;
    const enumerationSignal = /(?:列出|列表|逐条|全部|所有|每一|list\b|all\b|every\b)/iu.test(query);
    const exhaustiveSignal = isKnowledgeExhaustiveRequest(query);
    const joinSignal = /(?:联表|关联|对应|连接|匹配|join\b|relat(?:e|ed|ion))/iu.test(query);
    const explicitCsv = explicitCsvTables(query, catalog, searchRecord);
    if (!explicitCsv) return null;
    const explicitlyNamedCsvTables = explicitCsv.tables;
    // An explicit filename is a hard selector, not a fuzzy hint. Never silently
    // substitute a first-page table that merely shares a mentioned column.
    if (explicitCsv.explicit) {
        if (explicitlyNamedCsvTables.length === 0) return null;
        if (!joinSignal && explicitlyNamedCsvTables.length !== 1) return null;
    }
    const rankableCatalog = explicitlyNamedCsvTables.length > 0 ? explicitlyNamedCsvTables : catalog;
    const tableRank = rankableCatalog
        .map((entry, index) => ({
            entry,
            index,
            score:
                descriptorScore(query, tableDescriptors(entry)) +
                stringArray(entry.columns).reduce((sum, column) => sum + columnScore(query, column), 0),
        }))
        .sort((left, right) => right.score - left.score || left.index - right.index);
    let base = tableRank[0];
    if (joinSignal) {
        if (!explicitCsv.explicit || explicitlyNamedCsvTables.length !== 2) return null;
        const explicitlyNamedIdentities = new Set(explicitlyNamedCsvTables.map(tableIdentity));
        const uniqueDeclaredSource = tableRank.filter(
            (entry) =>
                explicitlyNamedIdentities.has(tableIdentity(entry.entry)) &&
                (Array.isArray(entry.entry.relations) ? entry.entry.relations : []).some(
                    (relation) =>
                        relation &&
                        typeof relation === "object" &&
                        !Array.isArray(relation) &&
                        (relation as TableRelationLike).confidence === "declared" &&
                        typeof (relation as TableRelationLike).targetPath === "string" &&
                        explicitlyNamedCsvTables.some(
                            (target) =>
                                target.assetId === entry.entry.assetId &&
                                target.path === (relation as TableRelationLike).targetPath,
                        ),
                ),
        );
        if (uniqueDeclaredSource.length !== 1) return null;
        base = uniqueDeclaredSource[0];
    }
    if (!base || base.score <= 0 || (!joinSignal && (tableRank[1]?.score ?? -1) === base.score)) return null;

    const columns = stringArray(base.entry.columns);
    const orderBy = explicitOrder(query, columns);
    const mentionedColumns = columns
        .map((column) => ({ column, score: columnScore(query, column) }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score || left.column.localeCompare(right.column));
    let aggregateColumn: string | undefined;
    if (aggregateSignal && aggregateSignal !== "count") {
        if (mentionedColumns.length !== 1) return null;
        aggregateColumn = mentionedColumns[0].column;
    }

    let joins: KnowledgeStructuredGroundingRequest["joins"];
    let joinedProjection: string[] = [];
    let joinTarget: StructuredCatalogTable | undefined;
    if (joinSignal) {
        const declared = (Array.isArray(base.entry.relations) ? base.entry.relations : []).flatMap((value) => {
            if (!value || typeof value !== "object" || Array.isArray(value)) return [];
            const relation = value as TableRelationLike;
            if (
                relation.confidence !== "declared" ||
                typeof relation.sourceColumn !== "string" ||
                typeof relation.targetPath !== "string" ||
                typeof relation.targetColumn !== "string"
            ) {
                return [];
            }
            if (!base.entry.assetId || typeof base.entry.assetId !== "string") return [];
            if (!columns.includes(relation.sourceColumn) || typeof relation.targetPath !== "string") return [];
            const targets = catalog.filter(
                (entry) => entry.assetId === base.entry.assetId && entry.path === relation.targetPath,
            );
            if (targets.length !== 1) return [];
            const target = targets[0];
            const targetColumns = stringArray(target.columns);
            if (
                !targetColumns.includes(relation.targetColumn) ||
                !explicitlyNamedCsvTables.some((entry) => tableIdentity(entry) === tableIdentity(target))
            ) {
                return [];
            }
            return [
                {
                    request: {
                        targetPath: relation.targetPath,
                        sourceColumn: relation.sourceColumn,
                        targetColumn: relation.targetColumn,
                        type: "inner" as const,
                    },
                    target,
                },
            ];
        });
        if (declared.length !== 1) return null;
        joins = [declared[0].request];
        joinTarget = declared[0].target;
        const targetColumns = stringArray(declared[0].target.columns);
        const targetAlias = declared[0].request.targetPath
            .split("/")
            .at(-1)
            ?.replace(/\.csv$/iu, "");
        if (!targetAlias) return null;
        const targetMentionedColumns = targetColumns
            .map((column) => ({ column, score: columnScore(query, column) }))
            .filter((item) => item.score > 0)
            .sort((left, right) => right.score - left.score || left.column.localeCompare(right.column));
        const targetSelected = enumerationSignal
            ? targetColumns
            : Array.from(
                  new Set([
                      ...(typeof declared[0].target.primaryKey === "string" ? [declared[0].target.primaryKey] : []),
                      declared[0].request.targetColumn,
                      ...targetMentionedColumns.map((item) => item.column),
                  ]),
              );
        joinedProjection = targetSelected.map((column) => `${targetAlias}.${column}`);
    }

    const references = structuredFilterReferences(base.entry, joinTarget);
    if (!references) return null;
    const parsedFilters = explicitFilters(query, references);
    if (!parsedFilters.valid) return null;
    const filters = parsedFilters.filters;

    const shouldQuery = Boolean(aggregateSignal || filters.length > 0 || joins || enumerationSignal || orderBy);
    if (!shouldQuery) return null;
    const selected = Array.from(
        new Set([
            ...(enumerationSignal ? columns : []),
            ...(enumerationSignal || typeof base.entry.primaryKey !== "string" ? [] : [base.entry.primaryKey]),
            ...(enumerationSignal ? [] : mentionedColumns.map((item) => item.column)),
            ...(!enumerationSignal ? filters.map((filter) => filter.column) : []),
            ...(!enumerationSignal && joins ? joins.map((join) => join.sourceColumn) : []),
            ...joinedProjection,
        ]),
    );
    const projection =
        selected.length > 0
            ? selected.slice(0, MAX_STRUCTURED_QUERY_COLUMNS)
            : columns.slice(0, MAX_STRUCTURED_QUERY_COLUMNS);
    const exhaustiveWithinKnownBounds =
        !aggregateSignal &&
        !joins &&
        selected.length <= projection.length &&
        typeof base.entry.recordCount === "number" &&
        Number.isInteger(base.entry.recordCount) &&
        base.entry.recordCount >= 0 &&
        base.entry.recordCount <= STRUCTURED_QUERY_PAGE_SIZE;
    return {
        confidence: "high",
        kind: joins ? "join" : aggregateSignal ? "aggregate" : filters.length > 0 ? "filter" : "enumeration",
        reasons: [
            "unique_catalog_table",
            ...(aggregateSignal ? ["explicit_aggregate"] : []),
            ...(filters.length > 0 ? ["explicit_filter"] : []),
            ...(joins ? ["schema_declared_join"] : []),
            ...(enumerationSignal ? ["explicit_enumeration"] : []),
        ],
        request: {
            ...(typeof base.entry.assetId === "string" ? { assetId: base.entry.assetId } : {}),
            from: base.entry.path,
            ...(aggregateSignal
                ? {
                      aggregates: [
                          {
                              op: aggregateSignal,
                              ...(aggregateColumn ? { column: aggregateColumn } : {}),
                              as: `${aggregateSignal}Result`,
                          },
                      ],
                  }
                : { select: projection }),
            ...(filters.length > 0 ? { filters } : {}),
            ...(joins ? { joins } : {}),
            ...(orderBy ? { orderBy: [orderBy] } : {}),
            limit: STRUCTURED_QUERY_PAGE_SIZE,
        },
        projectionTruncated: !aggregateSignal && selected.length > projection.length,
        exhaustive: Boolean(exhaustiveSignal),
        exhaustiveWithinKnownBounds,
        completion:
            exhaustiveSignal && !aggregateSignal && !exhaustiveWithinKnownBounds ? "cursor_exhausted" : "single_result",
    };
}

function syntheticCatalogHit(entry: TableSummaryLike): Record<string, unknown> | null {
    if (typeof entry.path !== "string" || typeof entry.resource !== "string") return null;
    const assetId = typeof entry.assetId === "string" ? entry.assetId : undefined;
    return {
        kind: "source",
        ...(assetId ? { assetId } : {}),
        path: entry.path,
        title: typeof entry.title === "string" ? entry.title : entry.path.split("/").at(-1),
        resource: entry.resource,
        citations: [entry.resource],
    };
}

/**
 * Select knowledge sources using only search rank, table schema, exact IDs and
 * declared/inferred relations. No project filename, ID prefix or domain term is
 * embedded here.
 */
export function planKnowledgeGroundingSources(
    hits: unknown[],
    query: string,
    searchRecord?: Record<string, unknown> | null,
    maxSources = 6,
    obligationIntent?: string,
): KnowledgeGroundingPlan {
    const retrievalQuery = knowledgeRetrievalIntentText(query);
    const catalog = catalogEntries(searchRecord);
    const structuredCatalog = catalog.filter(
        (entry): entry is StructuredCatalogTable =>
            typeof entry.path === "string" &&
            Array.isArray(entry.columns) &&
            entry.columns.every((item) => typeof item === "string"),
    );
    // Ranking and signed-cursor search remain bound to the normalized query,
    // while obligation planning may retain explicit surface qualifiers that
    // the search-prefix normalizer intentionally removes (for example a
    // `(complete)` scope marker). This keeps cursor identity stable without
    // losing a fail-closed exhaustive duty at the read-budget boundary.
    const obligations = planKnowledgeRetrievalObligations(obligationIntent ?? retrievalQuery, searchRecord);
    const explicitCsvIdentities = explicitCsvHitIdentities(retrievalQuery, hits);
    const routeTopologySourcePaths = new Set(
        obligations
            .filter((obligation) => obligation.kind === "route_topology" || obligation.kind === "route_support")
            .flatMap((obligation) => obligation.sourcePaths),
    );
    const routeTopologySourceKeys = new Set(
        obligations
            .filter((obligation) => obligation.kind === "route_topology" || obligation.kind === "route_support")
            .flatMap((obligation) => obligation.sourceKeys ?? []),
    );
    const identifierCandidates = knowledgeIdentifierCandidates(retrievalQuery, catalog);
    const normalizedIdentifiers = identifierCandidates.map((item) => item.toLowerCase());
    const tokens = queryTokens(retrievalQuery);
    const candidates = new Map<
        string,
        {
            hit: Record<string, unknown>;
            path: string;
            score: number;
            reasons: Set<string>;
            relationPriority: number;
            searchGroups: Set<number>;
        }
    >();

    const hitSearchGroups = (hit: Record<string, unknown>): number[] => {
        const values = Array.isArray(hit.__knowledgeSearchGroups)
            ? hit.__knowledgeSearchGroups
            : [hit.__knowledgeSearchGroup];
        return values.filter(
            (value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0,
        );
    };

    const addCandidate = (hit: Record<string, unknown>, score: number, reason: string, relationPriority = 0) => {
        const path = hitPath(hit);
        if (!path) return;
        const identity = sourceIdentity(hit);
        const current = candidates.get(identity);
        if (current) {
            current.score += score;
            current.reasons.add(reason);
            current.relationPriority = Math.max(current.relationPriority, relationPriority);
            for (const group of hitSearchGroups(hit)) current.searchGroups.add(group);
            if (reason === "catalog_record_id") {
                // An exact catalog-owned record must be read from the canonical
                // source path. Keeping an earlier ranked chunk here can select a
                // neighboring CSV window that does not contain the requested row,
                // even though the catalog has already proved the owner table.
                current.hit = hit;
            }
        } else {
            candidates.set(identity, {
                hit,
                path,
                score,
                reasons: new Set([reason]),
                relationPriority,
                searchGroups: new Set(hitSearchGroups(hit)),
            });
        }
    };

    for (const [index, value] of hits.entries()) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const hit = value as Record<string, unknown>;
        const searchable =
            `${hit.path ?? ""}\n${hit.title ?? ""}\n${hit.conceptId ?? ""}\n${hit.snippet ?? ""}`.toLowerCase();
        const exactMatches = normalizedIdentifiers.filter((id) => searchable.includes(id)).length;
        addCandidate(hit, 6_000 - index * 30, "search_rank");
        if (explicitCsvIdentities.has(sourceIdentity(hit))) addCandidate(hit, 20_000, "explicit_csv");
        if (exactMatches > 0) addCandidate(hit, exactMatches * 4_000, "exact_identifier");
        if (hit.kind === "source") addCandidate(hit, 120, "original_source");
    }

    for (const entry of catalog) {
        const hit = syntheticCatalogHit(entry);
        if (!hit) continue;
        const routeTopologyBound =
            routeTopologySourceKeys.has(tableIdentity(entry)) ||
            (!(typeof entry.assetId === "string" && entry.assetId.trim()) &&
                routeTopologySourcePaths.has(entry.path as string));
        if (routeTopologyBound) addCandidate(hit, 18_000, "route_topology", 3);
        const recordIds = stringArray(entry.recordIds).map((item) => item.toLowerCase());
        const exactMatches = normalizedIdentifiers.filter((id) => recordIds.includes(id)).length;
        if (exactMatches > 0) addCandidate(hit, exactMatches * 10_000, "catalog_record_id");
        const relatedMatches = normalizedIdentifiers.filter((id) =>
            recordIds.some((recordId) => containsCompositeIdentifier(recordId, id)),
        ).length;
        if (relatedMatches > 0) {
            addCandidate(hit, 6_000 + Math.min(relatedMatches, 4) * 800, "catalog_related_identifier");
        }
        const descriptors = [
            typeof entry.path === "string" ? entry.path : "",
            typeof entry.title === "string" ? entry.title : "",
            ...stringArray(entry.columns),
            ...stringArray(entry.aliases),
        ]
            .join("\n")
            .toLowerCase();
        const lexicalMatches = tokens.filter((token) => descriptors.includes(token)).length;
        if (lexicalMatches > 0) addCandidate(hit, lexicalMatches * 350, "schema_term");
    }

    const foreignKeyBindings = knowledgeIdentifierFilterBindings(retrievalQuery, structuredCatalog, {
        includeForeignKeys: shouldIncludeKnowledgeForeignKeys(retrievalQuery, identifierCandidates.length),
        declaredOnly: false,
        identifiers: identifierCandidates,
    }).filter((binding) => binding.confidence !== "primary_key");
    const foreignBindingsBySource = new Map<string, KnowledgeIdentifierFilterBinding[]>();
    for (const binding of foreignKeyBindings) {
        const identity = tableIdentity(binding.source);
        foreignBindingsBySource.set(identity, [...(foreignBindingsBySource.get(identity) ?? []), binding]);
    }
    for (const bindings of foreignBindingsBySource.values()) {
        const source = bindings[0]?.source;
        if (!source) continue;
        const hit = syntheticCatalogHit(source);
        if (!hit) continue;
        const distinctIdentifiers = new Set(bindings.map((binding) => normalizedQuery(binding.identifier))).size;
        const declared = bindings.filter((binding) => binding.confidence === "declared").length;
        addCandidate(
            hit,
            7_500 + distinctIdentifiers * 2_000 + declared * 1_000,
            declared > 0 ? "declared_foreign_key_identifier" : "foreign_key_identifier",
            declared > 0 ? 2 : 1,
        );
    }

    const catalogByIdentity = new Map(catalog.map((entry) => [tableIdentity(entry), entry] as const));
    const catalogByPath = new Map<string, TableSummaryLike[]>();
    for (const entry of catalog) {
        if (typeof entry.path !== "string") continue;
        catalogByPath.set(entry.path, [...(catalogByPath.get(entry.path) ?? []), entry]);
    }
    const catalogForSource = (hit: Record<string, unknown>): TableSummaryLike | undefined => {
        const path = hitPath(hit);
        if (!path) return undefined;
        if (typeof hit.assetId === "string" && hit.assetId) {
            return catalogByIdentity.get(`${hit.assetId}:${path}`);
        }
        const matches = catalogByPath.get(path) ?? [];
        return matches.length === 1 ? matches[0] : undefined;
    };
    const relationTarget = (source: TableSummaryLike, targetPath: string): TableSummaryLike | undefined => {
        if (typeof source.assetId === "string" && source.assetId) {
            return catalogByIdentity.get(`${source.assetId}:${targetPath}`);
        }
        const matches = catalogByPath.get(targetPath) ?? [];
        return matches.length === 1 ? matches[0] : undefined;
    };
    const seedSources = Array.from(candidates.values())
        .filter((candidate) => candidate.score >= 2_000)
        .map((candidate) => candidate.hit);
    for (const sourceHit of seedSources) {
        const entry = catalogForSource(sourceHit);
        if (!entry || !Array.isArray(entry.relations)) continue;
        for (const relationValue of entry.relations) {
            if (!relationValue || typeof relationValue !== "object" || Array.isArray(relationValue)) continue;
            const relation = relationValue as TableRelationLike;
            if (typeof relation.targetPath !== "string") continue;
            const target = relationTarget(entry, relation.targetPath);
            if (!target) continue;
            const hit = syntheticCatalogHit(target);
            if (!hit) continue;
            const relationScore =
                relation.confidence === "declared" ? 2_200 : relation.confidence === "high" ? 1_600 : 700;
            const relationPriority = relation.confidence === "declared" ? 2 : relation.confidence === "high" ? 1 : 0;
            addCandidate(hit, relationScore, `relation_${String(relation.confidence ?? "medium")}`, relationPriority);
        }
    }

    const ranked = Array.from(candidates.values()).sort(
        (left, right) => right.score - left.score || left.path.localeCompare(right.path),
    );
    const typedSourcePaths = new Set(
        obligations
            .filter((obligation) =>
                ["exact_identifier", "foreign_key_filter", "route_topology", "exhaustive_list"].includes(
                    obligation.kind,
                ),
            )
            .flatMap((obligation) => obligation.sourcePaths),
    );
    const typedSourceKeys = new Set(
        obligations
            .filter((obligation) =>
                ["exact_identifier", "foreign_key_filter", "route_topology", "exhaustive_list"].includes(
                    obligation.kind,
                ),
            )
            .flatMap((obligation) => obligation.sourceKeys ?? []),
    );
    const typedReservation = ranked.filter((item) =>
        typedSourceKeys.size > 0 ? typedSourceKeys.has(sourceIdentity(item.hit)) : typedSourcePaths.has(item.path),
    );
    // A safely resolved literal filename is an explicit target, not a weak
    // lexical hint. Reserve it inside the unchanged source budget so catalog
    // or facet hits cannot crowd out the revision-pinned schema read required
    // for fail-closed structured planning.
    const explicitCsvReservation = ranked.filter((item) => explicitCsvIdentities.has(sourceIdentity(item.hit)));
    // Composite queries are searched as bounded independent facets. Reserve the
    // best readable source from each search group before global ranking so one
    // broad facet cannot consume the entire unchanged source budget.
    const facetReservationByGroup = new Map<number, (typeof ranked)[number]>();
    for (const item of ranked) {
        for (const group of item.searchGroups) {
            if (!facetReservationByGroup.has(group)) facetReservationByGroup.set(group, item);
        }
    }
    const facetReservation = Array.from(facetReservationByGroup.entries())
        .sort(([left], [right]) => left - right)
        .map(([, item]) => item)
        .slice(0, Math.max(1, maxSources));
    // Keep a small, bounded reservation for catalog-declared/high-confidence
    // relation targets. This prevents a broad semantic search from crowding out
    // the table needed to complete a multi-table answer without turning every
    // weak inferred relation into an unbounded read.
    const relationReservation = ranked
        .filter((item) => item.relationPriority > 0)
        .sort(
            (left, right) =>
                right.relationPriority - left.relationPriority ||
                right.score - left.score ||
                left.path.localeCompare(right.path),
        )
        .slice(0, Math.min(2, Math.max(1, maxSources)));
    const selectedByIdentity = new Map<string, (typeof ranked)[number]>();
    for (const item of [...typedReservation, ...explicitCsvReservation, ...facetReservation, ...relationReservation]) {
        if (selectedByIdentity.size >= Math.max(1, maxSources)) break;
        selectedByIdentity.set(sourceIdentity(item.hit), item);
    }
    for (const item of ranked) {
        if (selectedByIdentity.size >= Math.max(1, maxSources)) break;
        selectedByIdentity.set(sourceIdentity(item.hit), item);
    }
    const selected = Array.from(selectedByIdentity.values());
    return {
        identifiers: identifierCandidates,
        sources: selected.map((item) => ({
            ...item.hit,
            __knowledgeSearchGroups: Array.from(item.searchGroups).sort((left, right) => left - right),
        })),
        diagnostics: selected.map((item) => ({
            path: item.path,
            score: item.score,
            reasons: Array.from(item.reasons).sort(),
        })),
        obligations,
    };
}
