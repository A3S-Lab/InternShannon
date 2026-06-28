export interface PaginationOptions {
    page: number;
    limit: number;
    offset: number;
}

export interface PageQueryOptions extends PaginationOptions {
    search?: string;
    sortBy?: string;
    sortOrder: 'asc' | 'desc';
}

export interface PageResult<T> {
    items: T[];
    total: number;
    page: number;
    limit: number;
}

export interface CursorPaginationOptions {
    cursor: string | null;
    limit: number;
    order: 'asc' | 'desc';
}
