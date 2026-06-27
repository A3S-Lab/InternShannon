import { Injectable, type Type } from '@nestjs/common';
import { createValidationPipe } from '@/shared/api/validation/validation.pipe';
import { CONFIG_CATEGORY_REQUEST_DTO_MAP, type ConfigCategoryName } from '../dto';

@Injectable()
export class ConfigSettingsValidationService {
  private readonly strictBodyPipe = createValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  });

  async validateCategorySettings(name: ConfigCategoryName, body: unknown): Promise<unknown> {
    return this.validateDto(body, CONFIG_CATEGORY_REQUEST_DTO_MAP[name] as Type<unknown>);
  }

  async validateDto<T>(body: unknown, metatype: Type<T>): Promise<T> {
    return this.strictBodyPipe.transform(body, {
      type: 'body',
      metatype,
      data: undefined,
    }) as Promise<T>;
  }
}
