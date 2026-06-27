import { PageResult } from '@/shared/application/pagination.dto';

export interface ResponseAssembler<TInput, TOutput> {
    toResponse(input: TInput): TOutput;
}

export interface PageResponseAssembler<TInput, TOutput> extends ResponseAssembler<TInput, TOutput> {
    toPage(result: PageResult<TInput>): PageResult<TOutput>;
}

export abstract class BaseResponseAssembler {
    protected cloneResponse<TInput, TOutput = TInput>(input: TInput): TOutput {
        return structuredClone(input) as unknown as TOutput;
    }

    protected cloneList<TInput, TOutput = TInput>(items: TInput[]): TOutput[] {
        return items.map(item => this.cloneResponse<TInput, TOutput>(item));
    }

    protected clonePage<TInput, TOutput = TInput>(result: PageResult<TInput>): PageResult<TOutput> {
        return this.mapPage(result, item => this.cloneResponse<TInput, TOutput>(item));
    }

    protected mapPage<TInput, TOutput>(
        result: PageResult<TInput>,
        mapItem: (item: TInput) => TOutput,
    ): PageResult<TOutput> {
        return {
            items: result.items.map(mapItem),
            total: result.total,
            page: result.page,
            limit: result.limit,
        };
    }
}
