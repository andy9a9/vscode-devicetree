import * as assert from 'assert';
import * as vscode from 'vscode';

suite('DeviceTree Extension Test Suite', () => {
    vscode.window.showInformationMessage('Running DeviceTree extension tests...');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('andy9a9.vscode-devicetree'));
    });

    test('Extension should activate', async () => {
        const extension = vscode.extensions.getExtension('andy9a9.vscode-devicetree');
        assert.ok(extension);
        await extension?.activate();
        assert.strictEqual(extension?.isActive, true);
    });

    suite('Language Support Tests', () => {
        test('DeviceTree language should be registered', () => {
            const languages = vscode.languages.getLanguages();
            return languages.then((langs) => {
                assert.ok(langs.includes('dts'));
            });
        });

        test('DeviceTree files should be recognized', async () => {
            // Create a test document with .dts extension
            const doc = await vscode.workspace.openTextDocument({
                language: 'dts',
                content: '/dts-v1/;\n\n/ {\n\tmodel = "Test Device";\n};'
            });

            assert.strictEqual(doc.languageId, 'dts');
        });
    });
});
