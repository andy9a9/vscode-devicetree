import * as assert from 'assert';
import { Lexer, TokenType, tokenize, isIncludeToken, isTrivia } from '../parser/lexer';

/** Return only non-trivia tokens (excluding EOF). */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function meaningful(src: string) {
    return tokenize(src).filter(t => !isTrivia(t) && t.type !== TokenType.EOF);
}

/** Return types of meaningful tokens. */
function types(src: string): TokenType[] {
    return meaningful(src).map(t => t.type);
}

/** Return values of meaningful tokens. */
function values(src: string): string[] {
    return meaningful(src).map(t => t.value);
}

suite('Lexer - tokenize()', () => {

    test('empty string -> only EOF', () => {
        const tokens = tokenize('');
        assert.strictEqual(tokens.length, 1);
        assert.strictEqual(tokens[0].type, TokenType.EOF);
        assert.strictEqual(tokens[0].value, '');
    });

    test('whitespace emitted as single Whitespace token', () => {
        const tokens = tokenize('   \t\n  ');
        assert.strictEqual(tokens[0].type, TokenType.Whitespace);
        assert.strictEqual(tokens[0].value, '   \t\n  ');
    });

    test('line comment', () => {
        const tokens = tokenize('// hello world');
        assert.strictEqual(tokens[0].type, TokenType.LineComment);
        assert.strictEqual(tokens[0].value, '// hello world');
    });

    test('line comment stops at newline', () => {
        const [comment, ws] = tokenize('// hi\nnext');
        assert.strictEqual(comment.type, TokenType.LineComment);
        assert.strictEqual(comment.value, '// hi');
        assert.strictEqual(ws.type, TokenType.Whitespace);
        assert.strictEqual(ws.value, '\n');
    });

    test('block comment', () => {
        const tokens = tokenize('/* multi\nline */');
        assert.strictEqual(tokens[0].type, TokenType.BlockComment);
        assert.strictEqual(tokens[0].value, '/* multi\nline */');
    });

    test('unterminated block comment -> still emits BlockComment', () => {
        const tokens = tokenize('/* no close');
        assert.strictEqual(tokens[0].type, TokenType.BlockComment);
        assert.ok(!tokens[0].value.endsWith('*/'));
    });

    test('#include <system>', () => {
        const tokens = tokenize('#include <dt-bindings/gpio/gpio.h>');
        const inc = tokens[0];
        assert.ok(isIncludeToken(inc));
        assert.strictEqual(inc.includePath, 'dt-bindings/gpio/gpio.h');
        assert.strictEqual(inc.isSystem, true);
        assert.strictEqual(inc.value, '#include <dt-bindings/gpio/gpio.h>');
    });

    test('#include "local"', () => {
        const tokens = tokenize('#include "imx8mp.dtsi"');
        const inc = tokens[0];
        assert.ok(isIncludeToken(inc));
        assert.strictEqual(inc.includePath, 'imx8mp.dtsi');
        assert.strictEqual(inc.isSystem, false);
    });

    test('#include pathOffset points to first char of path', () => {
        const src = '#include <gpio.h>';
        const tokens = tokenize(src);
        assert.ok(isIncludeToken(tokens[0]));
        const inc = tokens[0];
        assert.strictEqual(src[inc.pathOffset], 'g');
        assert.strictEqual(src.slice(inc.pathOffset, inc.pathOffset + inc.includePath.length), 'gpio.h');
    });

    test('/dts-v1/ emitted as DtsDirective', () => {
        assert.deepStrictEqual(types('/dts-v1/;'), [TokenType.DtsDirective, TokenType.Semicolon]);
        assert.deepStrictEqual(values('/dts-v1/;'), ['/dts-v1/', ';']);
    });

    test('/delete-node/ emitted as DtsDirective', () => {
        assert.strictEqual(types('/delete-node/')[0], TokenType.DtsDirective);
    });

    test('/plugin/ emitted as DtsDirective', () => {
        assert.strictEqual(types('/plugin/;')[0], TokenType.DtsDirective);
    });

    test('/omit-if-no-ref/ emitted as DtsDirective', () => {
        assert.strictEqual(types('/omit-if-no-ref/')[0], TokenType.DtsDirective);
    });

    test('root-node / emitted as Slash (not a directive)', () => {
        assert.strictEqual(types('/ {')[0], TokenType.Slash);
    });

    test('path separator / inside &{} emitted as Slash', () => {
        // In &{/cpus/cpu@0}, each / is a Slash
        const ts = types('&{/cpus}');
        assert.ok(ts.includes(TokenType.Slash));
        assert.ok(!ts.includes(TokenType.DtsDirective));
    });

    test('simple identifier', () => {
        assert.deepStrictEqual(values('model'), ['model']);
        assert.strictEqual(types('model')[0], TokenType.Identifier);
    });

    test('identifier with hyphens and underscores', () => {
        assert.deepStrictEqual(values('gpio-leds'), ['gpio-leds']);
    });

    test('#address-cells scanned as Identifier', () => {
        const ts = meaningful('#address-cells');
        assert.strictEqual(ts[0].type, TokenType.Identifier);
        assert.strictEqual(ts[0].value, '#address-cells');
    });

    test('#size-cells scanned as Identifier', () => {
        const ts = meaningful('#size-cells');
        assert.strictEqual(ts[0].type, TokenType.Identifier);
        assert.strictEqual(ts[0].value, '#size-cells');
    });

    test('string literal', () => {
        assert.strictEqual(types('"hello"')[0], TokenType.StringLiteral);
        assert.strictEqual(values('"hello"')[0], '"hello"');
    });

    test('string with escape sequence', () => {
        assert.strictEqual(values('"a\\"b"')[0], '"a\\"b"');
    });

    test('unterminated string stops at newline', () => {
        const tokens = tokenize('"unclosed\nnext');
        assert.strictEqual(tokens[0].type, TokenType.StringLiteral);
        assert.strictEqual(tokens[0].value, '"unclosed');
    });

    test('decimal number', () => {
        assert.strictEqual(types('42')[0], TokenType.NumberLiteral);
        assert.strictEqual(values('42')[0], '42');
    });

    test('hexadecimal number', () => {
        assert.strictEqual(types('0x1A2B')[0], TokenType.NumberLiteral);
        assert.strictEqual(values('0x1A2B')[0], '0x1A2B');
    });

    test('hex with uppercase 0X', () => {
        assert.strictEqual(values('0XFF')[0], '0XFF');
    });

    test('binary number', () => {
        assert.strictEqual(values('0b1010')[0], '0b1010');
    });

    test('all punctuation tokens', () => {
        const src = '{ } < > [ ] ( ) ; , = @ & :';
        const expected = [
            TokenType.LBrace, TokenType.RBrace,
            TokenType.LAngle, TokenType.RAngle,
            TokenType.LBracket, TokenType.RBracket,
            TokenType.LParen, TokenType.RParen,
            TokenType.Semicolon, TokenType.Comma,
            TokenType.Equals, TokenType.At,
            TokenType.Ampersand, TokenType.Colon,
        ];
        assert.deepStrictEqual(types(src), expected);
    });

    test('offset of first token is 0', () => {
        const tokens = tokenize('model');
        assert.strictEqual(tokens[0].offset, 0);
    });

    test('token offsets advance correctly', () => {
        const tokens = meaningful('ab cd');
        assert.strictEqual(tokens[0].offset, 0);  // 'ab'
        assert.strictEqual(tokens[1].offset, 3);  // 'cd'
    });

    test('line/column tracking across newlines', () => {
        const src = 'a\nb';
        const tokens = tokenize(src).filter(t => t.type !== TokenType.EOF);
        const [a, nl, b] = tokens;
        assert.strictEqual(a.line, 0);
        assert.strictEqual(a.column, 0);
        assert.strictEqual(nl.line, 0);  // whitespace token starts on line 0
        assert.strictEqual(b.line, 1);
        assert.strictEqual(b.column, 0);
    });

    test('column resets to 0 after newline', () => {
        const src = 'abc\ndef';
        const toks = tokenize(src).filter(t => t.type === TokenType.Identifier);
        assert.strictEqual(toks[0].column, 0); // 'abc'
        assert.strictEqual(toks[1].column, 0); // 'def'
    });

    test('column advances within a line', () => {
        const src = 'abc def';
        const toks = tokenize(src).filter(t => t.type === TokenType.Identifier);
        assert.strictEqual(toks[0].column, 0);
        assert.strictEqual(toks[1].column, 4);
    });

    test('property assignment  model = "Board";', () => {
        const ts = types('model = "Board";');
        assert.deepStrictEqual(ts, [
            TokenType.Identifier,
            TokenType.Equals,
            TokenType.StringLiteral,
            TokenType.Semicolon,
        ]);
    });

    test('cell array  reg = <0x40000000 0x80000000>;', () => {
        const ts = types('reg = <0x40000000 0x80000000>;');
        assert.deepStrictEqual(ts, [
            TokenType.Identifier,
            TokenType.Equals,
            TokenType.LAngle,
            TokenType.NumberLiteral,
            TokenType.NumberLiteral,
            TokenType.RAngle,
            TokenType.Semicolon,
        ]);
    });

    test('node with label and unit address', () => {
        // uart2: serial@30890000 {
        const ts = types('uart2: serial@30890000 {');
        assert.deepStrictEqual(ts, [
            TokenType.Identifier,  // uart2
            TokenType.Colon,
            TokenType.Identifier,  // serial
            TokenType.At,
            TokenType.NumberLiteral, // 30890000
            TokenType.LBrace,
        ]);
    });

    test('phandle reference  &gpio3', () => {
        const ts = types('&gpio3');
        assert.deepStrictEqual(ts, [TokenType.Ampersand, TokenType.Identifier]);
    });

    test('full DTS-v1 header line', () => {
        const ts = types('/dts-v1/;');
        assert.deepStrictEqual(ts, [TokenType.DtsDirective, TokenType.Semicolon]);
    });

    test('block comment spanning multiple lines preserved', () => {
        const src = '/* Copyright\n * 2024 NXP\n */\n/dts-v1/;';
        const all = tokenize(src);
        assert.strictEqual(all[0].type, TokenType.BlockComment);
        assert.ok(all[0].value.startsWith('/*'));
        assert.ok(all[0].value.endsWith('*/'));
    });

    test('isTrivia correctly identifies trivia tokens', () => {
        const tokens = tokenize('/* c */ a // l\n');
        assert.ok(isTrivia(tokens[0]));    // BlockComment
        assert.ok(!isTrivia(tokens[2]));   // Identifier  (a)
        assert.ok(isTrivia(tokens[4]));    // LineComment
    });

    test('Lexer instance can be reused (tokenize resets state)', () => {
        const lexer = new Lexer('abc');
        const first = lexer.tokenize();
        const second = lexer.tokenize();
        assert.deepStrictEqual(first, second);
    });
});
