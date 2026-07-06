import * as assert from 'assert';
import * as vscode from 'vscode';

// Shared setup
suiteSetup(async () => {
    const extension = vscode.extensions.getExtension('andy9a9.vscode-devicetree');
    if (extension && !extension.isActive) {
        await extension.activate();
    }
});

/**
 * Open a DTS document with the given content, wait for the syntax validator
 * to run, and return only the Error-severity diagnostics.
 * (Warnings from the style-diagnostics provider are filtered out so tests
 *  remain independent of line-length settings.)
 */
async function getSyntaxErrors(content: string): Promise<vscode.Diagnostic[]> {
    const doc = await vscode.workspace.openTextDocument({
        language: 'dts',
        content,
    });

    await new Promise(resolve => setTimeout(resolve, 700));

    return vscode.languages
        .getDiagnostics(doc.uri)
        .filter(d => d.severity === vscode.DiagnosticSeverity.Error);
}

suite('DTS Syntax Validator - valid input', () => {

    test('minimal valid file produces no errors', async () => {
        const errors = await getSyntaxErrors('/dts-v1/;\n/ {\n\tmodel = "Board";\n};');
        assert.strictEqual(errors.length, 0);
    });

    test('nested nodes produce no errors', async () => {
        const input = `/ {
\tmemory@40000000 {
\t\tdevice_type = "memory";
\t\treg = <0x40000000 0x80000000>;
\t};
};`;
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 0);
    });

    test('cell array with phandle produces no errors', async () => {
        const errors = await getSyntaxErrors('/ {\n\tpinctrl-0 = <&pinctrl_uart2>;\n};');
        assert.strictEqual(errors.length, 0);
    });

    test('multi-value comma-separated cell arrays produce no errors', async () => {
        const input = '/ {\n\treg = <0x0 0x40000000>,\n\t      <0x1 0x00000000>;\n};';
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 0);
    });

    test('byte array property produces no errors', async () => {
        const errors = await getSyntaxErrors('/ {\n\tmac = [00 11 22 33 44 55];\n};');
        assert.strictEqual(errors.length, 0);
    });

    test('phandle path reference &{/path} produces no errors', async () => {
        const input = '/ {\n};\n&{/cpus} {\n\tprop = "val";\n};';
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 0);
    });

    test('macro arguments in cell array produce no errors', async () => {
        const input = '/ {\n\tsource-pdos = <PDO_FIXED(5000, 3000, PDO_FIXED_USB_COMM)>;\n};';
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 0);
    });

    test('block comment inside node produces no errors', async () => {
        const input = '/ {\n\t/* a comment */\n\tmodel = "Test";\n};';
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 0);
    });

    test('line comment produces no errors', async () => {
        const input = '/ {\n\t// a comment\n\tmodel = "Test";\n};';
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 0);
    });
});

suite('DTS Syntax Validator - bracket errors', () => {

    test('unmatched { reports one error', async () => {
        const input = '/ {\n\ttest {\n\t\tprop = "value";\n};';
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 1);
        assert.ok(errors[0].message.includes('Unmatched'));
        assert.strictEqual(errors[0].severity, vscode.DiagnosticSeverity.Error);
    });

    test('extra } reports one error', async () => {
        const input = '/ {\n\tprop = "value";\n}};\n';
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 1);
        assert.ok(errors[0].message.toLowerCase().includes('unexpected'));
    });

    test('unclosed < reports at least one error about unmatched <', async () => {
        // The ';' also triggers "Unexpected semicolon in cell array", so at
        // least 2 errors; check that the Unmatched '<' is among them.
        const input = 'reg = <0x100 0x200;';
        const errors = await getSyntaxErrors(input);
        assert.ok(errors.length >= 1);
        assert.ok(errors.some(e => e.message.includes('Unmatched') && e.message.includes('<')));
    });

    test('semicolon inside cell array reports an error', async () => {
        const input = '/ {\n\tpinctrl = <0x100\n\t\t0x200;\n\t\t0x300\n\t>;\n};';
        const errors = await getSyntaxErrors(input);
        assert.ok(errors.some(e => e.message.toLowerCase().includes('semicolon') &&
            e.message.toLowerCase().includes('cell array')));
    });

    test('mismatched < closed by ) reports a Mismatched error', async () => {
        // The ) closes nothing valid; expect at least the Mismatched diagnostic.
        const input = '/ {\n\treg = <0x100 0x200);\n};';
        const errors = await getSyntaxErrors(input);
        assert.ok(errors.length >= 1);
        assert.ok(errors.some(e => e.message.includes('Mismatched') && e.message.includes('>')));
    });

    test('mismatched ( closed by > reports one error', async () => {
        const input = '/ {\n\tsource-pdos = <PDO_FIXED(5000, 3000>;\n};';
        const errors = await getSyntaxErrors(input);
        assert.ok(errors.length >= 1);
        assert.ok(errors.some(e => e.message.includes('Mismatched')));
    });

    test('unclosed [ reports at least one error about unmatched [', async () => {
        // No outer braces so the only error is the unmatched '['
        const input = 'mac = [00 11 22;';
        const errors = await getSyntaxErrors(input);
        assert.ok(errors.length >= 1);
        assert.ok(errors.some(e => e.message.includes('Unmatched') && e.message.includes('[')));
    });

    test('error range points to the offending token', async () => {
        // The unmatched '}' is on line 2 (0-based)
        const input = '/ {\n\tprop = "v";\n}};\n';
        const errors = await getSyntaxErrors(input);
        assert.ok(errors.length > 0);
        const extraBrace = errors.find(e => e.message.toLowerCase().includes('unexpected'));
        assert.ok(extraBrace);
        assert.strictEqual(extraBrace.range.start.line, 2);
    });
});

suite('DTS Syntax Validator - unterminated literals', () => {

    test('unterminated string literal reports one error', async () => {
        const input = '/ {\n\tmodel = "unclosed string;\n};';
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 1);
        assert.ok(errors[0].message.includes('Unterminated string'));
    });

    test('unterminated block comment reports one error', async () => {
        // Standalone comment with no brackets - exactly one error, no cascades.
        const input = '/* no close';
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 1);
        assert.ok(errors[0].message.includes('Unterminated block comment'));
    });

    test('unterminated block comment error range is at /*', async () => {
        const input = '/* no close';
        const errors = await getSyntaxErrors(input);
        assert.ok(errors.length > 0);
        const err = errors.find(e => e.message.includes('Unterminated block comment'));
        assert.ok(err);
        // Should underline exactly 2 characters ('/*')
        assert.strictEqual(
            err.range.end.character - err.range.start.character, 2
        );
    });
});

suite('DTS Syntax Validator - missing semicolons', () => {

    test('missing ; after string property reports one error', async () => {
        const input = '/ {\n\tmodel = "test"\n\tcompatible = "test";\n};';
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 1);
        assert.ok(errors[0].message.includes("Missing ';'"));
    });

    test('missing ; after cell array reports one error', async () => {
        const input = '/ {\n\treg = <0x1000>\n\tcompatible = "test";\n};';
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 1);
        assert.ok(errors[0].message.includes("Missing ';'"));
    });

    test('missing ; before closing } reports one error', async () => {
        const input = '/ {\n\tmodel = "test"\n};';
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 1);
        assert.ok(errors[0].message.includes("Missing ';'"));
    });

    test('comma after cell array does not trigger missing ;', async () => {
        const input = '/ {\n\treg = <0x0 0x1>,\n\t      <0x2 0x3>;\n};';
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 0);
    });

    test('properly terminated string does not trigger missing ;', async () => {
        const input = '/ {\n\tmodel = "Board";\n\tcompatible = "vendor,board";\n};';
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 0);
    });

    test('missing ; after node body reports one error', async () => {
        // Sub-node closes without ';' then root closes with ';'
        const input = '/ {\n\ta-node {\n\t\tfoo = <3>;\n\t}\n};';
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 1);
        assert.ok(errors[0].message.includes("Missing ';' after node body"));
    });

    test('missing ; on nested node bodies reports errors for each', async () => {
        // Both inner and outer nodes are missing ';'
        const input = '/ {\n\ta-node {\n\t\tfoo = <3>;\n\t}\n}';
        const errors = await getSyntaxErrors(input);
        assert.ok(errors.length >= 2);
        assert.ok(errors.every(e => e.message.includes("Missing ';'")));
    });

    test('properly terminated node body does not trigger missing ;', async () => {
        const input = '/ {\n\ta-node {\n\t\tfoo = <3>;\n\t};\n};';
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 0);
    });
});

suite('DTS Syntax Validator - consecutive identifiers', () => {

    test('space in node label name reports one error', async () => {
        const input = '/ {\n\tsubno de_label: a-node {\n\t\tfoo = <3>;\n\t};\n};';
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 1);
        assert.ok(errors[0].message.includes('Unexpected identifier'));
    });

    test('space in property name reports one error', async () => {
        const input = '/ {\n\tconstraint-rat e = <44100>;\n};';
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 1);
        assert.ok(errors[0].message.includes('Unexpected identifier'));
    });

    test('valid label: node-name produces no errors', async () => {
        const input = '/ {\n\tmylabel: a-node {\n\t\tfoo = <3>;\n\t};\n};';
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 0);
    });

    test('values inside <> do not trigger consecutive-identifier check', async () => {
        // Multiple identifiers/macros inside a cell array are valid
        const input = '/ {\n\tsource-pdos = <PDO_FIXED(5000, 3000, PDO_FIXED_USB_COMM)>;\n};';
        const errors = await getSyntaxErrors(input);
        assert.strictEqual(errors.length, 0);
    });
});
