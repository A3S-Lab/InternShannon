/**
 * 智能体契约用的 JSON Schema 子集校验器。
 *
 * 完整 JSON Schema (Draft 2020-12) 表面积庞大，引入 ajv 会带来 70KB+ 的依赖；
 * 而本项目中的 `contract.inputSchema` / `contract.outputSchema` 实际只用到一个
 * 小子集 —— 见 docs/specs/agent-contract.md §2.1。本模块只支持那个子集，
 * 并对超出范围的 schema 在「meta 校验」阶段直接拒绝，杜绝 LLM 写出含
 * oneOf/远程 $ref 等无法在运行时低成本校验的 schema。
 *
 * 子集白名单：
 *   - type:  object | array | string | number | integer | boolean | null
 *   - properties, required, items, enum, additionalProperties (boolean)
 *   - $ref: 仅允许 "#/$defs/<name>"
 *   - description / title 可选（不参与校验）
 */

export type JsonSchemaSubset =
    | { type: 'string'; enum?: string[]; description?: string; title?: string; $ref?: never }
    | { type: 'number' | 'integer'; enum?: number[]; description?: string; title?: string; $ref?: never }
    | { type: 'boolean'; description?: string; title?: string; $ref?: never }
    | { type: 'null'; description?: string; title?: string; $ref?: never }
    | {
          type: 'array';
          items?: JsonSchemaSubset;
          description?: string;
          title?: string;
          $ref?: never;
      }
    | {
          type: 'object';
          properties?: Record<string, JsonSchemaSubset>;
          required?: string[];
          additionalProperties?: boolean;
          description?: string;
          title?: string;
          $ref?: never;
          $defs?: Record<string, JsonSchemaSubset>;
      }
    | { $ref: string; type?: never; description?: string; title?: string };

export interface MetaCheckResult {
    valid: boolean;
    errors: string[];
}

export interface ValidationError {
    path: string;
    message: string;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}

const ALLOWED_TYPES = new Set([
    'object',
    'array',
    'string',
    'number',
    'integer',
    'boolean',
    'null',
]);

const RESERVED_KEYS = new Set([
    'type',
    'properties',
    'required',
    'items',
    'enum',
    'additionalProperties',
    '$ref',
    '$defs',
    'description',
    'title',
]);

const REF_PATTERN = /^#\/\$defs\/[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * 检查给定 schema 是否落在支持的子集里。LLM 生成 inputSchema/outputSchema 后
 * 必须先通过此关，否则在 asset-proposal 阶段直接打回。
 */
export function metaCheckSubset(schema: unknown): MetaCheckResult {
    const errors: string[] = [];
    walk(schema, '#', errors, schema);
    return { valid: errors.length === 0, errors };
}

/**
 * 校验任意数据是否符合给定 schema。schema 应当已通过 metaCheckSubset 校验。
 *
 * 故意保持简单：只覆盖 spec 中支持的关键字。未识别字段直接忽略，未明确允许
 * 的字段在 metaCheckSubset 中就被拒绝，所以这里不需要再做白名单检查。
 */
export function validate(schema: unknown, data: unknown): ValidationResult {
    const errors: ValidationError[] = [];
    validateNode(schema, data, '#', errors, schema);
    return { valid: errors.length === 0, errors };
}

function walk(node: unknown, path: string, errors: string[], root: unknown): void {
    if (node == null || typeof node !== 'object' || Array.isArray(node)) {
        errors.push(`${path}: schema node must be a JSON object`);
        return;
    }
    const obj = node as Record<string, unknown>;

    // 拒绝任何未在白名单中的关键字 — 阻止 oneOf/anyOf/format 等绕过
    for (const key of Object.keys(obj)) {
        if (!RESERVED_KEYS.has(key)) {
            errors.push(`${path}: unsupported keyword "${key}" (allowed: ${[...RESERVED_KEYS].join(', ')})`);
        }
    }

    if (typeof obj.$ref === 'string') {
        if (!REF_PATTERN.test(obj.$ref)) {
            errors.push(`${path}: $ref must match "#/$defs/<name>" (got "${obj.$ref}")`);
            return;
        }
        const refName = obj.$ref.slice('#/$defs/'.length);
        const defs = lookupDefs(root);
        if (!defs || !(refName in defs)) {
            errors.push(`${path}: $ref "${obj.$ref}" not found in #/$defs`);
        }
        return;
    }

    const type = obj.type;
    if (typeof type !== 'string') {
        errors.push(`${path}: missing "type"`);
        return;
    }
    if (!ALLOWED_TYPES.has(type)) {
        errors.push(`${path}: type "${type}" not in allowed set ${[...ALLOWED_TYPES].join(', ')}`);
        return;
    }

    if (type === 'object') {
        if (obj.properties !== undefined) {
            if (typeof obj.properties !== 'object' || obj.properties == null || Array.isArray(obj.properties)) {
                errors.push(`${path}.properties: must be an object`);
            } else {
                for (const [key, sub] of Object.entries(obj.properties)) {
                    walk(sub, `${path}.properties.${key}`, errors, root);
                }
            }
        }
        if (obj.required !== undefined) {
            if (!Array.isArray(obj.required) || obj.required.some(v => typeof v !== 'string')) {
                errors.push(`${path}.required: must be an array of strings`);
            }
        }
        if (obj.additionalProperties !== undefined && typeof obj.additionalProperties !== 'boolean') {
            errors.push(`${path}.additionalProperties: must be a boolean (objects with sub-schema not supported in subset)`);
        }
        if (obj.$defs !== undefined) {
            if (typeof obj.$defs !== 'object' || obj.$defs == null || Array.isArray(obj.$defs)) {
                errors.push(`${path}.$defs: must be an object`);
            } else if (path === '#') {
                // $defs only allowed at root
                for (const [key, sub] of Object.entries(obj.$defs)) {
                    walk(sub, `${path}.$defs.${key}`, errors, root);
                }
            } else {
                errors.push(`${path}.$defs: only allowed at the root of the schema`);
            }
        }
    }

    if (type === 'array') {
        if (obj.items !== undefined) {
            walk(obj.items, `${path}.items`, errors, root);
        }
    }

    if (obj.enum !== undefined) {
        if (!Array.isArray(obj.enum) || obj.enum.length === 0) {
            errors.push(`${path}.enum: must be a non-empty array`);
        }
    }
}

function lookupDefs(root: unknown): Record<string, unknown> | undefined {
    if (root == null || typeof root !== 'object' || Array.isArray(root)) return undefined;
    const defs = (root as Record<string, unknown>).$defs;
    if (!defs || typeof defs !== 'object' || Array.isArray(defs)) return undefined;
    return defs as Record<string, unknown>;
}

function validateNode(node: unknown, value: unknown, path: string, errors: ValidationError[], root: unknown): void {
    if (node == null || typeof node !== 'object' || Array.isArray(node)) return;
    const obj = node as Record<string, unknown>;

    if (typeof obj.$ref === 'string') {
        const refName = obj.$ref.slice('#/$defs/'.length);
        const defs = lookupDefs(root);
        const target = defs?.[refName];
        if (target) validateNode(target, value, path, errors, root);
        return;
    }

    const type = obj.type;
    if (typeof type !== 'string') return;

    if (!typeMatches(type, value)) {
        errors.push({ path, message: `expected ${type}, got ${describeKind(value)}` });
        return;
    }

    if (Array.isArray(obj.enum) && obj.enum.length > 0 && !obj.enum.some(item => deepEqual(item, value))) {
        errors.push({ path, message: `value not in enum ${JSON.stringify(obj.enum)}` });
    }

    if (type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        if (Array.isArray(obj.required)) {
            for (const key of obj.required) {
                if (!(typeof key === 'string' && key in record)) {
                    errors.push({ path: `${path}.${key}`, message: 'required property missing' });
                }
            }
        }
        const properties = obj.properties as Record<string, unknown> | undefined;
        const allowAdditional = obj.additionalProperties !== false;
        if (properties) {
            for (const [key, sub] of Object.entries(properties)) {
                if (key in record) {
                    validateNode(sub, record[key], `${path}.${key}`, errors, root);
                }
            }
        }
        if (!allowAdditional && properties) {
            for (const key of Object.keys(record)) {
                if (!(key in properties)) {
                    errors.push({ path: `${path}.${key}`, message: 'additional property not allowed' });
                }
            }
        }
    }

    if (type === 'array' && Array.isArray(value)) {
        const items = obj.items as Record<string, unknown> | undefined;
        if (items) {
            for (let i = 0; i < value.length; i += 1) {
                validateNode(items, value[i], `${path}[${i}]`, errors, root);
            }
        }
    }
}

function typeMatches(type: string, value: unknown): boolean {
    switch (type) {
        case 'object':
            return value != null && typeof value === 'object' && !Array.isArray(value);
        case 'array':
            return Array.isArray(value);
        case 'string':
            return typeof value === 'string';
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'integer':
            return typeof value === 'number' && Number.isInteger(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'null':
            return value === null;
        default:
            return false;
    }
}

function describeKind(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== typeof b) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((item, idx) => deepEqual(item, b[idx]));
    }
    if (typeof a === 'object' && typeof b === 'object') {
        const ak = Object.keys(a as object);
        const bk = Object.keys(b as object);
        if (ak.length !== bk.length) return false;
        return ak.every(k => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
    }
    return false;
}
