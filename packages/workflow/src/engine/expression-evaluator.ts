/**
 * Safe Expression Evaluator for Workflow Conditions
 * Uses AST-based parsing to avoid eval() security issues
 */

import { ExecutionContext } from './execution-context';

type EvaluateFn = (context: Record<string, unknown>) => unknown;

/**
 * Token types for the expression lexer
 */
enum TokenType {
    Number = 'NUMBER',
    String = 'STRING',
    Boolean = 'BOOLEAN',
    Identifier = 'IDENTIFIER',
    Plus = 'PLUS',
    Minus = 'MINUS',
    Star = 'STAR',
    Slash = 'SLASH',
    Percent = 'PERCENT',
    Eq = 'EQ',
    Ne = 'NE',
    Lt = 'LT',
    Le = 'LE',
    Gt = 'GT',
    Ge = 'GE',
    And = 'AND',
    Or = 'OR',
    Not = 'NOT',
    LParen = 'LPAREN',
    RParen = 'RPAREN',
    LBracket = 'LBRACKET',
    RBracket = 'RBRACKET',
    Dot = 'DOT',
    Comma = 'COMMA',
    EOF = 'EOF',
}

interface Token {
    type: TokenType;
    value: string | number | boolean;
}

/**
 * AST Node types
 */
type ASTNode =
    | NumberLiteral
    | StringLiteral
    | BooleanLiteral
    | Identifier
    | BinaryExpression
    | UnaryExpression
    | MemberExpression
    | CallExpression
    | ObjectExpression;

interface NumberLiteral { type: 'NumberLiteral'; value: number; }
interface StringLiteral { type: 'StringLiteral'; value: string; }
interface BooleanLiteral { type: 'BooleanLiteral'; value: boolean; }
interface Identifier { type: 'Identifier'; name: string; }
interface BinaryExpression { type: 'BinaryExpression'; operator: string; left: ASTNode; right: ASTNode; }
interface UnaryExpression { type: 'UnaryExpression'; operator: string; argument: ASTNode; }
interface MemberExpression { type: 'MemberExpression'; object: ASTNode; property: ASTNode; computed: boolean; }
interface CallExpression { type: 'CallExpression'; callee: ASTNode; arguments: ASTNode[]; }
interface ObjectExpression { type: 'ObjectExpression'; properties: { key: string; value: ASTNode }[]; }

/**
 * Simple recursive descent parser for expressions
 */
class Parser {
    private tokens: Token[] = [];
    private pos = 0;

    parse(expression: string): ASTNode {
        this.tokens = this.tokenize(expression);
        this.pos = 0;
        return this.parseExpression();
    }

    private tokenize(expr: string): Token[] {
        const tokens: Token[] = [];
        let i = 0;
        const len = expr.length;

        while (i < len) {
            const ch = expr[i];

            // Skip whitespace
            if (/\s/.test(ch)) { i++; continue; }

            // String
            if (ch === '"' || ch === "'") {
                const str = ch;
                let value = '';
                i++;
                while (i < len && expr[i] !== str) {
                    value += expr[i++];
                }
                i++; // skip closing quote
                tokens.push({ type: TokenType.String, value });
                continue;
            }

            // Number
            if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(expr[i + 1] || ''))) {
                let num = '';
                while (i < len && /[0-9.]/.test(expr[i])) {
                    num += expr[i++];
                }
                tokens.push({ type: TokenType.Number, value: parseFloat(num) });
                continue;
            }

            // Identifier or keyword
            if (/[a-zA-Z_$]/.test(ch)) {
                let id = '';
                while (i < len && /[a-zA-Z0-9_$]/.test(expr[i])) {
                    id += expr[i++];
                }
                if (id === 'true') { tokens.push({ type: TokenType.Boolean, value: true }); }
                else if (id === 'false') { tokens.push({ type: TokenType.Boolean, value: false }); }
                else if (id === 'null') { tokens.push({ type: TokenType.Identifier, value: 'null' }); }
                else { tokens.push({ type: TokenType.Identifier, value: id }); }
                continue;
            }

            // Two-character operators
            const twoChar = expr.slice(i, i + 2);
            if (twoChar === '==' || twoChar === '!=' || twoChar === '<=' || twoChar === '>=' || twoChar === '&&' || twoChar === '||') {
                const typeMap: Record<string, TokenType> = {
                    '==': TokenType.Eq, '!=': TokenType.Ne, '<=': TokenType.Le, '>=': TokenType.Ge,
                    '&&': TokenType.And, '||': TokenType.Or,
                };
                tokens.push({ type: typeMap[twoChar], value: twoChar });
                i += 2;
                continue;
            }

            // Single character
            const singleMap: Record<string, TokenType> = {
                '+': TokenType.Plus, '-': TokenType.Minus, '*': TokenType.Star, '/': TokenType.Slash,
                '%': TokenType.Percent, '=': TokenType.Eq, '<': TokenType.Lt, '>': TokenType.Gt,
                '!': TokenType.Not, '(': TokenType.LParen, ')': TokenType.RParen,
                '[': TokenType.LBracket, ']': TokenType.RBracket,
                '.': TokenType.Dot, ',': TokenType.Comma,
            };
            if (singleMap[ch]) { tokens.push({ type: singleMap[ch], value: ch }); i++; continue; }

            throw new Error(`Unknown character: ${ch}`);
        }

        tokens.push({ type: TokenType.EOF, value: '' });
        return tokens;
    }

    private peek(): Token { return this.tokens[this.pos] || { type: TokenType.EOF, value: '' }; }
    private consume(): Token { return this.tokens[this.pos++]; }
    private expect(type: TokenType): Token {
        const t = this.consume();
        if (t.type !== type) throw new Error(`Expected ${type} but got ${t.type}`);
        return t;
    }

    private parseExpression(): ASTNode { return this.parseOr(); }

    private parseOr(): ASTNode {
        let left = this.parseAnd();
        while (this.peek().type === TokenType.Or) {
            this.consume();
            left = { type: 'BinaryExpression', operator: '||', left, right: this.parseAnd() } as BinaryExpression;
        }
        return left;
    }

    private parseAnd(): ASTNode {
        let left = this.parseEquality();
        while (this.peek().type === TokenType.And) {
            this.consume();
            left = { type: 'BinaryExpression', operator: '&&', left, right: this.parseEquality() } as BinaryExpression;
        }
        return left;
    }

    private parseEquality(): ASTNode {
        let left = this.parseComparison();
        while (this.peek().type === TokenType.Eq || this.peek().type === TokenType.Ne) {
            const op = this.consume().value as string;
            left = { type: 'BinaryExpression', operator: op, left, right: this.parseComparison() } as BinaryExpression;
        }
        return left;
    }

    private parseComparison(): ASTNode {
        let left = this.parseAdditive();
        while (this.peek().type === TokenType.Lt || this.peek().type === TokenType.Le ||
               this.peek().type === TokenType.Gt || this.peek().type === TokenType.Ge) {
            const op = this.consume().value as string;
            left = { type: 'BinaryExpression', operator: op, left, right: this.parseAdditive() } as BinaryExpression;
        }
        return left;
    }

    private parseAdditive(): ASTNode {
        let left = this.parseMultiplicative();
        while (this.peek().type === TokenType.Plus || this.peek().type === TokenType.Minus) {
            const op = this.consume().value as string;
            left = { type: 'BinaryExpression', operator: op, left, right: this.parseMultiplicative() } as BinaryExpression;
        }
        return left;
    }

    private parseMultiplicative(): ASTNode {
        let left = this.parseUnary();
        while (this.peek().type === TokenType.Star || this.peek().type === TokenType.Slash || this.peek().type === TokenType.Percent) {
            const op = this.consume().value as string;
            left = { type: 'BinaryExpression', operator: op, left, right: this.parseUnary() } as BinaryExpression;
        }
        return left;
    }

    private parseUnary(): ASTNode {
        if (this.peek().type === TokenType.Not || this.peek().type === TokenType.Minus) {
            const op = this.consume().value as string;
            return { type: 'UnaryExpression', operator: op, argument: this.parseUnary() } as UnaryExpression;
        }
        return this.parseMember();
    }

    private parseMember(): ASTNode {
        let obj = this.parsePrimary();

        while (this.peek().type === TokenType.Dot || this.peek().type === TokenType.LParen || this.peek().type === TokenType.LBracket) {
            if (this.peek().type === TokenType.Dot) {
                this.consume();
                const prop = this.consume() as Token;
                obj = { type: 'MemberExpression', object: obj, property: { type: 'Identifier', name: prop.value as string }, computed: false } as MemberExpression;
            } else if (this.peek().type === TokenType.LBracket) {
                // Computed member access: obj['key'] / obj[0] / obj[expr]
                this.consume();
                const prop = this.parseExpression();
                this.expect(TokenType.RBracket);
                obj = { type: 'MemberExpression', object: obj, property: prop, computed: true } as MemberExpression;
            } else if (this.peek().type === TokenType.LParen) {
                this.consume();
                const args: ASTNode[] = [];
                while (this.peek().type !== TokenType.RParen) {
                    args.push(this.parseExpression());
                    if (this.peek().type === TokenType.Comma) this.consume();
                }
                this.expect(TokenType.RParen);
                obj = { type: 'CallExpression', callee: obj, arguments: args } as CallExpression;
            }
        }

        return obj;
    }

    private parsePrimary(): ASTNode {
        const t = this.peek();

        if (t.type === TokenType.Number) { this.consume(); return { type: 'NumberLiteral', value: t.value as number }; }
        if (t.type === TokenType.String) { this.consume(); return { type: 'StringLiteral', value: t.value as string }; }
        if (t.type === TokenType.Boolean) { this.consume(); return { type: 'BooleanLiteral', value: t.value as boolean }; }
        if (t.type === TokenType.LParen) {
            this.consume();
            const expr = this.parseExpression();
            this.expect(TokenType.RParen);
            return expr;
        }
        if (t.type === TokenType.Identifier) {
            this.consume();
            return { type: 'Identifier', name: t.value as string };
        }

        throw new Error(`Unexpected token: ${t.type}`);
    }
}

/**
 * AST Evaluator - evaluates AST nodes safely
 */
class Evaluator {
    evaluate(node: ASTNode, context: Record<string, unknown>): unknown {
        switch (node.type) {
            case 'NumberLiteral': return (node as NumberLiteral).value;
            case 'StringLiteral': return (node as StringLiteral).value;
            case 'BooleanLiteral': return (node as BooleanLiteral).value;
            case 'Identifier': return this.resolveIdentifier((node as Identifier).name, context);
            case 'BinaryExpression': return this.evaluateBinary(node as BinaryExpression, context);
            case 'UnaryExpression': return this.evaluateUnary(node as UnaryExpression, context);
            case 'MemberExpression': return this.evaluateMember(node as MemberExpression, context);
            case 'CallExpression': return this.evaluateCall(node as CallExpression, context);
            default: throw new Error(`Unknown node type: ${(node as ASTNode).type}`);
        }
    }

    private resolveIdentifier(name: string, context: Record<string, unknown>): unknown {
        if (name === 'null') return null;
        // Check context variables
        const parts = name.split('.');
        let value: unknown = context;
        for (const part of parts) {
            if (value === null || value === undefined) return undefined;
            value = (value as Record<string, unknown>)[part];
        }
        return value;
    }

    private evaluateBinary(node: BinaryExpression, context: Record<string, unknown>): unknown {
        const left = this.evaluate(node.left, context);
        const right = this.evaluate(node.right, context);

        switch (node.operator) {
            case '+': return (left as number) + (right as number);
            case '-': return (left as number) - (right as number);
            case '*': return (left as number) * (right as number);
            case '/': return (left as number) / (right as number);
            case '%': return (left as number) % (right as number);
            case '==': return left === right;
            case '!=': return left !== right;
            case '<': return (left as number) < (right as number);
            case '<=': return (left as number) <= (right as number);
            case '>': return (left as number) > (right as number);
            case '>=': return (left as number) >= (right as number);
            case '&&': return Boolean(left) && Boolean(right);
            case '||': return Boolean(left) || Boolean(right);
            default: throw new Error(`Unknown operator: ${node.operator}`);
        }
    }

    private evaluateUnary(node: UnaryExpression, context: Record<string, unknown>): unknown {
        const arg = this.evaluate(node.argument, context);
        switch (node.operator) {
            case '!': return !arg;
            case '-': return -(arg as number);
            default: throw new Error(`Unknown unary operator: ${node.operator}`);
        }
    }

    private evaluateMember(node: MemberExpression, context: Record<string, unknown>): unknown {
        const obj = this.evaluate(node.object, context);
        if (node.computed) {
            const prop = this.evaluate(node.property, context);
            return (obj as Record<string, unknown>)?.[prop as string];
        }
        return (obj as Record<string, unknown>)?.[(node.property as Identifier).name];
    }

    private evaluateCall(node: CallExpression, context: Record<string, unknown>): unknown {
        const callee = this.evaluate(node.callee, context);
        const args = node.arguments.map(arg => this.evaluate(arg, context));
        if (typeof callee === 'function') return callee(...args);
        throw new Error(`${callee} is not a function`);
    }
}

/**
 * Expression Evaluator class
 */
export class ExpressionEvaluator {
    private parser = new Parser();
    private evaluator = new Evaluator();
    // Parsing (tokenize + build AST) is pure for a given expression string — only the
    // context varies per call. Cache the AST so re-evaluating the same expression
    // (every loop iteration, every node) skips a full re-parse. Bounded so dynamically
    // generated expressions can't grow it without limit.
    private astCache = new Map<string, ASTNode>();
    private static readonly AST_CACHE_LIMIT = 500;

    /**
     * Evaluate an expression string
     * Supports:
     * - Arithmetic: +, -, *, /, %
     * - Comparison: ==, !=, <, <=, >, >=
     * - Logical: &&, ||, !
     * - Variables: item.price, nodes.llm.outputs.score
     * - Functions: length(), contains(), etc.
     */
    evaluate(expression: string, context: Record<string, unknown>): unknown {
        try {
            let ast = this.astCache.get(expression);
            if (!ast) {
                ast = this.parser.parse(expression);
                // ponytail: bounded cache, clear-on-overflow beats LRU bookkeeping for
                // the finite set of expressions a workflow definition actually holds.
                if (this.astCache.size >= ExpressionEvaluator.AST_CACHE_LIMIT) {
                    this.astCache.clear();
                }
                this.astCache.set(expression, ast);
            }
            return this.evaluator.evaluate(ast, context);
        } catch (error) {
            // Fall back to original expression if parsing fails
            return expression;
        }
    }

    /**
     * Check if expression is a simple variable reference
     */
    isVariableRef(expression: string): boolean {
        return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(expression.trim());
    }

    /**
     * Resolve a variable path like "item.price" or "nodes.llm.outputs.score"
     */
    resolvePath(path: string, context: Record<string, unknown>): unknown {
        const normalizedPath = path
            .replace(/\[['"]([^'"\]]+)['"]\]/g, '.$1')
            .replace(/\[(\d+)\]/g, '.$1');
        const parts = normalizedPath.split('.').filter(Boolean);
        let value: unknown = context;
        for (const part of parts) {
            if (value === null || value === undefined) return undefined;
            value = (value as Record<string, unknown>)[part];
        }
        return value;
    }
}

// Export singleton
export const expressionEvaluator = new ExpressionEvaluator();
