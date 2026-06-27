export interface ApiModule {
    name: string;
    description: string;
    path: string;
    permissions?: string[];
    submodules?: ApiModule[];
    operations?: ApiOperation[];
}

export interface ApiOperation {
    name: string;
    description: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    operationId?: string;
    resource?: string;
    action?: ApiOperationAction;
    tags?: string[];
    permissions?: string[];
    parameters?: ApiParameter[];
    inputSchema?: ApiOperationInputSchema;
    outputSchema?: ApiOperationOutputSchema;
    pagination?: ApiOperationPagination;
    filterFields?: string[];
    sortFields?: string[];
    streaming?: ApiOperationStreaming;
    rawResponse?: ApiOperationRawResponse;
    relatedOperations?: ApiRelatedOperation[];
    examples?: ApiExample[];
}

export interface ApiParameter {
    name: string;
    in?: 'path' | 'query' | 'header' | 'body';
    type: string;
    required: boolean;
    description: string;
    enum?: any[];
    default?: any;
    example?: any;
}

export type ApiOperationAction =
    | 'list'
    | 'get'
    | 'create'
    | 'update'
    | 'delete'
    | 'execute'
    | 'download'
    | 'stream'
    | 'unknown';

export interface ApiOperationInputSchema {
    path?: Record<string, unknown>;
    query?: Record<string, unknown>;
    headers?: Record<string, unknown>;
    body?: Record<string, unknown>;
    contentType?: string;
}

export interface ApiOperationOutputSchema {
    status?: number;
    envelope?: 'standard' | 'paginated' | 'raw' | 'noContent' | 'unknown';
    contentTypes?: string[];
    data?: Record<string, unknown>;
}

export interface ApiOperationPagination {
    type: 'page' | 'cursor';
    pageParam?: string;
    cursorParam?: string;
    limitParam: string;
    sortParam?: string;
    orderParam?: string;
}

export interface ApiOperationStreaming {
    type: 'sse' | 'websocket' | 'raw';
}

export interface ApiOperationRawResponse {
    contentTypes: string[];
    downloadable: boolean;
}

export interface ApiRelatedOperation {
    name: string;
    method: ApiOperation['method'];
    path: string;
    action?: ApiOperationAction;
}

export interface ApiExample {
    description: string;
    request?: any;
    response?: any;
}

export interface IApiExplorerService {
    listModules(userId: string): Promise<ApiModule[]>;
    getModule(moduleName: string, userId: string): Promise<ApiModule | null>;
    searchOperations(query: string, userId: string): Promise<ApiOperation[]>;
    executeOperation(
        moduleName: string,
        operationName: string,
        params: Record<string, any>,
        userId: string,
    ): Promise<any>;
}

export const API_EXPLORER_SERVICE = Symbol('API_EXPLORER_SERVICE');
