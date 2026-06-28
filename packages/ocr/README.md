# @a3s-lab/ocr

Standard OCR adapter package for internShannon.

The package exposes one small contract for OCR backends and ships HTTP adapters for:

- MinerU
- PaddleOCR
- Unlimited-OCR
- custom HTTP OCR services

```ts
import { createOcrRegistry, DEFAULT_OCR_SETTINGS } from '@a3s-lab/ocr';

const registry = createOcrRegistry({
  ...DEFAULT_OCR_SETTINGS,
  backends: DEFAULT_OCR_SETTINGS.backends.map((backend) =>
    backend.name === 'mineru'
      ? { ...backend, enabled: true, baseUrl: 'http://mineru:30000' }
      : backend,
  ),
});

const result = await registry.recognize({
  data: fileBuffer,
  filename: 'contract.pdf',
  mimeType: 'application/pdf',
});

console.log(result.text);
```

## Contract

- `OcrBackendConfig` stores backend connection parameters.
- `OcrBackend` implements `recognize(input, options)`.
- `OcrResult` normalizes backend-specific responses into text, pages, blocks, and raw metadata.
- `DEFAULT_OCR_SETTINGS` is the default internShannon OCR settings source used by the API config schema.

The built-in adapters are intentionally lightweight and use `fetch`, so each deployment can run the OCR services out of process.
