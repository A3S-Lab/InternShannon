# @a3s-lab/ooxml

Shared Office document adapters for Shuan OS workspace editors.

This package owns conversion between Office/OOXML bytes and Univer snapshots so the web file manager can preview and edit common office files without routing through PDF conversion.

## Current Scope

- `.docx` imports text with `mammoth` and exports text-level documents with `docx`.
- `.xlsx`, `.xls`, `.ods`, and `.csv` import/export workbook cells through `xlsx`.
- `.pptx` imports slide text with `jszip` and XML parsing, then writes edited text back into the original package.
- `.pdf` is intentionally outside this package and remains handled by EmbedPDF in the web app.
- `@a3s-lab/ooxml/capabilities` is a lightweight entrypoint for extension support checks. Use it in UI routing code before loading heavy Office adapters.

## Limits

The open-source adapters here are intentionally conservative. They preserve enough structure for direct Univer preview/edit flows, but they do not yet provide full-fidelity Office layout, comments, tracked changes, embedded objects, charts, or complex styling. High-fidelity import/export should be added behind this package boundary, either through Univer's document exchange capabilities or deeper OOXML mappers.

Legacy binary `.doc` and `.ppt` formats are not converted to PDF here. They should remain read-only/unsupported until a direct binary importer is introduced.
