'use strict';

import * as vscode from 'vscode';
import { Token, TokenType, tokenize, isTrivia } from '../../parser/lexer';

/**
 * Internal types
 */

/**
 * Token types that open a bracket pair.
 */
type OpenerType =
    | TokenType.LBrace
    | TokenType.LAngle
    | TokenType.LBracket
    | TokenType.LParen;

/**
 * One entry on the bracket-matching stack.
 */
interface BracketFrame {
    readonly opener: OpenerType;
    readonly token: Token;
}

/**
 * Mutable depth counters for the three non-brace bracket pairs.
 */
interface Depths {
    angle: number;
    bracket: number;
    paren: number;
}

/**
 * Maps each opener to the closer that must follow it.
 */
const EXPECTED_CLOSER: Readonly<Record<OpenerType, TokenType>> = {
    [TokenType.LBrace]: TokenType.RBrace,
    [TokenType.LAngle]: TokenType.RAngle,
    [TokenType.LBracket]: TokenType.RBracket,
    [TokenType.LParen]: TokenType.RParen,
};

/**
 * Human-readable single character for a bracket token type.
 * @param type The token type to convert.
 * @returns A one-character bracket string, or `?`.
 */
function bracketChar(type: TokenType): string {
    switch (type) {
        case TokenType.LBrace: return '{';
        case TokenType.RBrace: return '}';
        case TokenType.LAngle: return '<';
        case TokenType.RAngle: return '>';
        case TokenType.LBracket: return '[';
        case TokenType.RBracket: return ']';
        case TokenType.LParen: return '(';
        case TokenType.RParen: return ')';
        default: return '?';
    }
}

/**
 * For a closer, return the opener it expects.
 * @param closerType The closing token type.
 * @returns The matching opener token type.
 */
function expectedOpener(closerType: TokenType): TokenType {
    switch (closerType) {
        case TokenType.RBrace: return TokenType.LBrace;
        case TokenType.RAngle: return TokenType.LAngle;
        case TokenType.RBracket: return TokenType.LBracket;
        case TokenType.RParen: return TokenType.LParen;
        default: return TokenType.Unknown;
    }
}

/**
 * Syntax validator for DeviceTree source files.
 *
 * Checks performed on every document save/change:
 *  1. Balanced bracket pairs  { } < > [ ] ( )
 *     - unmatched openers  (no closing counterpart)
 *     - unexpected closers (no prior opener on the stack)
 *     - mismatched pairs   (e.g. `<` closed by `)`)
 *  2. Unterminated string literals
 *  3. Unterminated block comments
 *  4. Missing `;` after a property value (string literal or cell / byte array)
 *     at the top level of a value context (i.e. not nested inside `<>` etc.)
 *
 * Syntax errors use `DiagnosticSeverity.Error` and a separate diagnostic
 * collection (`'devicetree-syntax'`) so they are independent from the style
 * warnings produced by `DtsDiagnosticsProvider`.
 */
export class DtsSyntaxValidator {
    private diagnosticCollection: vscode.DiagnosticCollection;

    /**
     * Create a syntax validator with its own diagnostic collection.
     */
    constructor() {
        this.diagnosticCollection =
            vscode.languages.createDiagnosticCollection('devicetree-syntax');
    }

    /**
     * Re-validate a document and update the diagnostic collection.
     * @param document The document to validate.
     */
    validateDocument(document: vscode.TextDocument): void {
        if (document.languageId !== 'dts') {
            return;
        }
        const tokens = tokenize(document.getText());
        const diagnostics = this.validate(tokens);
        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /**
     * Remove diagnostics for a closed document.
     * @param document The document whose diagnostics should be removed.
     */
    clearDocument(document: vscode.TextDocument): void {
        this.diagnosticCollection.delete(document.uri);
    }

    /**
     * Dispose the underlying diagnostic collection.
     */
    dispose(): void {
        this.diagnosticCollection.dispose();
    }

    /**
     * Build a VS Code `Range` from a token's start position.
     * @param token The token to underline.
     * @param lengthOverride Optional length override for the underline.
     * @returns The VS Code range covering the token.
     */
    private tokenRange(token: Token, lengthOverride?: number): vscode.Range {
        const len = lengthOverride ?? token.value.length;
        return new vscode.Range(
            new vscode.Position(token.line, token.column),
            new vscode.Position(token.line, token.column + len),
        );
    }

    /**
     * Create an error diagnostic for a token, with optional length override.
     * @param token The token to underline.
     * @param message The diagnostic message.
     * @param lengthOverride Optional length override for the underline.
     * @returns The created diagnostic.
     */
    private makeError(token: Token, message: string, lengthOverride?: number): vscode.Diagnostic {
        const d = new vscode.Diagnostic(
            this.tokenRange(token, lengthOverride),
            message,
            vscode.DiagnosticSeverity.Error,
        );
        d.source = 'DeviceTree';
        return d;
    }

    /**
     * Core validation pass.
     * @param tokens The token list to validate.
     * @returns Validation diagnostics.
     */
    private validate(tokens: Token[]): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];

        // Keep comments (for termination checks) but drop whitespace and EOF.
        const relevant = tokens.filter(
            t => t.type !== TokenType.Whitespace && t.type !== TokenType.EOF
        );

        const stack: BracketFrame[] = [];
        const depths: Depths = { angle: 0, bracket: 0, paren: 0 };
        let awaitingSemicolon: Token | null = null;

        for (let i = 0; i < relevant.length; i++) {
            const token = relevant[i];

            awaitingSemicolon = this.maybeCheckSemicolon(token, awaitingSemicolon, diagnostics);

            switch (token.type) {
                case TokenType.LBrace:
                case TokenType.LAngle:
                case TokenType.LBracket:
                case TokenType.LParen:
                    this.checkOpenerContext(token, relevant, i, depths, diagnostics);
                    this.handleOpener(token, stack, depths);
                    break;

                case TokenType.Identifier:
                    this.checkConsecutiveIdentifiers(
                        token, this.findPrevNonTrivia(relevant, i - 1), depths, diagnostics);
                    break;

                case TokenType.RBrace:
                    this.processRBrace(token, stack, relevant, i, diagnostics);
                    break;

                case TokenType.RAngle:
                case TokenType.RBracket:
                case TokenType.RParen:
                    awaitingSemicolon = this.handleCloser(token, stack, depths, diagnostics);
                    break;

                case TokenType.StringLiteral:
                    awaitingSemicolon = this.handleString(token, depths, diagnostics);
                    break;

                case TokenType.BlockComment:
                    this.handleBlockComment(token, diagnostics);
                    break;

                case TokenType.Semicolon:
                case TokenType.Comma:
                    this.checkComma(token, relevant, i, depths, diagnostics);
                    break;

                default:
                    break;
            }
        }

        this.reportUnmatchedOpeners(stack, diagnostics);
        return diagnostics;
    }

    /**
     * Report an error for every opener left on the stack at end of input.
     * @param stack The opener stack.
     * @param diagnostics The diagnostics list to append to.
     */
    private reportUnmatchedOpeners(stack: BracketFrame[], diagnostics: vscode.Diagnostic[]): void {
        for (const frame of stack) {
            const expected = bracketChar(EXPECTED_CLOSER[frame.opener]);
            diagnostics.push(this.makeError(frame.token,
                `Unmatched '${frame.token.value}': no closing '${expected}' found`));
        }
    }

    /**
     * After a value-ending token, check whether the next non-trivia token is
     * ';' / ',' (valid) or something that indicates a missing separator.
     * @param token The next non-trivia token.
     * @param awaitingToken The token that ended the previous value.
     * @param diagnostics The diagnostics list to append to.
     * @returns Always `null` to clear `awaitingSemicolon`.
     */
    private checkSemicolon(
        token: Token,
        awaitingToken: Token,
        diagnostics: vscode.Diagnostic[],
    ): Token | null {
        if (token.type === TokenType.Semicolon || token.type === TokenType.Comma) {
            return null;
        }
        if (token.type === TokenType.Identifier || token.type === TokenType.RBrace) {
            diagnostics.push(this.makeError(awaitingToken, "Missing ';' after property value"));
        } else if (token.type === TokenType.LAngle || token.type === TokenType.LBracket ||
            token.type === TokenType.StringLiteral) {
            diagnostics.push(this.makeError(awaitingToken, "Missing ',' between property values"));
        } else if (token.type === TokenType.Unknown) {
            diagnostics.push(this.makeError(token, 'Unexpected token after property value'));
        }
        // Reset regardless to avoid cascading false positives.
        return null;
    }

    /**
     * Check a comma or semicolon token for common structural errors.
     * @param token The punctuation token to inspect.
     * @param relevant The non-trivia token list.
     * @param index Index of the token in `relevant`.
     * @param depths Current nesting depths.
     * @param diagnostics The diagnostics list to append to.
     */
    private checkComma(
        token: Token,
        relevant: Token[],
        index: number,
        depths: Depths,
        diagnostics: vscode.Diagnostic[],
    ): void {
        if (depths.angle > 0 && depths.paren === 0) {
            const what = token.type === TokenType.Comma ? 'comma' : 'semicolon';
            diagnostics.push(this.makeError(token, `Unexpected ${what} in cell array`));
            return;
        }
        if (token.type !== TokenType.Comma) { return; }
        if (depths.angle > 0 || depths.bracket > 0 || depths.paren > 0) { return; }
        const prev = this.findPrevNonTrivia(relevant, index - 1);
        if (prev?.type === TokenType.Comma) {
            diagnostics.push(this.makeError(token, 'Unexpected consecutive commas'));
            return;
        }
        const next = this.findNextNonTrivia(relevant, index + 1);
        if (next?.type === TokenType.Semicolon) {
            diagnostics.push(this.makeError(token, "Trailing comma before end of property"));
        }
    }

    /**
     * When an opening bracket is about to be pushed, check for a bare `<`
     * appearing directly after a `;` at the top level.
     * @param token The opener token.
     * @param relevant The non-trivia token list.
     * @param index Index of the token in `relevant`.
     * @param depths Current nesting depths.
     * @param diagnostics The diagnostics list to append to.
     */
    private checkOpenerContext(
        token: Token,
        relevant: Token[],
        index: number,
        depths: Depths,
        diagnostics: vscode.Diagnostic[],
    ): void {
        if (token.type !== TokenType.LAngle) { return; }
        if (depths.angle > 0 || depths.bracket > 0 || depths.paren > 0) { return; }
        const prev = this.findPrevNonTrivia(relevant, index - 1);
        if (prev?.type === TokenType.Semicolon) {
            diagnostics.push(this.makeError(token,
                "Unexpected '<': cell array without property name"));
        }
    }

    /**
     * Delegate the missing-separator check only for non-trivia tokens.
     * @param token The current token.
     * @param awaiting The token that ended the previous value, if any.
     * @param diagnostics The diagnostics list to append to.
     * @returns The next awaiting token, or `null`.
     */
    private maybeCheckSemicolon(
        token: Token,
        awaiting: Token | null,
        diagnostics: vscode.Diagnostic[],
    ): Token | null {
        if (awaiting === null || isTrivia(token)) { return awaiting; }
        return this.checkSemicolon(token, awaiting, diagnostics);
    }

    /**
     * Report an error when two `Identifier` tokens appear back-to-back at
     * the top level (outside `<>`, `[]`, `()`).
     * @param token The current identifier token.
     * @param prev The previous non-trivia token.
     * @param depths Current nesting depths.
     * @param diagnostics The diagnostics list to append to.
     */
    private checkConsecutiveIdentifiers(
        token: Token,
        prev: Token | null,
        depths: Depths,
        diagnostics: vscode.Diagnostic[],
    ): void {
        if (token.type !== TokenType.Identifier) { return; }
        if (prev?.type !== TokenType.Identifier) { return; }
        if (depths.angle > 0 || depths.bracket > 0 || depths.paren > 0) { return; }
        diagnostics.push(this.makeError(token,
            `Unexpected identifier - possible space in '${prev.value} ${token.value}'`));
    }

    /**
     * Find the previous non-trivia token before `startIndex`.
     * @param tokens The token list to search.
     * @param startIndex The starting index.
     * @returns The previous non-trivia token, or `null`.
     */
    private findPrevNonTrivia(tokens: Token[], startIndex: number): Token | null {
        for (let i = startIndex; i >= 0; i--) {
            if (!isTrivia(tokens[i])) {
                return tokens[i];
            }
        }
        return null;
    }

    /**
     * Find the next non-trivia token at or after `startIndex`.
     * @param tokens The token list to search.
     * @param startIndex The starting index.
     * @returns The next non-trivia token, or `null`.
     */
    private findNextNonTrivia(tokens: Token[], startIndex: number): Token | null {
        for (let i = startIndex; i < tokens.length; i++) {
            if (!isTrivia(tokens[i])) {
                return tokens[i];
            }
        }
        return null;
    }

    /**
     * Validate a closing `}`, returning `true` if it successfully matched
     * and popped the corresponding `{` from the stack.
     * @param token The closing brace token.
     * @param stack The opener stack.
     * @param diagnostics The diagnostics list to append to.
     * @returns `true` when the brace matched a node opener.
     */
    private handleRBrace(token: Token, stack: BracketFrame[], diagnostics: vscode.Diagnostic[]): boolean {
        // Drain any unclosed inner brackets above the nearest '{'.
        while (stack.length > 0 && stack[stack.length - 1].opener !== TokenType.LBrace) {
            const unclosed = stack.pop();
            if (unclosed === undefined) { break; }
            const expected = bracketChar(EXPECTED_CLOSER[unclosed.opener]);
            diagnostics.push(this.makeError(unclosed.token,
                `Unmatched '${unclosed.token.value}': no closing '${expected}' found`));
        }
        if (stack.length === 0) {
            diagnostics.push(this.makeError(token,
                `Unexpected '${token.value}': no matching '${bracketChar(expectedOpener(token.type))}'`
            ));
            return false;
        }
        stack.pop();
        return true;
    }

    /**
     * Handle a closing `}`: match it on the stack and then check whether the
     * closing brace requires a trailing `;`.
     * @param token The closing brace token.
     * @param stack The opener stack.
     * @param relevant The non-trivia token list.
     * @param index Index of the token in `relevant`.
     * @param diagnostics The diagnostics list to append to.
     */
    private processRBrace(
        token: Token,
        stack: BracketFrame[],
        relevant: Token[],
        index: number,
        diagnostics: vscode.Diagnostic[],
    ): void {
        const popped = this.handleRBrace(token, stack, diagnostics);
        if (popped) {
            this.checkNodeSemicolon(token, stack, relevant, index, diagnostics);
        }
    }

    /**
     * After a `}` successfully closes a node body, report "Missing ';'" for
     * unambiguous cases.
     * @param token The closing brace token.
     * @param stack The opener stack.
     * @param relevant The non-trivia token list.
     * @param index Index of the token in `relevant`.
     * @param diagnostics The diagnostics list to append to.
     */
    private checkNodeSemicolon(
        token: Token,
        stack: BracketFrame[],
        relevant: Token[],
        index: number,
        diagnostics: vscode.Diagnostic[],
    ): void {
        const next = this.findNextNonTrivia(relevant, index + 1);
        if (next !== null && (next.type === TokenType.Semicolon || next.type === TokenType.Comma)) {
            return;
        }
        const nextIsRBrace = next !== null && next.type === TokenType.RBrace;
        if (next === null || next.type === TokenType.Identifier || (nextIsRBrace && stack.length > 0)) {
            diagnostics.push(this.makeError(token, "Missing ';' after node body"));
        }
    }

    /**
     * Push an opening bracket onto the stack and increment its depth counter.
     * @param token The opening token.
     * @param stack The opener stack.
     * @param depths The mutable depth counters.
     */
    private handleOpener(token: Token, stack: BracketFrame[], depths: Depths): void {
        stack.push({ opener: token.type as OpenerType, token });
        if (token.type === TokenType.LAngle) { depths.angle++; }
        if (token.type === TokenType.LBracket) { depths.bracket++; }
        if (token.type === TokenType.LParen) { depths.paren++; }
    }

    /**
     * Validate a closing bracket, update depth counters, and return a new
     * `awaitingSemicolon` token when a cell / byte array closes at top level.
     * @param token The closing token.
     * @param stack The opener stack.
     * @param depths The mutable depth counters.
     * @param diagnostics The diagnostics list to append to.
     * @returns The token that should await a terminator, or `null`.
     */
    private handleCloser(
        token: Token,
        stack: BracketFrame[],
        depths: Depths,
        diagnostics: vscode.Diagnostic[],
    ): Token | null {
        if (token.type === TokenType.RAngle) { depths.angle = Math.max(0, depths.angle - 1); }
        if (token.type === TokenType.RBracket) { depths.bracket = Math.max(0, depths.bracket - 1); }
        if (token.type === TokenType.RParen) { depths.paren = Math.max(0, depths.paren - 1); }

        if (stack.length === 0) {
            diagnostics.push(this.makeError(token,
                `Unexpected '${token.value}': no matching '${bracketChar(expectedOpener(token.type))}'`
            ));
            return null;
        }

        const top = stack[stack.length - 1];
        const expectedCloser = EXPECTED_CLOSER[top.opener];
        if (token.type !== expectedCloser) {
            // Wrong closer - do NOT pop; keeps the opener on the stack so
            // we avoid cascading errors from a single typo.
            if (token.type === TokenType.RAngle) { depths.angle++; }
            if (token.type === TokenType.RBracket) { depths.bracket++; }
            if (token.type === TokenType.RParen) { depths.paren++; }

            diagnostics.push(this.makeError(token,
                `Mismatched '${token.value}': expected '${bracketChar(expectedCloser)}' ` +
                `to close '${top.token.value}' at line ${top.token.line + 1}`
            ));
        } else {
            stack.pop();
        }

        const atValueTop =
            (token.type === TokenType.RAngle && depths.angle === 0) ||
            (token.type === TokenType.RBracket && depths.bracket === 0);
        return atValueTop ? token : null;
    }

    /**
     * Check for an unterminated string and arm the missing-semicolon check
     * when the string is complete and at the top level of a value context.
     * @param token The string literal token.
     * @param depths The mutable depth counters.
     * @param diagnostics The diagnostics list to append to.
     * @returns The token that should await a terminator, or `null`.
     */
    private handleString(
        token: Token,
        depths: Depths,
        diagnostics: vscode.Diagnostic[],
    ): Token | null {
        if (!token.value.endsWith('"')) {
            diagnostics.push(this.makeError(token, 'Unterminated string literal'));
            return null;
        }
        const atValueTop = depths.angle === 0 && depths.bracket === 0 && depths.paren === 0;
        return atValueTop ? token : null;
    }

    /**
     * Check for an unterminated block comment, underlining only the `/*`.
     * @param token The block comment token.
     * @param diagnostics The diagnostics list to append to.
     */
    private handleBlockComment(token: Token, diagnostics: vscode.Diagnostic[]): void {
        if (!token.value.endsWith('*/')) {
            diagnostics.push(this.makeError(token,
                'Unterminated block comment', /* lengthOverride */ 2));
        }
    }
}

