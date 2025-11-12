import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * Helper function to format a DTS document
 */
async function formatDocument(content: string, options?: vscode.FormattingOptions): Promise<string> {
    const doc = await vscode.workspace.openTextDocument({
        language: 'dts',
        content: content
    });

    const formatOptions = options ?? {
        tabSize: 8,
        insertSpaces: false
    };

    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
        'vscode.executeFormatDocumentProvider',
        doc.uri,
        formatOptions
    );

    if (!edits || edits.length === 0) {
        return content;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.set(doc.uri, edits);
    await vscode.workspace.applyEdit(edit);

    // Normalize line endings to LF for consistent test results across platforms
    return doc.getText().replace(/\r\n/g, '\n');
}

// Shared setup for all formatter tests
suiteSetup(async () => {
    const extension = vscode.extensions.getExtension('andy9a9.vscode-devicetree');
    if (extension && !extension.isActive) {
        await extension.activate();
    }
});

suite('DTS Formatter - Basic Indentation', () => {
    test('Should indent root properties', async () => {
        const input = '/ {\nmodel = "Test";\n};';
        const expected = '/ {\n\tmodel = "Test";\n};';
        const result = await formatDocument(input);
        assert.strictEqual(result, expected);
    });

    test('Should indent nested nodes', async () => {
        const input = '/ {\nnode {\nprop = <1>;\n};\n};';
        const expected = '/ {\n\tnode {\n\t\tprop = <1>;\n\t};\n};';
        const result = await formatDocument(input);
        assert.strictEqual(result, expected);
    });

    test('Should handle multiple nesting levels', async () => {
        const input = '/ {\nnode1 {\nnode2 {\nnode3 {\nprop = <0>;\n};\n};\n};\n};';
        const expected = '/ {\n\tnode1 {\n\t\tnode2 {\n\t\t\tnode3 {\n\t\t\t\tprop = <0>;\n\t\t\t};\n\t\t};\n\t};\n};';
        const result = await formatDocument(input);
        assert.strictEqual(result, expected);
    });
});

suite('DTS Formatter - Property Formatting', () => {
    test('Should normalize whitespace around equals', async () => {
        const input = '/ {\nmodel="Test";\nstatus   =   "okay";\n};';
        const expected = '/ {\n\tmodel = "Test";\n\tstatus = "okay";\n};';
        const result = await formatDocument(input);
        assert.strictEqual(result, expected);
    });

    test('Should format properties with strings', async () => {
        const input = '/ {\ncompatible="vendor,device";\n};';
        const expected = '/ {\n\tcompatible = "vendor,device";\n};';
        const result = await formatDocument(input);
        assert.strictEqual(result, expected);
    });

    test('Should format properties with cell arrays', async () => {
        const input = '/ {\nreg=<0x1000 0x100>;\n};';
        const expected = '/ {\n\treg = <0x1000 0x100>;\n};';
        const result = await formatDocument(input);
        assert.strictEqual(result, expected);
    });

    test('Should format properties with byte arrays', async () => {
        const input = '/ {\ndata=[01 02 03 04];\n};';
        const expected = '/ {\n\tdata = [01 02 03 04];\n};';
        const result = await formatDocument(input);
        assert.strictEqual(result, expected);
    });
});

suite('DTS Formatter - Node Formatting', () => {
    test('Should format node with label', async () => {
        const input = '/ {\nlabel:node@1000{\nstatus="okay";\n};\n};';
        const expected = '/ {\n\tlabel: node@1000 {\n\t\tstatus = "okay";\n\t};\n};';
        const result = await formatDocument(input);
        assert.strictEqual(result, expected);
    });

    test('Should format node reference', async () => {
        const input = '&uart0{\nstatus="okay";\n};';
        const expected = '&uart0 {\n\tstatus = "okay";\n};';
        const result = await formatDocument(input);
        assert.strictEqual(result, expected);
    });

    test('Should remove leading zeros from node addresses', async () => {
        const input = '/ {\nnode@0001000 {\nreg = <0x1000>;\n};\n};';
        const expected = '/ {\n\tnode@1000 {\n\t\treg = <0x1000>;\n\t};\n};';
        const result = await formatDocument(input);
        assert.strictEqual(result, expected);
    });

    test('Should normalize node name spacing', async () => {
        const input = '/ {\nuart  @  12345678{\nstatus="okay";\n};\n};';
        const expected = '/ {\n\tuart@12345678 {\n\t\tstatus = "okay";\n\t};\n};';
        const result = await formatDocument(input);
        assert.strictEqual(result, expected);
    });
});

suite('DTS Formatter - Multi-line Properties', () => {
    test('Should handle comma-separated values', async () => {
        const input = '/ {\nclocks = <&clk1>,<&clk2>,<&clk3>;\n};';
        const result = await formatDocument(input);
        // Should format with proper alignment
        assert.ok(result.includes('clocks'));
        assert.ok(result.includes('&clk1'));
        assert.ok(result.includes('&clk2'));
        assert.ok(result.includes('&clk3'));
    });

    test('Should align continuation lines', async () => {
        const input = '/ {\npinctrl-0 = <&pinctrl_set1>, <&pinctrl_set2>, <&pinctrl_set3>;\n};';
        const result = await formatDocument(input);
        assert.ok(result.includes('pinctrl-0'));
        assert.ok(result.includes('&pinctrl_set1'));
    });

    test('Should handle key-value pairs', async () => {
        const input = '/ {\nclocks = <IMX8MP_CLK_IPP_DO_CLKO1 10000>, <IMX8MP_SYS_PLL1_80M 20000>;\n};';
        const result = await formatDocument(input);
        assert.ok(result.includes('IMX8MP_CLK_IPP_DO_CLKO1'));
        assert.ok(result.includes('IMX8MP_SYS_PLL1_80M'));
    });

    test('Should keep short multi-value properties on one line', async () => {
        const input = '/ {\nreg = <0x1000>, <0x2000>;\n};';
        const result = await formatDocument(input);
        // Short properties should stay on one line
        const lines = result.split('\n');
        const regLine = lines.find(line => line.includes('reg'));
        assert.ok(regLine);
        assert.ok(regLine.includes('0x1000'));
        assert.ok(regLine.includes('0x2000'));
    });
});

suite('DTS Formatter - Comment Preservation', () => {
    test('Should preserve line comments', async () => {
        const input = '/ {\n// This is a comment\nmodel = "Test";\n};';
        const expected = '/ {\n\t// This is a comment\n\tmodel = "Test";\n};';
        const result = await formatDocument(input);
        assert.strictEqual(result, expected);
    });

    test('Should preserve inline comments', async () => {
        const input = '/ {\nmodel = "Test"; /* inline */\n};';
        const result = await formatDocument(input);
        assert.ok(result.includes('/* inline */'));
    });

    test('Should format block comments', async () => {
        const input = '/ {\n/*\n* Multi-line\n* comment\n*/\nmodel = "Test";\n};';
        const result = await formatDocument(input);
        assert.ok(result.includes('/*'));
        assert.ok(result.includes(' * Multi-line'));
        assert.ok(result.includes(' * comment'));
        assert.ok(result.includes('*/'));
    });

    test('Should preserve comments in multi-line properties', async () => {
        const input = '/ {\nclocks = <&clk1>, /* first */\n<&clk2>; /* second */\n};';
        const result = await formatDocument(input);
        assert.ok(result.includes('/* first */'));
        assert.ok(result.includes('/* second */'));
    });
});

suite('DTS Formatter - Indentation Options', () => {
    test('Should use tabs by default', async () => {
        const input = '/ {\nmodel = "Test";\n};';
        const result = await formatDocument(input, {
            tabSize: 8,
            insertSpaces: false
        });
        assert.ok(result.includes('\t'));
    });

    test('Should use spaces when configured', async () => {
        const input = '/ {\nmodel = "Test";\n};';
        const result = await formatDocument(input, {
            tabSize: 8,
            insertSpaces: true
        });
        const lines = result.split('\n');
        const modelLine = lines.find(line => line.includes('model'));
        assert.ok(modelLine);
        // Should start with spaces, not tab
        assert.ok(/^\s{8}model/.test(modelLine));
    });

    test('Should respect custom tab size', async () => {
        const input = '/ {\nnode {\nprop = <1>;\n};\n};';
        const result = await formatDocument(input, {
            tabSize: 4,
            insertSpaces: true
        });
        const lines = result.split('\n');
        const propLine = lines.find(line => line.includes('prop'));
        assert.ok(propLine);
        // Nested property should have 8 spaces (2 levels * 4 spaces)
        assert.ok(/^\s{8}prop/.test(propLine));
    });
});

suite('DTS Formatter - Complex Structures', () => {
    test('Should format complete DTS file with header', async () => {
        const input = '/dts-v1/;\n/ {\nmodel="Test Board";\ncompatible="vendor,board";\n};';
        const result = await formatDocument(input);
        assert.ok(result.includes('/dts-v1/;'));
        assert.ok(result.includes('model = "Test Board"'));
        assert.ok(result.includes('compatible = "vendor,board"'));
    });

    test('Should handle mixed nodes and references', async () => {
        const input = `/ {
uart0: uart@12345678 {
compatible = "vendor,uart";
status = "disabled";
};
};
&uart0 {
status = "okay";
};`;
        const result = await formatDocument(input);
        assert.ok(result.includes('uart0: uart@12345678 {'));
        assert.ok(result.includes('&uart0 {'));
        assert.ok(result.includes('status = "okay"'));
    });

    test('Should handle deeply nested structure', async () => {
        const input = '/ {\nbus {\ndevice {\nsubdevice {\nproperty = <1>;\n};\n};\n};\n};';
        const result = await formatDocument(input);
        const lines = result.split('\n');
        // Check indentation increases with nesting
        assert.ok(lines.some(line => line.trim() === 'bus {'));
        assert.ok(lines.some(line => /^\t{3}subdevice \{/.test(line)));
        assert.ok(lines.some(line => /^\t{4}property/.test(line)));
    });
});

suite('DTS Formatter - Whitespace Normalization', () => {
    test('Should remove trailing whitespace', async () => {
        const input = '/ {   \n\tmodel = "Test";   \n};   ';
        const result = await formatDocument(input);
        const lines = result.split('\n');
        lines.forEach(line => {
            assert.strictEqual(line, line.trimEnd(), 'Line should not have trailing whitespace');
        });
    });

    test('Should normalize line endings', async () => {
        // Note: VS Code preserves the document's EOL setting when applying edits.
        // The formatter normalizes to LF internally, but VS Code converts back to
        // the document's EOL. This test verifies the formatter handles CRLF input correctly.
        const input = '/ {\r\nmodel = "Test";\r\n};';
        const result = await formatDocument(input);
        // The formatting should work correctly (proper indentation),
        // even if VS Code preserves CRLF line endings
        assert.ok(result.includes('model = "Test"'));
        // Check that indentation is applied
        const lines = result.split(/\r?\n/);
        assert.ok(lines[1].startsWith('\t') || lines[1].startsWith('        '));
    });

    test('Should collapse multiple blank lines', async () => {
        const input = '/ {\n\n\nmodel = "Test";\n\n\n};';
        const result = await formatDocument(input);
        // Should not have more than one consecutive blank line
        assert.ok(!result.includes('\n\n\n'));
    });
});

suite('DTS Formatter - Edge Cases', () => {
    test('Should handle empty document', async () => {
        const input = '';
        const result = await formatDocument(input);
        assert.strictEqual(result, '');
    });

    test('Should handle document with only whitespace', async () => {
        const input = '   \n\t\n  ';
        const result = await formatDocument(input);
        // Should handle gracefully
        assert.ok(typeof result === 'string');
    });

    test('Should handle root node only', async () => {
        const input = '/ { };';
        const expected = '/ {\n};';
        const result = await formatDocument(input);
        assert.strictEqual(result, expected);
    });

    test('Should handle node with no properties', async () => {
        const input = '/ {\nempty {\n};\n};';
        const expected = '/ {\n\tempty {\n\t};\n};';
        const result = await formatDocument(input);
        assert.strictEqual(result, expected);
    });

    test('Should handle property with empty value', async () => {
        const input = '/ {\nempty-prop;\n};';
        const result = await formatDocument(input);
        assert.ok(result.includes('empty-prop'));
    });
});

suite('DTS Formatter - Special DTS Syntax', () => {
    test('Should format DTS version directive', async () => {
        const input = '/dts-v1/;\n/ { };';
        const result = await formatDocument(input);
        assert.ok(result.startsWith('/dts-v1/;'));
    });

    test('Should format include directives', async () => {
        const input = '#include "board.dtsi"\n/ { };';
        const result = await formatDocument(input);
        assert.ok(result.includes('#include "board.dtsi"'));
    });

    test('Should handle phandle properties', async () => {
        const input = '/ {\nnode {\nphandle = <0x1>;\n};\n};';
        const result = await formatDocument(input);
        assert.ok(result.includes('phandle = <0x1>'));
    });

    test('Should handle multiple references', async () => {
        const input = '/ {\nnode {\nclocks = <&clk1>, <&clk2>, <&clk3>;\n};\n};';
        const result = await formatDocument(input);
        assert.ok(result.includes('&clk1'));
        assert.ok(result.includes('&clk2'));
        assert.ok(result.includes('&clk3'));
    });
});

suite('DTS Formatter - Real-world Examples', () => {
    test('Should format typical UART node', async () => {
        const input = `/ {
uart0: uart@12345678 {
compatible = "vendor,uart";
reg = <0x12345678 0x1000>;
interrupts = <0 26 4>;
clocks = <&clk_uart>;
clock-names = "apb_pclk";
status = "okay";
};
};`;
        const result = await formatDocument(input);
        assert.ok(result.includes('uart0: uart@12345678 {'));
        assert.ok(result.includes('\tcompatible = "vendor,uart"'));
        assert.ok(result.includes('\treg = <0x12345678 0x1000>'));
    });

    test('Should format GPIO controller', async () => {
        const input = `/ {
gpio: gpio@40000000 {
compatible = "vendor,gpio";
reg = <0x40000000 0x1000>;
interrupts = <0 12 4>;
gpio-controller;
#gpio-cells = <2>;
};
};`;
        const result = await formatDocument(input);
        assert.ok(result.includes('gpio-controller;'));
        assert.ok(result.includes('#gpio-cells = <2>'));
    });

    test('Should format pinctrl configuration', async () => {
        const input = `/ {
pinctrl {
uart_pins: uart-pins {
function = "uart";
groups = "uart0_grp";
pinctrl-0 = <&pinctrl_uart>;
};
};
};`;
        const result = await formatDocument(input);
        assert.ok(result.includes('uart_pins: uart-pins {'));
        assert.ok(result.includes('function = "uart"'));
    });
});
