import * as vscode        from 'vscode';
import * as side          from './sidebar';
import {filesGlobPattern} from './settings';

let watcher: vscode.FileSystemWatcher | undefined;

export function setFileWatcher() {
  if (watcher) watcher.dispose();
  watcher = vscode.workspace.createFileSystemWatcher(filesGlobPattern);
  watcher.onDidChange(uri => { side.fileChanged(uri); });
  watcher.onDidCreate(uri => { side.fileCreated(uri); });
  watcher.onDidDelete(uri => { side.fileDeleted(uri); });
}