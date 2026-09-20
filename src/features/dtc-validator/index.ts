'use strict';

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getOutputChannel } from '../../utils/output-channel';

/**
 * Matches dtc "checks framework" diagnostics, where the severity follows the
 * location. The location may span multiple lines
 * (`<line>.<col>-<line2>.<col2>`), a single line (`<line>.<col>-<col2>`), or
 * just a line number:
 *   <file>:<line>.<col>-<line2>.<col2>: Warning (unit_address_vs_reg): ...
 *   <file>:<line>.<col>-<col2>: Warning (...): ...
 *   <file>:<line>: Warning (...): ...
 */
const DTC_DIAG_RE_LOCATION_FIRST =
    /^(.+?):(\d+)(?:\.(\d+))?(?:-[\d.]+)?:\s*(error|warning|note)\b\s*:?\s*(.*)$/i;

/**
 * Matches dtc parser (syntax) errors, where the severity comes first:
 *   Error: <file>:<line>.<col>-<col2> syntax error
 *   Error: <file>:<line>.<col>-<line2>.<col2> syntax error
 *   Warning: <file>:<line> ...
 */
const DTC_DIAG_RE_SEVERITY_FIRST =
    /^(error|warning|note)\s*:\s*(.+?):(\d+)(?:\.(\d+))?(?:-[\d.]+)?\s+(.*)$/i;

/**
 * Matches C preprocessor diagnostics:
 *   <file>:<line>:<col>: fatal error: <message>
 *   <file>:<line>:<col>: error: <message>
 */
const CPP_DIAG_RE =
    /^(.+?):(\d+):(\d+):\s*(fatal error|error|warning|note):\s*(.*)$/i;

interface ParsedDiag {
    file: string;
    line: number; // 1-based
    col: number; // 1-based, 0 if unknown
    severity: vscode.DiagnosticSeverity;
    message: string;
}

interface SpawnResult {
    stdout: string;
    stderr: string;
    code: number | null;
}

interface ValidationContext {
    cppPath: string;
    resolvedDtc: string;
    includeDirs: string[];
    tmpFile: string;
    preprocessedFile: string;
}

/**
 * Runs the DeviceTree Compiler (dtc) against the current document and
 * surfaces any errors/warnings as VS Code diagnostics.
 *
 * Since kernel-style `.dts`/`.dtsi` files rely on C preprocessor directives
 * (`#include`, `#define`-based macros from dt-bindings headers), the
 * document is first run through a C preprocessor (`cpp`) before being
 * handed to dtc, mirroring the Linux kernel's own dtc build rule. cpp emits
 * `# <line> "<file>"` markers so dtc still attributes errors to the
 * original source locations.
 */
export class DtcValidator implements vscode.Disposable {
    private readonly diagnosticCollection: vscode.DiagnosticCollection;
    private readonly outputChannel: vscode.OutputChannel;
    private readonly runningDocuments = new Set<string>();

    constructor() {
        this.diagnosticCollection =
            vscode.languages.createDiagnosticCollection('devicetree-dtc');
        this.outputChannel = getOutputChannel();
    }

    /**
     * Validate a document by preprocessing it and invoking dtc.
     *
     * @param document The document to validate.
     * @param interactive When true, show notifications for errors/results.
     */
    async validateDocument(document: vscode.TextDocument, interactive = false): Promise<void> {
        if (document.languageId !== 'dts') {
            return;
        }

        const key = document.uri.toString();
        if (!this.beginValidation(key, document, interactive)) {
            return;
        }
        try {
            const context = this.createValidationContext();
            if (!context) {
                this.handleMissingDtc(document, interactive);
                return;
            }
            await this.runValidation(document, context, interactive);
        } finally {
            this.runningDocuments.delete(key);
        }
    }

    /**
     * Clear diagnostics for a document (e.g. on close).
     */
    clearDocument(document: vscode.TextDocument): void {
        this.diagnosticCollection.delete(document.uri);
    }

    dispose(): void {
        this.diagnosticCollection.dispose();
        // The shared output channel is owned and disposed centrally.
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Substitute VS Code variable references that the settings API does not
     * expand automatically (unlike launch.json / tasks.json).
     *
     * Supported variables:
     *   ${workspaceFolder}        – fsPath of the first workspace folder
     *   ${workspaceFolder:Name}   – fsPath of the named workspace folder
     */
    private resolveVscodeVars(value: string): string {
        const folders = vscode.workspace.workspaceFolders ?? [];
        return value.replace(/\$\{workspaceFolder(?::([^}]+))?\}/g, (_match, name?: string) => {
            if (name) {
                const found = folders.find(f => f.name === name);
                return found?.uri.fsPath ?? _match;
            }
            return folders[0]?.uri.fsPath ?? _match;
        });
    }

    /**
     * Resolve an executable path.  Returns `null` if a configured absolute
     * path does not exist. Bare names (e.g. `dtc`, `cpp`) are returned as-is
     * so the shell/spawn can resolve them via `$PATH`.
     */
    private resolveExecutablePath(configured: string): string | null {
        if (path.isAbsolute(configured)) {
            return fs.existsSync(configured) ? configured : null;
        }

        // Relative path: try relative to each workspace root first
        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
        for (const folder of workspaceFolders) {
            const candidate = path.join(folder.uri.fsPath, configured);
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        // Fall back: let the shell find it on $PATH (existsSync won't work for
        // bare names like 'dtc', so we rely on spawnSync error detection later)
        return configured;
    }

    private beginValidation(key: string, document: vscode.TextDocument, interactive: boolean): boolean {
        if (this.runningDocuments.has(key)) {
            if (interactive) {
                void vscode.window.showInformationMessage(
                    'DeviceTree: a dtc validation is already running for this document.'
                );
            }
            return false;
        }

        this.runningDocuments.add(key);
        this.diagnosticCollection.delete(document.uri);
        this.outputChannel.clear();
        return true;
    }

    private createValidationContext(): ValidationContext | null {
        const config = vscode.workspace.getConfiguration('devicetree');
        const dtcPath = this.resolveVscodeVars(config.get<string>('DTCCompilerPath', 'dtc'));
        const cppPath = this.resolveVscodeVars(config.get<string>('CPreprocessorPath', 'cpp'));
        const resolvedDtc = this.resolveExecutablePath(dtcPath);
        if (!resolvedDtc) {
            return null;
        }

        const includeSearchPaths = config.get<string[]>(
            'includeSearchPaths',
            ['include', 'include/dt-bindings']
        );
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspaceRoot = workspaceFolders?.[0]?.uri.fsPath ?? '';
        const includeDirs = includeSearchPaths.map(entry =>
            path.isAbsolute(entry) ? entry : path.join(workspaceRoot, entry)
        );
        const tmpFile = path.join(os.tmpdir(), `vscode-dts-${Date.now()}.dts`);

        return {
            cppPath,
            resolvedDtc,
            includeDirs,
            tmpFile,
            preprocessedFile: `${tmpFile}.pre`,
        };
    }

    private handleMissingDtc(document: vscode.TextDocument, interactive: boolean): void {
        const config = vscode.workspace.getConfiguration('devicetree');
        const dtcPath = this.resolveVscodeVars(config.get<string>('DTCCompilerPath', 'dtc'));
        this.diagnosticCollection.delete(document.uri);
        if (interactive) {
            void vscode.window.showErrorMessage(
                `DeviceTree: dtc not found at "${dtcPath}". ` +
                'Set devicetree.DTCCompilerPath to the correct path.'
            );
        }
    }

    private async runValidation(
        document: vscode.TextDocument,
        context: ValidationContext,
        interactive: boolean,
    ): Promise<void> {
        try {
            fs.writeFileSync(context.tmpFile, document.getText(), 'utf8');

            const cppOutput = await this.runCpp(document, context, interactive);
            if (!cppOutput) {
                return;
            }

            fs.writeFileSync(context.preprocessedFile, cppOutput, 'utf8');
            await this.runDtc(document, context, interactive);
        } finally {
            try { fs.unlinkSync(context.tmpFile); } catch { /* ignore */ }
            try { fs.unlinkSync(context.preprocessedFile); } catch { /* ignore */ }
        }
    }

    private async runCpp(
        document: vscode.TextDocument,
        context: ValidationContext,
        interactive: boolean,
    ): Promise<string | null> {
        const cppArgs = this.getCppArgs(document, context);
        this.outputChannel.appendLine(`[cpp] ${context.cppPath} ${cppArgs.join(' ')}`);
        if (interactive) {
            this.outputChannel.show(true);
        }

        const cppResult = await this.spawnCapture(context.cppPath, cppArgs);
        if (cppResult instanceof Error) {
            this.outputChannel.appendLine(`[cpp] spawn error: ${cppResult.message}`);
            this.diagnosticCollection.delete(document.uri);
            if (interactive) {
                void vscode.window.showErrorMessage(
                    this.spawnErrorMessage('cpp', context.cppPath, cppResult)
                );
            }
            return null;
        }

        if (cppResult.stderr) {
            this.outputChannel.appendLine(`[cpp] exit ${cppResult.code ?? '?'}\n${cppResult.stderr}`);
        }

        if (cppResult.code !== 0) {
            const diagnostics = this.parseCppOutput(cppResult.stderr, context.tmpFile, document);
            this.diagnosticCollection.set(document.uri, diagnostics);
            if (interactive) {
                void vscode.window.showErrorMessage(
                    'DeviceTree: preprocessing failed. See the "DeviceTree" output channel for details.'
                );
            }
            return null;
        }

        return cppResult.stdout;
    }

    private async runDtc(
        document: vscode.TextDocument,
        context: ValidationContext,
        interactive: boolean,
    ): Promise<void> {
        const dtcArgs = this.getDtcArgs(context);
        this.outputChannel.appendLine(`[dtc] ${context.resolvedDtc} ${dtcArgs.join(' ')}`);

        const dtcResult = await this.spawnCapture(context.resolvedDtc, dtcArgs);
        if (dtcResult instanceof Error) {
            this.outputChannel.appendLine(`[dtc] spawn error: ${dtcResult.message}`);
            this.diagnosticCollection.delete(document.uri);
            if (interactive) {
                void vscode.window.showErrorMessage(
                    this.spawnErrorMessage('dtc', context.resolvedDtc, dtcResult)
                );
            }
            return;
        }

        const combinedOutput = dtcResult.stdout + dtcResult.stderr;
        this.logDtcResult(dtcResult.code, combinedOutput);

        const diagnostics = this.parseDtcDiagnostics(
            document,
            [context.tmpFile, context.preprocessedFile],
            dtcResult.code,
            combinedOutput,
        );
        this.diagnosticCollection.set(document.uri, diagnostics);
        if (interactive && diagnostics.length === 0) {
            void vscode.window.showInformationMessage('DeviceTree: dtc found no errors.');
        }
    }

    private getCppArgs(document: vscode.TextDocument, context: ValidationContext): string[] {
        const docDir = path.dirname(document.uri.fsPath);
        return [
            '-nostdinc',
            '-undef',
            '-D__DTS__',
            '-x', 'assembler-with-cpp',
            '-I', docDir,
            ...context.includeDirs.flatMap(dir => ['-I', dir]),
            context.tmpFile,
        ];
    }

    private getDtcArgs(context: ValidationContext): string[] {
        return [
            '-O', process.platform === 'win32' ? 'NUL' : '/dev/null',
            '-I', 'dts',
            ...context.includeDirs.flatMap(dir => ['-i', dir]),
            context.preprocessedFile,
        ];
    }

    private logDtcResult(code: number | null, output: string): void {
        if (output) {
            this.outputChannel.appendLine(`[dtc] exit ${code ?? '?'}\n${output}`);
            return;
        }
        this.outputChannel.appendLine(`[dtc] exit ${code ?? '?'} (no output)`);
    }

    private parseDtcDiagnostics(
        document: vscode.TextDocument,
        mainFiles: string[],
        code: number | null,
        output: string,
    ): vscode.Diagnostic[] {
        const diagnostics = this.parseDtcOutput(output, mainFiles, document);
        if (diagnostics.length === 0 && code !== 0) {
            const firstLine = output.split('\n').find(line => line.trim().length > 0);
            diagnostics.push(this.wholeDocumentDiagnostic(
                document,
                firstLine?.trim() ?? `dtc exited with code ${code ?? '?'}`,
                vscode.DiagnosticSeverity.Error,
            ));
        }
        return diagnostics;
    }

    /**
     * Spawn a process, capturing stdout and stderr separately.
     * Returns the spawn `Error` if the process could not start.
     */
    private spawnCapture(bin: string, args: string[]): Promise<SpawnResult | Error> {
        return new Promise(resolve => {
            let stdout = '';
            let stderr = '';
            let spawnError = false;
            const proc = cp.spawn(bin, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin),
            });

            proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
            proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

            proc.on('error', (err: Error) => {
                spawnError = true;
                resolve(err);
            });

            proc.on('close', (code) => {
                if (spawnError) { return; }
                resolve({ stdout, stderr, code });
            });
        });
    }

    private spawnErrorMessage(tool: 'dtc' | 'cpp', bin: string, err: NodeJS.ErrnoException): string {
        const settingHint = tool === 'dtc' ? 'devicetree.DTCCompilerPath' : 'devicetree.CPreprocessorPath';
        if (err.code === 'ENOENT') {
            return `DeviceTree: ${tool} not found at "${bin}". ` +
                `Make sure it is installed and check ${settingHint}.`;
        }
        if (err.code === 'EACCES') {
            return `DeviceTree: ${tool} at "${bin}" is not executable (EACCES). ` +
                'Run: chmod +x "' + bin + '"';
        }
        return `DeviceTree: failed to start ${tool} ("${bin}"): ${err.message}`;
    }

    /**
     * Build a diagnostic anchored to the start of the document, used when a
     * message can't be tied to a specific location in the open document.
     */
    private wholeDocumentDiagnostic(
        document: vscode.TextDocument,
        message: string,
        severity: vscode.DiagnosticSeverity,
    ): vscode.Diagnostic {
        const lineText = document.lineCount > 0 ? document.lineAt(0).text : '';
        const range = new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(0, lineText.length),
        );
        const diagnostic = new vscode.Diagnostic(range, message, severity);
        diagnostic.source = 'dtc';
        return diagnostic;
    }

    /**
     * Convert a parsed diagnostic into a VS Code diagnostic, mapping it onto
     * the document when it refers to the file we handed to dtc/cpp, or
     * anchoring it at the top of the document (with the real file/line
     * mentioned in the message) when it refers to an included file.
     */
    private toVscodeDiagnostic(
        parsed: ParsedDiag,
        mainFiles: string[],
        document: vscode.TextDocument,
    ): vscode.Diagnostic {
        const isMainFile = mainFiles.some(mainFile => path.resolve(parsed.file) === path.resolve(mainFile));

        if (!isMainFile) {
            return this.wholeDocumentDiagnostic(
                document,
                `${parsed.file}:${parsed.line}: ${parsed.message}`,
                parsed.severity,
            );
        }

        const lineNum = Math.max(0, parsed.line - 1);
        const colNum = Math.max(0, parsed.col > 0 ? parsed.col - 1 : 0);

        const safeLineNum = Math.min(lineNum, Math.max(0, document.lineCount - 1));
        const lineText = document.lineCount > 0 ? document.lineAt(safeLineNum).text : '';
        const safeCol = Math.min(colNum, lineText.length);

        const range = new vscode.Range(
            new vscode.Position(safeLineNum, safeCol),
            new vscode.Position(safeLineNum, lineText.length),
        );

        const diagnostic = new vscode.Diagnostic(range, parsed.message, parsed.severity);
        diagnostic.source = 'dtc';
        return diagnostic;
    }

    private severityFromString(s: string): vscode.DiagnosticSeverity {
        const lower = s.toLowerCase();
        if (lower.startsWith('warning')) {
            return vscode.DiagnosticSeverity.Warning;
        }
        if (lower === 'note') {
            return vscode.DiagnosticSeverity.Information;
        }
        return vscode.DiagnosticSeverity.Error;
    }

    /**
     * Parse dtc's combined stdout/stderr into diagnostics. dtc emits two
     * different formats depending on whether the message comes from the
     * parser (syntax errors) or the semantic checks framework.
     */
    private parseDtcOutput(
        output: string,
        mainFiles: string[],
        document: vscode.TextDocument,
    ): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
            let match = DTC_DIAG_RE_LOCATION_FIRST.exec(line);
            if (match) {
                const parsed: ParsedDiag = {
                    file: match[1],
                    line: parseInt(match[2], 10),
                    col: match[3] !== undefined ? parseInt(match[3], 10) : 0,
                    severity: this.severityFromString(match[4]),
                    message: match[5].trim() || line.trim(),
                };
                diagnostics.push(this.toVscodeDiagnostic(parsed, mainFiles, document));
                continue;
            }

            match = DTC_DIAG_RE_SEVERITY_FIRST.exec(line);
            if (match) {
                const parsed: ParsedDiag = {
                    file: match[2],
                    line: parseInt(match[3], 10),
                    col: match[4] !== undefined ? parseInt(match[4], 10) : 0,
                    severity: this.severityFromString(match[1]),
                    message: match[5].trim() || line.trim(),
                };
                diagnostics.push(this.toVscodeDiagnostic(parsed, mainFiles, document));
            }
        }

        return diagnostics;
    }

    /**
     * Parse cpp's stderr into diagnostics.
     */
    private parseCppOutput(
        stderr: string,
        mainFile: string,
        document: vscode.TextDocument,
    ): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const lines = stderr.split('\n');

        for (const line of lines) {
            const match = CPP_DIAG_RE.exec(line);
            if (!match) {
                continue;
            }
            const parsed: ParsedDiag = {
                file: match[1],
                line: parseInt(match[2], 10),
                col: parseInt(match[3], 10),
                severity: this.severityFromString(match[4]),
                message: match[5].trim(),
            };
            diagnostics.push(this.toVscodeDiagnostic(parsed, [mainFile], document));
        }

        if (diagnostics.length === 0 && stderr.trim()) {
            const firstLine = stderr.split('\n').find(l => l.trim().length > 0);
            diagnostics.push(this.wholeDocumentDiagnostic(
                document,
                firstLine?.trim() ?? 'preprocessing failed',
                vscode.DiagnosticSeverity.Error,
            ));
        }

        return diagnostics;
    }
}
