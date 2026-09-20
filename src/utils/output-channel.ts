'use strict';

import * as vscode from 'vscode';

/**
 * Shared "DeviceTree" output channel used by all extension features
 * (formatter, dtc validator, etc.) so log output lives in a single place
 * instead of spawning one channel per feature.
 */
let sharedChannel: vscode.OutputChannel | undefined;

/**
 * Get the shared DeviceTree output channel, creating it on first use.
 */
export function getOutputChannel(): vscode.OutputChannel {
    sharedChannel ??= vscode.window.createOutputChannel('DeviceTree');
    return sharedChannel;
}

/**
 * Dispose the shared output channel. Should only be called once, when the
 * extension is deactivated.
 */
export function disposeOutputChannel(): void {
    sharedChannel?.dispose();
    sharedChannel = undefined;
}
