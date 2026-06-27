// Compatibility export for older imports. Runtime error handling is centralized
// in GlobalErrorFilter to keep one public API error contract.
export { GlobalErrorFilter as HttpExceptionFilter } from '../../../common/errors';
