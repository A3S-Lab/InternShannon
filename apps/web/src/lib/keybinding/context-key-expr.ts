/**
 * Context key expression parser and evaluator.
 * Parses "when" expressions like "editorFocus && !readonly" into an AST,
 * then evaluates the AST against a runtime context.
 *
 * Inspired by VS Code's ContextKeyExpr system.
 */

// ---------------------------------------------------------------------------
// AST types
// ---------------------------------------------------------------------------

type AST =
	| { type: "true" }
	| { type: "false" }
	| { type: "key"; value: string }
	| { type: "not"; operand: AST }
	| { type: "and"; left: AST; right: AST }
	| { type: "or"; left: AST; right: AST }
	| { type: "eq"; left: AST; right: AST }
	| { type: "neq"; left: AST; right: AST }
	| { type: "in"; left: AST; right: AST }
	| { type: "notin"; left: AST; right: AST }
	| { type: "gt"; left: AST; right: AST }
	| { type: "gte"; left: AST; right: AST }
	| { type: "lt"; left: AST; right: AST }
	| { type: "lte"; left: AST; right: AST };

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
	| { kind: "ident"; value: string }
	| { kind: "bang" }
	| { kind: "ampamp" }
	| { kind: "pipepipe" }
	| { kind: "eqeq" }
	| { kind: "bangeq" }
	| { kind: "lt" }
	| { kind: "lteq" }
	| { kind: "gt" }
	| { kind: "gteq" }
	| { kind: "lparen" }
	| { kind: "rparen" }
	| { kind: "end" };

function tokenize(input: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < input.length) {
		const ch = input[i];
		if (/\s/.test(ch)) {
			i++;
			continue;
		}
		// !=
		if (ch === "!" && input[i + 1] === "=") {
			tokens.push({ kind: "bangeq" });
			i += 2;
			continue;
		}
		if (ch === "!") {
			tokens.push({ kind: "bang" });
			i++;
			continue;
		}
		// &&
		if (ch === "&" && input[i + 1] === "&") {
			tokens.push({ kind: "ampamp" });
			i += 2;
			continue;
		}
		// ||
		if (ch === "|" && input[i + 1] === "|") {
			tokens.push({ kind: "pipepipe" });
			i += 2;
			continue;
		}
		// ==
		if (ch === "=" && input[i + 1] === "=") {
			tokens.push({ kind: "eqeq" });
			i += 2;
			continue;
		}
		// <=
		if (ch === "<" && input[i + 1] === "=") {
			tokens.push({ kind: "lteq" });
			i += 2;
			continue;
		}
		// >=
		if (ch === ">" && input[i + 1] === "=") {
			tokens.push({ kind: "gteq" });
			i += 2;
			continue;
		}
		if (ch === "<") {
			tokens.push({ kind: "lt" });
			i++;
			continue;
		}
		if (ch === ">") {
			tokens.push({ kind: "gt" });
			i++;
			continue;
		}
		if (ch === "(") {
			tokens.push({ kind: "lparen" });
			i++;
			continue;
		}
		if (ch === ")") {
			tokens.push({ kind: "rparen" });
			i++;
			continue;
		}
		if (/[a-zA-Z0-9_]/.test(ch)) {
			let ident = "";
			while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
				ident += input[i];
				i++;
			}
			tokens.push({ kind: "ident", value: ident });
			continue;
		}
		// Unknown character — treat as end of input
		break;
	}
	tokens.push({ kind: "end" });
	return tokens;
}

// ---------------------------------------------------------------------------
// Parser (recursive descent)
// ---------------------------------------------------------------------------

function parseExpr(tokens: Token[], pos: { index: number }): AST {
	return parseOr(tokens, pos);
}

function parseOr(tokens: Token[], pos: { index: number }): AST {
	let left = parseAnd(tokens, pos);
	while (tokens[pos.index].kind === "pipepipe") {
		pos.index++;
		const right = parseAnd(tokens, pos);
		left = { type: "or", left, right };
	}
	return left;
}

function parseAnd(tokens: Token[], pos: { index: number }): AST {
	let left = parseNot(tokens, pos);
	while (tokens[pos.index].kind === "ampamp") {
		pos.index++;
		const right = parseNot(tokens, pos);
		left = { type: "and", left, right };
	}
	return left;
}

function parseNot(tokens: Token[], pos: { index: number }): AST {
	if (tokens[pos.index].kind === "bang") {
		pos.index++;
		const operand = parseNot(tokens, pos);
		return { type: "not", operand };
	}
	return parseComparison(tokens, pos);
}

function parseComparison(tokens: Token[], pos: { index: number }): AST {
	let left = parsePrimary(tokens, pos);

	// Handle comparison operators
	while (true) {
		const tok = tokens[pos.index];
		if (tok.kind === "eqeq") {
			pos.index++;
			const right = parsePrimary(tokens, pos);
			left = { type: "eq", left, right };
		} else if (tok.kind === "bangeq") {
			pos.index++;
			const right = parsePrimary(tokens, pos);
			left = { type: "neq", left, right };
		} else if (tok.kind === "lt") {
			pos.index++;
			const right = parsePrimary(tokens, pos);
			left = { type: "lt", left, right };
		} else if (tok.kind === "lteq") {
			pos.index++;
			const right = parsePrimary(tokens, pos);
			left = { type: "lte", left, right };
		} else if (tok.kind === "gt") {
			pos.index++;
			const right = parsePrimary(tokens, pos);
			left = { type: "gt", left, right };
		} else if (tok.kind === "gteq") {
			pos.index++;
			const right = parsePrimary(tokens, pos);
			left = { type: "gte", left, right };
		} else {
			break;
		}
	}

	return left;
}

function parsePrimary(tokens: Token[], pos: { index: number }): AST {
	const tok = tokens[pos.index];
	if (tok.kind === "lparen") {
		pos.index++;
		const expr = parseExpr(tokens, pos);
		if (tokens[pos.index].kind === "rparen") {
			pos.index++;
		}
		return expr;
	}
	if (tok.kind === "ident") {
		const value = tok.value;
		pos.index++;
		// Check for == operator
		if (tokens[pos.index].kind === "eqeq") {
			pos.index++;
			const rightTok = tokens[pos.index];
			if (rightTok.kind === "ident") {
				pos.index++;
				return {
					type: "eq",
					left: { type: "key", value },
					right: { type: "key", value: rightTok.value },
				};
			}
		}
		return { type: "key", value };
	}
	if (tok.kind === "end") {
		return { type: "true" };
	}
	return { type: "true" };
}

// ---------------------------------------------------------------------------
// Helpers to get value from AST (resolves keys to context values)
// ---------------------------------------------------------------------------

function getValue(
	ast: AST,
	context: Context,
): string | number | boolean | undefined {
	if (ast.type === "key") {
		return context[ast.value];
	}
	return undefined;
}

type Context = Record<string, boolean | string | number>;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a when expression string into an AST.
 * Returns null if the expression is empty or invalid.
 */
export function parseWhenExpression(expr: string): AST | null {
	if (!expr || expr.trim() === "") return null;
	try {
		const tokens = tokenize(expr.trim());
		const pos = { index: 0 };
		const ast = parseExpr(tokens, pos);
		// If we didn't consume all tokens, the expression is malformed
		if (tokens[pos.index].kind !== "end") {
			return null;
		}
		return ast;
	} catch {
		return null;
	}
}

/**
 * Evaluate an AST against a runtime context.
 * The context maps key names to boolean, string, or number values.
 */
export function evaluateWhen(ast: AST, context: Context): boolean {
	switch (ast.type) {
		case "true":
			return true;
		case "false":
			return false;
		case "key": {
			const val = context[ast.value];
			return val === true || val === "true";
		}
		case "not":
			return !evaluateWhen(ast.operand, context);
		case "and":
			return (
				evaluateWhen(ast.left, context) && evaluateWhen(ast.right, context)
			);
		case "or":
			return (
				evaluateWhen(ast.left, context) || evaluateWhen(ast.right, context)
			);
		case "eq": {
			const left = getValue(ast.left, context);
			const right = getValue(ast.right, context);
			return left === right;
		}
		case "neq": {
			const left = getValue(ast.left, context);
			const right = getValue(ast.right, context);
			return left !== right;
		}
		case "gt": {
			const left = getValue(ast.left, context);
			const right = getValue(ast.right, context);
			if (typeof left === "number" && typeof right === "number") {
				return left > right;
			}
			return false;
		}
		case "gte": {
			const left = getValue(ast.left, context);
			const right = getValue(ast.right, context);
			if (typeof left === "number" && typeof right === "number") {
				return left >= right;
			}
			return false;
		}
		case "lt": {
			const left = getValue(ast.left, context);
			const right = getValue(ast.right, context);
			if (typeof left === "number" && typeof right === "number") {
				return left < right;
			}
			return false;
		}
		case "lte": {
			const left = getValue(ast.left, context);
			const right = getValue(ast.right, context);
			if (typeof left === "number" && typeof right === "number") {
				return left <= right;
			}
			return false;
		}
		case "in": {
			// "in" checks if a string value is contained in an array
			// Format: key in ["value1", "value2"]
			const left = getValue(ast.left, context);
			const right = getValue(ast.right, context);
			if (typeof left === "string" && Array.isArray(right)) {
				return right.includes(left);
			}
			return false;
		}
		case "notin": {
			const left = getValue(ast.left, context);
			const right = getValue(ast.right, context);
			if (typeof left === "string" && Array.isArray(right)) {
				return !right.includes(left);
			}
			return false;
		}
	}
}

// ---------------------------------------------------------------------------
// Serialization (for debugging / UI)
// ---------------------------------------------------------------------------

export function serializeWhenExpr(ast: AST): string {
	switch (ast.type) {
		case "true":
			return "true";
		case "false":
			return "false";
		case "key":
			return ast.value;
		case "not":
			return `!${serializeWhenExpr(ast.operand)}`;
		case "and":
			return `${serializeWhenExpr(ast.left)} && ${serializeWhenExpr(ast.right)}`;
		case "or":
			return `${serializeWhenExpr(ast.left)} || ${serializeWhenExpr(ast.right)}`;
		case "eq":
			return `${serializeWhenExpr(ast.left)} == ${serializeWhenExpr(ast.right)}`;
		case "neq":
			return `${serializeWhenExpr(ast.left)} != ${serializeWhenExpr(ast.right)}`;
		case "gt":
			return `${serializeWhenExpr(ast.left)} > ${serializeWhenExpr(ast.right)}`;
		case "gte":
			return `${serializeWhenExpr(ast.left)} >= ${serializeWhenExpr(ast.right)}`;
		case "lt":
			return `${serializeWhenExpr(ast.left)} < ${serializeWhenExpr(ast.right)}`;
		case "lte":
			return `${serializeWhenExpr(ast.left)} <= ${serializeWhenExpr(ast.right)}`;
		case "in":
			return `${serializeWhenExpr(ast.left)} in ${serializeWhenExpr(ast.right)}`;
		case "notin":
			return `${serializeWhenExpr(ast.left)} not in ${serializeWhenExpr(ast.right)}`;
	}
}
