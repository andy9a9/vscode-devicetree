'use strict';

/**
 * All token kinds produced by the DTS lexer.
 *
 * Trivia tokens (Whitespace, LineComment, BlockComment) are always emitted so
 * every character in the source is covered.  Consumers that do not need them
 * can filter with `isTrivia()`.
 */
export enum TokenType {
    // --- Trivia (non-semantic) -----------------------------------------------
    Whitespace = 'Whitespace',
    LineComment = 'LineComment',
    BlockComment = 'BlockComment',

    // --- Preprocessor --------------------------------------------------------
    /** A complete `#include <path>` or `#include "path"` directive. */
    Include = 'Include',

    // --- DTS built-in directives (/dts-v1/, /delete-node/, ...) ---------------
    DtsDirective = 'DtsDirective',

    // --- Structural punctuation ----------------------------------------------
    LBrace = 'LBrace',       // {
    RBrace = 'RBrace',       // }
    LAngle = 'LAngle',       // <
    RAngle = 'RAngle',       // >
    LBracket = 'LBracket',   // [
    RBracket = 'RBracket',   // ]
    LParen = 'LParen',       // (
    RParen = 'RParen',       // )
    Semicolon = 'Semicolon', // ;
    Comma = 'Comma',         // ,
    Equals = 'Equals',       // =
    At = 'At',               // @
    Ampersand = 'Ampersand', // &
    Colon = 'Colon',         // :
    /**
     * A bare `/` that is NOT a DTS directive.
     * Used as the root-node reference (`/ {`) or as a path separator inside
     * `&{/path/to/node}` phandle references.
     */
    Slash = 'Slash',       // /

    // --- Literals ------------------------------------------------------------
    StringLiteral = 'StringLiteral',
    NumberLiteral = 'NumberLiteral',

    // --- Names ---------------------------------------------------------------
    /**
     * Any identifier-like token: node names, property names, labels, macro
     * names, and `#`-prefixed property names such as `#address-cells`.
     */
    Identifier = 'Identifier',

    // --- Sentinels -----------------------------------------------------------
    /** A character that could not be classified. */
    Unknown = 'Unknown',
    /** Synthetic end-of-file token (empty value). */
    EOF = 'EOF',
}

/** A single token produced by the lexer. */
export interface Token {
    readonly type: TokenType;
    /** Exact source text of this token (always empty for EOF). */
    readonly value: string;
    /** 0-based absolute character offset from the start of the document. */
    readonly offset: number;
    /** 0-based line number. */
    readonly line: number;
    /** 0-based column (character index within the line). */
    readonly column: number;
}

/**
 * Specialised token produced for `#include` directives.
 *
 * All positional fields refer to the full directive in source
 * (`#include <path>` or `#include "path"`).
 */
export interface IncludeToken extends Token {
    readonly type: TokenType.Include;
    /** The path string, without the surrounding `<>`/`""` delimiters. */
    readonly includePath: string;
    /** `true` when written as `<path>`, `false` when written as `"path"`. */
    readonly isSystem: boolean;
    /**
     * 0-based absolute character offset of the first character of
     * `includePath` within the document (i.e. the character right after `<`
     * or `"`).
     */
    readonly pathOffset: number;
}

/**
 * Type guard for `IncludeToken`.
 * @param t The token to test.
 * @returns Whether the token is an include directive.
 */
export function isIncludeToken(t: Token): t is IncludeToken {
    return t.type === TokenType.Include;
}

/**
 * Returns `true` for whitespace and comment tokens.
 * @param t The token to test.
 * @returns Whether the token is trivia.
 */
export function isTrivia(t: Token): boolean {
    return (
        t.type === TokenType.Whitespace ||
        t.type === TokenType.LineComment ||
        t.type === TokenType.BlockComment
    );
}

/**
 * Known DTS built-in directives.  These always follow the pattern
 * `/keyword/` and appear at statement level.
 *
 * Using a whitelist avoids false positives when `/` appears as a path
 * separator inside `&{/path/to/node}` phandle references.
 */
const DTS_DIRECTIVE_RE =
    /^\/(?:dts-v1|plugin|memreserve|delete-node|delete-property|bits|incbin|omit-if-no-ref)\//;

/**
 * Tokenises a complete DTS/DTSI source string.
 * @param source The source text to tokenize.
 * @returns The full token array.
 */
export class Lexer {
    private readonly src: string;
    private pos: number = 0;
    private line: number = 0;
    private col: number = 0;

    constructor(source: string) {
        this.src = source;
    }

    /**
     * Tokenise the entire source and return the complete token array.
     * The last element is always an `EOF` token.
     *
     * Calling `tokenize()` resets internal state, so the same `Lexer`
     * instance can be reused.
     */
    tokenize(): Token[] {
        this.pos = 0;
        this.line = 0;
        this.col = 0;

        const tokens: Token[] = [];
        while (this.pos < this.src.length) {
            tokens.push(this.next());
        }
        tokens.push(this.makeToken(TokenType.EOF, '', this.pos, this.line, this.col));
        return tokens;
    }

    /**
     * Peek at the character `ahead` positions from the current position.
     * @param ahead Number of characters to look ahead.
     * @returns The character at the requested position, or an empty string.
     */
    private ch(ahead = 0): string {
        return this.src[this.pos + ahead] ?? '';
    }

    /**
     * Advance `count` characters, updating line/column tracking.
     * Handles `\n` (LF) and `\r\n` (CRLF) line endings.
     */
    private advance(count = 1): void {
        for (let i = 0; i < count && this.pos < this.src.length; i++) {
            const c = this.src[this.pos];
            if (c === '\n') {
                this.line++;
                this.col = 0;
            } else if (c !== '\r') {
                // \r is only a meaningful line-ending when followed by \n;
                // treat the pair as a single newline (the \n increments line).
                this.col++;
            }
            this.pos++;
        }
    }

    /**
     * Create a token with source position metadata.
     * @param type The token type.
     * @param value The token text.
     * @param offset Absolute offset in the source.
     * @param line Zero-based line number.
     * @param column Zero-based column number.
     * @returns The constructed token.
     */
    private makeToken(
        type: TokenType,
        value: string,
        offset: number,
        line: number,
        column: number,
    ): Token {
        return { type, value, offset, line, column };
    }

    /**
     * Scan and return the next token from the source.
     * @returns The next token.
     */
    private next(): Token {
        const startPos = this.pos;
        const startLine = this.line;
        const startCol = this.col;
        const c = this.ch();

        // Whitespace
        if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
            return this.scanWhitespace(startPos, startLine, startCol);
        }

        // Comments
        if (c === '/' && this.ch(1) === '/') {
            return this.scanLineComment(startPos, startLine, startCol);
        }
        if (c === '/' && this.ch(1) === '*') {
            return this.scanBlockComment(startPos, startLine, startCol);
        }

        // Preprocessor / identifier starting with #
        if (c === '#') {
            return this.scanHash(startPos, startLine, startCol);
        }

        // String literal
        if (c === '"') {
            return this.scanString(startPos, startLine, startCol);
        }

        // / - DTS directive or plain slash
        if (c === '/') {
            return this.scanSlash(startPos, startLine, startCol);
        }

        // Number literals (decimal, hex, binary, octal)
        if (c >= '0' && c <= '9') {
            return this.scanNumber(startPos, startLine, startCol);
        }

        // Identifiers (letters, _, #-prefixed names like #address-cells)
        if (this.isIdentStart(c)) {
            return this.scanIdentifier(startPos, startLine, startCol);
        }

        // Single-character punctuation or unknown
        this.advance();
        return this.makeToken(this.punctType(c), c, startPos, startLine, startCol);
    }

    /**
     * Consume consecutive whitespace characters and return a Whitespace token.
     * @param startPos Start offset.
     * @param startLine Start line.
     * @param startCol Start column.
     * @returns The whitespace token.
     */
    private scanWhitespace(startPos: number, startLine: number, startCol: number): Token {
        while (this.pos < this.src.length && this.isWhitespace(this.ch())) {
            this.advance();
        }
        return this.makeToken(
            TokenType.Whitespace,
            this.src.slice(startPos, this.pos),
            startPos, startLine, startCol,
        );
    }

    /**
     * Consume a line comment and return a LineComment token.
     * @param startPos Start offset.
     * @param startLine Start line.
     * @param startCol Start column.
     * @returns The line comment token.
     */
    private scanLineComment(startPos: number, startLine: number, startCol: number): Token {
        this.advance(2); // consume '//'
        while (this.pos < this.src.length && this.ch() !== '\n') {
            this.advance();
        }
        return this.makeToken(
            TokenType.LineComment,
            this.src.slice(startPos, this.pos),
            startPos, startLine, startCol,
        );
    }

    /**
     * Consume a block comment and return a BlockComment token.
     * @param startPos Start offset.
     * @param startLine Start line.
     * @param startCol Start column.
     * @returns The block comment token.
     */
    private scanBlockComment(startPos: number, startLine: number, startCol: number): Token {
        this.advance(2); // consume '/*'
        while (this.pos < this.src.length) {
            if (this.ch() === '*' && this.ch(1) === '/') {
                this.advance(2); // consume '*/'
                break;
            }
            this.advance();
        }
        // If we reach EOF without a closing '*/': unterminated comment.
        // Still emit what was consumed; the syntax validator will flag it.
        return this.makeToken(
            TokenType.BlockComment,
            this.src.slice(startPos, this.pos),
            startPos, startLine, startCol,
        );
    }

    /**
     * Handle `#` - either a full `#include` directive or an identifier
     * like `#address-cells`.
     */
    private scanHash(startPos: number, startLine: number, startCol: number): Token {
        if (this.src.startsWith('#include', this.pos)) {
            return this.scanInclude(startPos, startLine, startCol);
        }
        return this.scanIdentifier(startPos, startLine, startCol);
    }

    /**
     * Parse a `#include <path>` or `#include "path"` directive.
     * @param startPos Start offset.
     * @param startLine Start line.
     * @param startCol Start column.
     * @returns The include token or malformed directive token.
     */
    private scanInclude(startPos: number, startLine: number, startCol: number): Token {
        this.advance(8); // consume '#include'

        // Skip horizontal whitespace between '#include' and the path
        while (this.pos < this.src.length && (this.ch() === ' ' || this.ch() === '\t')) {
            this.advance();
        }

        const delimiter = this.ch();
        if (delimiter !== '<' && delimiter !== '"') {
            // Malformed directive - emit consumed text as Unknown
            return this.makeToken(
                TokenType.Unknown,
                this.src.slice(startPos, this.pos),
                startPos, startLine, startCol,
            );
        }

        this.advance(); // consume opening '<' or '"'
        const pathStartOffset = this.pos;
        const closing = delimiter === '<' ? '>' : '"';

        while (this.pos < this.src.length && this.ch() !== closing && this.ch() !== '\n') {
            this.advance();
        }

        const includePath = this.src.slice(pathStartOffset, this.pos);

        if (this.pos < this.src.length && this.ch() === closing) {
            this.advance(); // consume closing '>' or '"'
        }

        const token: IncludeToken = {
            type: TokenType.Include,
            value: this.src.slice(startPos, this.pos),
            offset: startPos,
            line: startLine,
            column: startCol,
            includePath,
            isSystem: delimiter === '<',
            pathOffset: pathStartOffset,
        };
        return token;
    }

    /**
     * Consume a string literal, including escape sequences.
     * @param startPos Start offset.
     * @param startLine Start line.
     * @param startCol Start column.
     * @returns The string literal token.
     */
    private scanString(startPos: number, startLine: number, startCol: number): Token {
        this.advance(); // consume opening '"'
        while (this.pos < this.src.length) {
            const c = this.ch();
            if (c === '\\') {
                this.advance(2); // skip escape + following char
                continue;
            }
            if (c === '"') {
                this.advance(); // consume closing '"'
                break;
            }
            if (c === '\n') {
                // Unterminated string literal - stop at line boundary.
                // The syntax validator will flag this.
                break;
            }
            this.advance();
        }
        return this.makeToken(
            TokenType.StringLiteral,
            this.src.slice(startPos, this.pos),
            startPos, startLine, startCol,
        );
    }

    /**
     * `/` - either a whitelisted DTS directive (`/dts-v1/`, `/delete-node/`,
     * ...) or a plain slash used as the root-node token or a path separator.
     */
    private scanSlash(startPos: number, startLine: number, startCol: number): Token {
        const match = DTS_DIRECTIVE_RE.exec(this.src.slice(this.pos));
        if (match) {
            this.advance(match[0].length);
            return this.makeToken(
                TokenType.DtsDirective,
                match[0],
                startPos, startLine, startCol,
            );
        }
        this.advance();
        return this.makeToken(TokenType.Slash, '/', startPos, startLine, startCol);
    }

    /**
     * Parse a decimal, hex, binary, or octal number literal.
     * @param startPos Start offset.
     * @param startLine Start line.
     * @param startCol Start column.
     * @returns The number literal token.
     */
    private scanNumber(startPos: number, startLine: number, startCol: number): Token {
        if (this.ch() === '0') {
            const next = this.ch(1);
            if (next === 'x' || next === 'X') {
                // Hexadecimal  0x...
                this.advance(2);
                while (this.isHexDigit(this.ch())) {
                    this.advance();
                }
            } else if (next === 'b' || next === 'B') {
                // Binary  0b...
                this.advance(2);
                while (this.ch() === '0' || this.ch() === '1') {
                    this.advance();
                }
            } else {
                // Decimal / octal
                while (this.isDecDigit(this.ch())) {
                    this.advance();
                }
            }
        } else {
            while (this.isDecDigit(this.ch())) {
                this.advance();
            }
        }
        return this.makeToken(
            TokenType.NumberLiteral,
            this.src.slice(startPos, this.pos),
            startPos, startLine, startCol,
        );
    }

    /**
     * Consume an identifier token, including DTS macro-style names.
     * @param startPos Start offset.
     * @param startLine Start line.
     * @param startCol Start column.
     * @returns The identifier token.
     */
    private scanIdentifier(startPos: number, startLine: number, startCol: number): Token {
        while (this.pos < this.src.length && this.isIdentBody(this.ch())) {
            this.advance();
        }
        return this.makeToken(
            TokenType.Identifier,
            this.src.slice(startPos, this.pos),
            startPos, startLine, startCol,
        );
    }

    /**
     * Return true when the character is whitespace.
     * @param c The character to test.
     * @returns Whether the character is whitespace.
     */
    private isWhitespace(c: string): boolean {
        return c === ' ' || c === '\t' || c === '\r' || c === '\n';
    }

    /**
     * Return true when the character is a decimal digit.
     * @param c The character to test.
     * @returns Whether the character is a decimal digit.
     */
    private isDecDigit(c: string): boolean {
        return c >= '0' && c <= '9';
    }

    /**
     * Return true when the character is a hexadecimal digit.
     * @param c The character to test.
     * @returns Whether the character is a hexadecimal digit.
     */
    private isHexDigit(c: string): boolean {
        return (
            (c >= '0' && c <= '9') ||
            (c >= 'a' && c <= 'f') ||
            (c >= 'A' && c <= 'F')
        );
    }

    /**
     * Characters that may *start* a DTS identifier.
     *
     * Covers node names, property names (incl. `#`-prefixed ones like
     * `#address-cells`), and C-style macro names used as property values.
     */
    private isIdentStart(c: string): boolean {
        return (
            (c >= 'a' && c <= 'z') ||
            (c >= 'A' && c <= 'Z') ||
            c === '_'
            // Note: '#' is handled separately in scanHash() before we reach
            // here, and falls through to scanIdentifier() when it is not
            // '#include'.
        );
    }

    /**
     * Characters that may *continue* a DTS identifier.
     *
     * Permissive superset covering:
     * - Node names:     `[a-zA-Z0-9,._+\-]`
     * - Property names: `[a-zA-Z0-9,._+\-?#]`
     * - Labels:         `[a-zA-Z0-9_]`
     * - Macro names:    `[a-zA-Z0-9_]`
     */
    private isIdentBody(c: string): boolean {
        return (
            this.isIdentStart(c) ||
            this.isDecDigit(c) ||
            c === '-' ||
            c === ',' ||
            c === '.' ||
            c === '+' ||
            c === '?' ||
            c === '#'
        );
    }

    /**
     * Map a single punctuation character to its token type.
     * @param c The character to classify.
     * @returns The corresponding token type.
     */
    private punctType(c: string): TokenType {
        switch (c) {
            case '{': return TokenType.LBrace;
            case '}': return TokenType.RBrace;
            case '<': return TokenType.LAngle;
            case '>': return TokenType.RAngle;
            case '[': return TokenType.LBracket;
            case ']': return TokenType.RBracket;
            case '(': return TokenType.LParen;
            case ')': return TokenType.RParen;
            case ';': return TokenType.Semicolon;
            case ',': return TokenType.Comma;
            case '=': return TokenType.Equals;
            case '@': return TokenType.At;
            case '&': return TokenType.Ampersand;
            case ':': return TokenType.Colon;
            default: return TokenType.Unknown;
        }
    }
}

/**
 * Tokenize a complete DTS/DTSI source string.
 * @param source The source text to tokenize.
 * @returns The full token array.
 */
export function tokenize(source: string): Token[] {
    return new Lexer(source).tokenize();
}
