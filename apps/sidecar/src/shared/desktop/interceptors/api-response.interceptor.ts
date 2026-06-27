import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ApiResponseDto,
  ApiResponseInterceptor as StandardApiResponseInterceptor,
} from '../../api/api-response';

export type ApiResponse<T> = Omit<ApiResponseDto, 'data'> & { data: T };

@Injectable()
export class ApiResponseInterceptor<T> extends StandardApiResponseInterceptor {
  constructor() {
    super(new Reflector());
  }
}
