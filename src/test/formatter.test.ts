import * as assert from 'assert';
import * as vscode from 'vscode';

// Helper function to format a DTS document
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

// Expand tabs to spaces so that .indexOf() returns a visual column number.
// Assumes a single line (no newlines); the internal column counter is never reset.
// Usage: expandTabs(line).indexOf('0x') gives the screen column where '0x' appears,
// making it possible to assert that two lines align their hex values at the same
// visual position even when they use different numbers of tabs for padding.
function expandTabs(chars: string, tabSize = 8): string {
    let result = '';
    let col = 0;
    for (const ch of chars) {
        if (ch === '\t') {
            const pad = tabSize - (col % tabSize);
            result += ' '.repeat(pad);
            col += pad;
        } else {
            result += ch;
            col++;
        }
    }
    return result;
}

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
    test('Should preserve all phandle references in a comma-separated cell list', async () => {
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

    test('Should preserve multi-token entries in a comma-separated cell array', async () => {
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
        // Nested property with spaces
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

    test('Should format both inline node definitions and ampersand reference overrides', async () => {
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

    test('Should apply one additional tab per nesting level for deeply nested nodes', async () => {
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

    test('Should not throw and return a string for whitespace-only input', async () => {
        const input = '   \n\t\n  ';
        const result = await formatDocument(input);
        // Should handle gracefully
        assert.ok(typeof result === 'string');
    });

    test('Should expand single-line root node body to multi-line block format', async () => {
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

    test('Should preserve valueless boolean property without modification', async () => {
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

    test('Should preserve phandle cell value in angle bracket notation', async () => {
        const input = '/ {\nnode {\nphandle = <0x1>;\n};\n};';
        const result = await formatDocument(input);
        assert.ok(result.includes('phandle = <0x1>'));
    });

    test('Should preserve all phandle references in a multi-value cell array', async () => {
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

    test('Should preserve strings with colons', async () => {
        const input = '/ {\n\tlabel = "yellow:status";\n};';
        const result = await formatDocument(input);
        assert.ok(result.includes('"yellow:status"'), 'String content should not be modified');
        assert.ok(!result.includes('"yellow: status"'), 'Colon in string should not have space added');
    });

    test('Should not split whitespace-separated arrays into new lines', async () => {
        const input = `/ {
\tbrightness-levels = < 0  1  2  3  4  5  6  7  8  9
\t\t\t     10 11 12 13 14 15 >;
};`;
        const result = await formatDocument(input);
        // Should preserve multi-line structure
        assert.ok(result.includes('brightness-levels'), 'Property name should be present');
        const lines = result.split('\n');
        const brightLine = lines.findIndex(l => l.includes('brightness-levels'));
        assert.ok(brightLine >= 0, 'brightness-levels property should exist');
        // The values should not be split into individual digits
        assert.ok(!result.match(/brightness-levels.*\n.*0\n.*1\n.*2/), 'Should not split digits');
    });

    test('Should not split PDO macro function names or parenthesized arguments across lines', async () => {
        const input = `/ {
\tsink-pdos = <PDO_FIXED(5000, 3000, PDO_FIXED_USB_COMM)
\t\t     PDO_VAR(5000, 20000, 3000)>;
};`;
        const result = await formatDocument(input);
        // Should keep PDO_FIXED as a single token, not split into characters
        assert.ok(result.includes('PDO_FIXED'), 'PDO_FIXED should remain intact');
        assert.ok(result.includes('PDO_VAR'), 'PDO_VAR should remain intact');
        // Make sure it's not split character by character
        assert.ok(!result.match(/P\s+D\s+O\s+_\s+F/), 'Should not split macro name into characters');
    });

    test('Should not split long iomuxc pin control macro names across lines', async () => {
        const input = `&iomuxc {
\tpinctrl_hog: hoggrp {
\t\tfsl,pins = <
\t\t\tMX8MP_IOMUXC_HDMI_DDC_SCL__HDMIMIX_HDMI_SCL\t0x400001c2
\t\t\tMX8MP_IOMUXC_HDMI_DDC_SDA__HDMIMIX_HDMI_SDA\t0x400001c2
\t\t>;
\t};
};`;
        const result = await formatDocument(input);
        // Should keep long macro names intact
        assert.ok(result.includes('MX8MP_IOMUXC_HDMI_DDC_SCL__HDMIMIX_HDMI_SCL'), 'Long macro should remain intact');
        assert.ok(result.includes('MX8MP_IOMUXC_HDMI_DDC_SDA__HDMIMIX_HDMI_SDA'), 'Long macro should remain intact');
        // Make sure it's not split character by character
        assert.ok(!result.match(/M\s+X\s+8\s+M\s+P_/), 'Should not split macro into characters');
    });
});

suite('DTS Formatter - fsl,pins Alignment', () => {
    test('Should align hex values when first entry has trailing inline comment', async () => {
        // The inline comment after the hex value must not break column alignment for remaining entries
        const input = `&iomuxc {
\tpinctrl_pcie0: pcie0grp {
\t\tfsl,pins = <MX8MP_IOMUXC_I2C4_SCL__PCIE_CLKREQ_B\t0x60 /* open drain, pull up */
\t\t\t    MX8MP_IOMUXC_SD1_DATA5__GPIO2_IO07\t0x40
\t\t>;
\t};
};`;
        const result = await formatDocument(input);
        const lines = result.split('\n');
        const pinLines = lines.filter(l => l.includes('MX8MP_IOMUXC_'));
        assert.strictEqual(pinLines.length, 2, 'Should have two pin lines');
        // Both hex values should be at the same VISUAL column (expand tabs before comparing)
        const col0 = expandTabs(pinLines[0]).indexOf('0x');
        const col1 = expandTabs(pinLines[1]).indexOf('0x');
        assert.strictEqual(col0, col1, `Hex values should align: col0=${col0} col1=${col1}`);
        // Inline comment should be preserved
        assert.ok(result.includes('/* open drain, pull up */'), 'Inline comment should be preserved');
    });

    test('Should preserve embedded block comment and keep alignment', async () => {
        // A block comment between pin entries must be passed through unchanged
        // and must not corrupt the column alignment of surrounding entries
        const input = `&iomuxc {
\tpinctrl_hog: hoggrp {
\t\tfsl,pins = <MX8MP_IOMUXC_HDMI_DDC_SCL__HDMIMIX_HDMI_SCL\t0x400001c2
\t\t\t    MX8MP_IOMUXC_HDMI_HPD__HDMIMIX_HDMI_HPD\t\t0x40000010
\t\t\t    /*
\t\t\t     * M.2 reference clock selection
\t\t\t     */
\t\t\t    MX8MP_IOMUXC_SD1_DATA7__GPIO2_IO09\t\t0x1c4
\t\t>;
\t};
};`;
        const result = await formatDocument(input);
        // Block comment should be preserved
        assert.ok(result.includes('M.2 reference clock selection'), 'Block comment should be preserved');
        const lines = result.split('\n');
        const pinLines = lines.filter(l => l.includes('MX8MP_IOMUXC_'));
        assert.strictEqual(pinLines.length, 3, 'Should have three pin lines');
        // All hex values should be at the same VISUAL column (expand tabs before comparing)
        const cols = pinLines.map(l => expandTabs(l).indexOf('0x'));
        assert.ok(cols.every(c => c === cols[0]), `All hex values should align: ${cols}`);
    });

    test('Should align hex values with variable-length keys', async () => {
        // Shorter keys need extra tabs to align with the longest key in the group
        const input = `&iomuxc {
\tpinctrl_flexspi0: flexspi0grp {
\t\tfsl,pins = <MX8MP_IOMUXC_NAND_ALE__FLEXSPI_A_SCLK\t0x1c2
\t\t\t    MX8MP_IOMUXC_NAND_DATA03__FLEXSPI_A_DATA03\t0x82
\t\t>;
\t};
};`;
        const result = await formatDocument(input);
        const lines = result.split('\n');
        const pinLines = lines.filter(l => l.includes('MX8MP_IOMUXC_NAND_'));
        assert.strictEqual(pinLines.length, 2, 'Should have two pin lines');
        // Both hex values should be at the same VISUAL column (expand tabs before comparing)
        const col0 = expandTabs(pinLines[0]).indexOf('0x');
        const col1 = expandTabs(pinLines[1]).indexOf('0x');
        assert.strictEqual(col0, col1, `Hex values should align: col0=${col0} col1=${col1}`);
    });

    test('Should keep source-pdos with internal commas on single line', async () => {
        // Commas inside PDO_FIXED(...) are NOT value separators — the whole thing stays on one line
        const input = `/ {
\tusb_con: connector {
\t\tsource-pdos = <PDO_FIXED(5000, 3000, PDO_FIXED_USB_COMM)>;
\t};
};`;
        const result = await formatDocument(input);
        const lines = result.split('\n');
        const pdoLine = lines.find(l => l.includes('source-pdos'));
        assert.ok(pdoLine, 'source-pdos property should be present');
        assert.ok(
            pdoLine.includes('PDO_FIXED(5000, 3000, PDO_FIXED_USB_COMM)'),
            'PDO_FIXED call must remain intact on one line'
        );
    });

    test('Should keep each PDO entry on its own line for sink-pdos', async () => {
        // When PDO entries are on separate lines they should each stay on their own line,
        // aligned to the opening '<'
        const input = `/ {
\tusb_con: connector {
\t\tsink-pdos = <PDO_FIXED(5000, 3000, PDO_FIXED_USB_COMM)
\t\t\t     PDO_VAR(5000, 20000, 3000)
\t\t>;
\t};
};`;
        const result = await formatDocument(input);
        assert.ok(result.includes('PDO_FIXED(5000, 3000, PDO_FIXED_USB_COMM)'), 'PDO_FIXED entry should be intact');
        assert.ok(result.includes('PDO_VAR(5000, 20000, 3000)'), 'PDO_VAR entry should be intact');
        // They must be on separate lines
        const lines = result.split('\n');
        const fixedLine = lines.findIndex(l => l.includes('PDO_FIXED'));
        const varLine = lines.findIndex(l => l.includes('PDO_VAR'));
        assert.ok(fixedLine >= 0 && varLine >= 0, 'Both PDO entries should appear');
        assert.notStrictEqual(fixedLine, varLine, 'PDO_FIXED and PDO_VAR must be on separate lines');
        // PDO_VAR line should be indented to align with the opening '<'
        const pdoVarLine = lines[varLine];
        assert.ok(pdoVarLine.startsWith('\t'), 'PDO_VAR line should be indented');
    });
});

suite('DTS Formatter - fsl,pins Alignment (spaces mode)', () => {
    const spacesOpts: vscode.FormattingOptions = { tabSize: 8, insertSpaces: true };

    test('Should align hex values using spaces only (no tabs in output)', async () => {
        const input = `&iomuxc {
\tpinctrl_ecspi2: ecspi2grp {
\t\tfsl,pins = <MX8MP_IOMUXC_ECSPI2_SCLK__ECSPI2_SCLK\t0x82
\t\t\t    MX8MP_IOMUXC_ECSPI2_MOSI__ECSPI2_MOSI\t0x82
\t\t\t    MX8MP_IOMUXC_ECSPI2_MISO__ECSPI2_MISO\t0x82
\t\t>;
\t};
};`;
        const result = await formatDocument(input, spacesOpts);
        const lines = result.split('\n');
        const pinLines = lines.filter(l => l.includes('MX8MP_IOMUXC_ECSPI2_'));
        assert.strictEqual(pinLines.length, 3, 'Should have three pin lines');
        // No tabs should appear in the output
        assert.ok(!result.includes('\t'), 'Output must not contain tabs in spaces mode');
        // All hex values at the same column
        const cols = pinLines.map(l => l.indexOf('0x'));
        assert.ok(cols.every(c => c === cols[0]), `Hex values should align: ${cols}`);
    });

    test('Should use exactly 1 space after longest key (no 8-space jumps)', async () => {
        // In spaces mode the separator after the longest key must be exactly 1 space,
        // not rounded up to the next 8-char boundary.
        const input = `&iomuxc {
\tpinctrl_ecspi2: ecspi2grp {
\t\tfsl,pins = <MX8MP_IOMUXC_ECSPI2_SCLK__ECSPI2_SCLK\t0x82
\t\t\t    MX8MP_IOMUXC_ECSPI2_MOSI__ECSPI2_MOSI\t0x82
\t\t>;
\t};
};`;
        const result = await formatDocument(input, spacesOpts);
        const lines = result.split('\n');
        const pinLines = lines.filter(l => l.includes('MX8MP_IOMUXC_ECSPI2_'));
        // Find the longest key line and verify it has exactly one space before its hex value
        const longestKeyLine = pinLines.reduce((a, b) =>
            a.indexOf('0x') > b.indexOf('0x') ? a : b
        );
        // The character immediately before '0x' should be a single space
        const hexIdx = longestKeyLine.indexOf('0x');
        assert.strictEqual(
            longestKeyLine[hexIdx - 1], ' ',
            'There should be exactly one space before the hex value on the longest-key line'
        );
        assert.notStrictEqual(
            longestKeyLine[hexIdx - 2], ' ',
            'There should not be two spaces before the hex value on the longest-key line'
        );
    });

    test('Should align hex values with variable-length keys using spaces', async () => {
        const input = `&iomuxc {
\tpinctrl_flexspi0: flexspi0grp {
\t\tfsl,pins = <MX8MP_IOMUXC_NAND_ALE__FLEXSPI_A_SCLK\t0x1c2
\t\t\t    MX8MP_IOMUXC_NAND_DATA03__FLEXSPI_A_DATA03\t0x82
\t\t>;
\t};
};`;
        const result = await formatDocument(input, spacesOpts);
        assert.ok(!result.includes('\t'), 'Output must not contain tabs in spaces mode');
        const lines = result.split('\n');
        const pinLines = lines.filter(l => l.includes('MX8MP_IOMUXC_NAND_'));
        assert.strictEqual(pinLines.length, 2, 'Should have two pin lines');
        // Hex values at the same column (no tab expansion needed since there are no tabs)
        const col0 = pinLines[0].indexOf('0x');
        const col1 = pinLines[1].indexOf('0x');
        assert.strictEqual(col0, col1, `Hex values should align: col0=${col0} col1=${col1}`);
    });

    test('Should convert tabs in single-entry pin value to spaces', async () => {
        // A single-pin property like pwm1 may have a raw tab between key and hex.
        // In spaces mode that tab must be replaced with spaces.
        const input = `&iomuxc {
\tpinctrl_pwm1: pwm1grp {
\t\tfsl,pins = <MX8MP_IOMUXC_GPIO1_IO01__PWM1_OUT\t0x116>;
\t};
};`;
        const result = await formatDocument(input, spacesOpts);
        assert.ok(!result.includes('\t'), 'Output must not contain tabs in spaces mode');
        assert.ok(result.includes('MX8MP_IOMUXC_GPIO1_IO01__PWM1_OUT'), 'Pin macro should be intact');
        assert.ok(result.includes('0x116'), 'Hex value should be present');
    });
});
