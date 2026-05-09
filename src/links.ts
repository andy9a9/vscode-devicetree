import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Represents a parsed #include directive
 */
export interface IncludeInfo {
    path: string;
    line: number;
    startChar: number;
    endChar: number;
}

/**
 * Parse all #include directives from a document
 * @param document The document to parse
 * @returns Array of parsed include directives
 */
export function parseIncludes(document: vscode.TextDocument): IncludeInfo[] {
    const includes: IncludeInfo[] = [];
    const includeRegex = /#include\s+[<"]([^>"]+)[>"]/;
    const text = document.getText()
        .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
        .replace(/\/\/.*/g, m => ' '.repeat(m.length));

    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const includeMatch = line.match(includeRegex);

        if (includeMatch) {
            const includePath = includeMatch[1];
            const startIndex = line.indexOf(includeMatch[1]);
            const endIndex = startIndex + includeMatch[1].length;

            includes.push({
                path: includePath,
                line: i,
                startChar: startIndex,
                endChar: endIndex
            });
        }
    }

    return includes;
}

/**
 * Provider for DeviceTree #include directive links
 * Shows underlined clickable links for include paths that exist
 */
export class DtsDocumentLinkProvider implements vscode.DocumentLinkProvider {
    private includeSearchPaths: string[];

    constructor(includeSearchPaths: string[]) {
        this.includeSearchPaths = includeSearchPaths;
    }

    /**
     * Update configuration settings
     * @param includeSearchPaths The new include search paths
     */
    updateSearchPaths(includeSearchPaths: string[]): void {
        this.includeSearchPaths = includeSearchPaths;
    }

    /**
     * Search in arch directories for Linux kernel and U-Boot patterns
     * Linux: arch/'*'/boot/dts/, U-Boot: arch/'*'/dts/
     * @param workspaceRoot The workspace root path
     * @param includePath The include path to search for
     * @returns The URI of the found file or null
     */
    private searchInArchDirectories(
        workspaceRoot: string,
        includePath: string
    ): vscode.Uri | null {
        const archDir = path.join(workspaceRoot, 'arch');

        if (!fs.existsSync(archDir)) {
            return null;
        }

        // Get all architecture directories
        const archTypes = fs.readdirSync(archDir, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        // Search patterns: Linux kernel and U-Boot
        const patterns = [
            ['boot', 'dts'],  // Linux kernel: arch/*/boot/dts/
            ['dts']           // U-Boot: arch/*/dts/
        ];

        for (const arch of archTypes) {
            for (const pattern of patterns) {
                const dtsPath = path.join(archDir, arch, ...pattern, includePath);
                if (fs.existsSync(dtsPath)) {
                    return vscode.Uri.file(dtsPath);
                }
            }
        }

        return null;
    }

    /**
     * Search in configured custom paths
     * @param workspaceRoot The workspace root path
     * @param includePath The include path to search for
     * @param searchPaths Custom search paths
     * @returns The URI of the found file or null
     */
    private searchInCustomPaths(
        workspaceRoot: string,
        includePath: string,
        searchPaths: string[]
    ): vscode.Uri | null {
        for (const searchPath of searchPaths) {
            const fullPath = path.join(workspaceRoot, searchPath, includePath);
            if (fs.existsSync(fullPath)) {
                return vscode.Uri.file(fullPath);
            }
        }
        return null;
    }

    /**
     * Find the included file in the workspace (public for diagnostics)
     * @param includePath The path from the include directive
     * @param currentFileDir The directory of the current file
     * @returns The URI of the found file or null
     */
    public async findIncludedFile(
        includePath: string,
        currentFileDir: string
    ): Promise<vscode.Uri | null> {
        // First, try relative to current file
        const relativeToCurrentFile = path.join(currentFileDir, includePath);
        if (fs.existsSync(relativeToCurrentFile)) {
            return vscode.Uri.file(relativeToCurrentFile);
        }

        // Get workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return null;
        }

        // Get configured search paths from class member
        const customSearchPaths = this.includeSearchPaths;

        for (const folder of workspaceFolders) {
            const workspaceRoot = folder.uri.fsPath;

            // Try relative to workspace root
            const workspaceRelative = path.join(workspaceRoot, includePath);
            if (fs.existsSync(workspaceRelative)) {
                return vscode.Uri.file(workspaceRelative);
            }

            // Search in arch/*/boot/dts/ directories (Linux kernel pattern)
            const archResult = this.searchInArchDirectories(workspaceRoot, includePath);
            if (archResult) {
                return archResult;
            }

            // Search in configured custom paths
            if (customSearchPaths.length > 0) {
                const customResult = this.searchInCustomPaths(
                    workspaceRoot,
                    includePath,
                    customSearchPaths
                );
                if (customResult) {
                    return customResult;
                }
            }

            // Fallback: search recursively in workspace
            const searchPattern = `**/${path.basename(includePath)}`;
            const files = await vscode.workspace.findFiles(
                searchPattern,
                '{**/.*,**/node_modules/**}',
                10 // Limit results
            );

            // Filter to exact path match
            for (const file of files) {
                if (file.fsPath.endsWith(includePath)) {
                    return file;
                }
            }
        }

        return null;
    }

    /**
     * Provide document links for all #include directives
     * @param document The document to provide links for
     * @returns Array of document links
     */
    async provideDocumentLinks(
        document: vscode.TextDocument
    ): Promise<vscode.DocumentLink[]> {
        const includes = parseIncludes(document);
        const links: vscode.DocumentLink[] = [];
        const currentFileDir = path.dirname(document.uri.fsPath);

        for (const include of includes) {
            // Try to find the included file
            const targetUri = await this.findIncludedFile(
                include.path,
                currentFileDir
            );

            // Only create a link if the file exists
            if (targetUri) {
                const range = new vscode.Range(
                    new vscode.Position(include.line, include.startChar),
                    new vscode.Position(include.line, include.endChar)
                );
                const link = new vscode.DocumentLink(range, targetUri);
                link.tooltip = targetUri.fsPath;
                links.push(link);
            }
        }

        return links;
    }
}
