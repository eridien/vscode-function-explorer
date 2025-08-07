import * as vscode   from 'vscode';
import {minimatch}   from 'minimatch';
import * as fs       from 'fs/promises';
import * as chokidar from 'chokidar';
import path          from 'path';
import {extensionsSupported} from './languages';
import {fils}        from './dbs';
import * as utils    from './utils';
const {log, start, end} = utils.getLog('sett');

interface FunctionExplorerSettings {
  hideRootFolders:      boolean;
  hideFolders:          boolean;
  openEditorsAsPinned:  boolean;
  showFilePaths:        boolean;
  showBreadcrumbs:     "Never Show Breadcrumbs"        | 
                       "Show Breadcrumbs With Dittos"  | 
                       "Always Show Complete Breadcrumbs",
  scrollPosition:      "Function Top At Top"           | 
                       "Function Center At Center"     |
                       "Function Bottom At Bottom"     | 
                       "Function Top At Top If Needed" |
                       "Function Center At Center If Needed";
  fileWrap:             boolean;
  alphaSortFunctions:   boolean;
  topMargin:            number;
  openFileWhenExpanded: boolean;
}

export let settings:  FunctionExplorerSettings = {
  hideRootFolders:      false,
  hideFolders:          true,
  openEditorsAsPinned:  true,
  showFilePaths:        true,
  showBreadcrumbs:      "Show Breadcrumbs With Dittos",
  scrollPosition:       "Function Center At Center If Needed",
  fileWrap:             true,
  alphaSortFunctions:   false,
  topMargin:            3,
  openFileWhenExpanded: false
};

let excludeCfg: string;

async function measureViewportCapacity(editor: vscode.TextEditor): Promise<number> {
  let visibleRanges = editor.visibleRanges;
  if(!visibleRanges || visibleRanges.length == 0) 
      visibleRanges = [new vscode.Range(0, 0, 1, 0)];
  let screenTop     = 0;
  let screenBottom  = 0;
  let idx           = visibleRanges[0].start.line;
  let lastBottom    = visibleRanges[visibleRanges.length - 1].end.line;
  let i = 0;
  while(true) {
    if(++i == 100) break;
    if(--idx < 1) break;
    editor.revealRange(new vscode.Range(idx-1, 0, idx-1, 0), 
                           vscode.TextEditorRevealType.AtTop);
    await new Promise(resolve => setTimeout(resolve, 0));
    visibleRanges = editor.visibleRanges;
    if(!visibleRanges || visibleRanges.length == 0) 
        visibleRanges = [new vscode.Range(0, 0, 1, 0)];
    screenTop     = visibleRanges[0].start.line;
    screenBottom  = visibleRanges[visibleRanges.length - 1].end.line;
    if(screenTop  == 0 || screenBottom != lastBottom) break;
    lastBottom    = screenBottom;
  }
  editor.revealRange(new vscode.Range(idx+2, 0, idx+2, 0), 
                          vscode.TextEditorRevealType.AtTop);
  visibleRanges = editor.visibleRanges;
  if(!visibleRanges || visibleRanges.length == 0) 
      visibleRanges = [new vscode.Range(0, 0, 1, 0)];
  screenTop     = visibleRanges[0].start.line;
  screenBottom  = visibleRanges[visibleRanges.length - 1].end.line;
  const totalHeight   = screenBottom - screenTop;
  let totalGaps       = 0;
  let current         = screenTop;
  for (const range of visibleRanges) {
    if (current < range.start.line) {
      const gap = range.start.line - current - 1;
      totalGaps += gap;
    }
    current = range.end.line;
  }
  const capacity = totalHeight - totalGaps;
  return capacity;
}

export async function setScroll(editor: vscode.TextEditor, 
                          funcTop: number, funcBottom: number) {
  const functionTopMargin   = funcTop - settings.topMargin;
  const funcHeight          = funcBottom - funcTop;
  let visibleRanges = editor.visibleRanges;
  if(!visibleRanges || visibleRanges.length == 0) 
      visibleRanges = [new vscode.Range(0, 0, 1, 0)];
  const visibleRange  = visibleRanges[0];
  const screenTop     = visibleRange.start.line;
  const screenHeight  = await measureViewportCapacity(editor);
  const screenBottom  = screenTop + screenHeight;
  let top = 0;
  if(funcHeight >= screenHeight)
    top = functionTopMargin; 
  else { 
    switch(settings.scrollPosition) {
      case "Function Top At Top": 
              top = functionTopMargin; 
              break;
      case "Function Center At Center": 
              top = funcTop - (Math.floor( screenHeight / 2) - 
                               Math.floor( funcHeight   / 2)); 
              break;
      case "Function Bottom At Bottom":
              top = funcBottom - screenHeight; 
              break;
      case "Function Top At Top If Needed":
              if(functionTopMargin < screenTop || funcBottom > screenBottom)
                top = functionTopMargin; 
              else top = screenTop;
              break;
      case "Function Center At Center If Needed":
              if(functionTopMargin < screenTop || funcBottom > screenBottom)
                top = funcTop - (Math.floor( screenHeight / 2) - 
                                 Math.floor( funcHeight   / 2));
              else top = screenTop;
              break;
      default: top = functionTopMargin; 
    }
  }
  top = Math.max(0, Math.min(functionTopMargin, top));
  editor.revealRange(new vscode.Range(top, 0, top, 0), 
                         vscode.TextEditorRevealType.AtTop);
}

export function includeFile(fsPath: string, folder = false, 
                            editor: vscode.TextEditor | null = null): boolean {
  if(fsPath === '' && !editor) return false;
  if (editor) {
    if (editor.document.uri.scheme !== 'file') return false;
    fsPath = editor.document.uri.fsPath;
    folder = false;
  }
  if(folder) {
    for(const wsFolder of (vscode.workspace.workspaceFolders || [])) {
      if(fsPath === wsFolder.uri.fsPath) return true;
    }
  }
  else if (!extensionsSupported.has(path.extname(fsPath))) {
    return false;
  }
  let relPath = vscode.workspace.asRelativePath(fsPath, true);
  relPath = relPath.replace(/\\/g, '/').split('/').slice(1).join('/');
  const matchPath = folder ? relPath + '/' : relPath;
  return !minimatch(matchPath, excludeCfg, { dot: true });
}

let fileCreated: (fsPath: string) => void;
let fileDeleted: (uri: vscode.Uri) => void;

export function setWatcherCallbacks(
       fileCreatedIn: (fsPath: string) => void,
       fileDeletedIn: (uri: vscode.Uri) => void) {
  fileCreated = fileCreatedIn;
  fileDeleted = fileDeletedIn;
}

const MAX_FILE_COUNT               = 200;
let watchedFileCount               = 0;
let allWatchersAborted             = false;
let watchReadyCountdown            = 0;
let watchers: chokidar.FSWatcher[] = [];

async function closeAllWatchers() {
  for (const watcher of watchers) await watcher.close();
  watchers = [];
}

async function setFileWatcher(filesToExclude: string) {
  if(allWatchersAborted) return;
  await closeAllWatchers();
  // log('setFileWatcher, excludePatterns:', filesToExclude);
  watchedFileCount    = 0;
  const wsFolders     = vscode.workspace.workspaceFolders || [];
  watchReadyCountdown = wsFolders.length;
  for (const wsFolder of wsFolders) {
    start('setFileWatcher' + watchReadyCountdown, false);
    let wsPath = wsFolder.uri.fsPath;
    await fils.loadPaths(wsPath, true);
    const watchPaths = fils.includedPathsAndParents(wsPath);
    const watcherInstance = chokidar.watch(watchPaths, {
      cwd: wsPath,
      // ignored: (filePath) => {
      //   const relPath = filePath.replace(/\\/g, '/');
      //   return minimatch(relPath, filesToExclude, { dot: true });
      // },
      usePolling:      false,
      ignoreInitial:   false,
      awaitWriteFinish: true,
    });
    watcherInstance.on('add', async (filePath) => {
      // log('addFile:', filePath, watchedFileCount);
      if(allWatchersAborted) return;
      if(watchReadyCountdown <= 0) {
        const fsPath = path.join(wsPath, filePath);
        fileCreated?.(fsPath);
        watchedFileCount++;
        return;
      }
      if (!includeFile(filePath, false)) {
        watcherInstance.unwatch(filePath);
        // log('ignoring file:', filePath);
        return;
      }
      if (++watchedFileCount > MAX_FILE_COUNT) {
        allWatchersAborted = true;
        await closeAllWatchers();
        log('infoerr', `Function Explorer: ` + 
                       `Maximum file watch count (${MAX_FILE_COUNT}) exceeded. ` +
                       `Aborting watcher. File changes will not be tracked. ` +
                       `The maximum count can be changed in settings.`);
        end('setFileWatcher' + watchReadyCountdown);
        return;
      }
    });
    watcherInstance.on('addDir', (dirPath) => {
      // log('addDir:', dirPath, watchedFileCount);
      if(allWatchersAborted) return;
      if (!includeFile(dirPath, true)) {
        watcherInstance.unwatch(dirPath);
        // log('ignoring dir:', dirPath);
        return;
      }
      const fsPath = path.join(wsPath, dirPath);
      fileCreated?.(fsPath);
      ++watchedFileCount;
    });
    watcherInstance.on('unlink', (filePath) => {
      log('unlinkFile:', filePath);
      if(allWatchersAborted) return;
      const fullPath = path.join(wsPath, filePath);
      const uri = vscode.Uri.file(fullPath);
      fileDeleted?.(uri);
    });
    watcherInstance.on('unlinkDir', (dirPath) => {
      log('unlinkDir:', dirPath);
      if(allWatchersAborted) return;
      const fullPath = path.join(wsPath, dirPath);
      const uri = vscode.Uri.file(fullPath);
      fileDeleted?.(uri);
    });
    watcherInstance.on('ready', () => {
      log('ready,', watchedFileCount, 'files watched');
      end('setFileWatcher' + watchReadyCountdown, false);
      watchReadyCountdown--;
      // setTimeout(() => {
      //   log('delayed ready', JSON.stringify(watcherInstance.getWatched(), null, 2));
      // }, 300);
    });
    watchers.push(watcherInstance);
  }
}

export async function loadSettings() {
  const config = vscode.workspace.getConfiguration('function-explorer');
  settings = {
    showBreadcrumbs:      config.get('showBreadcrumbs', 
                             "Show Breadcrumbs With Dittos"),
    scrollPosition:       config.get('scrollPosition', 
                             "Function Center At Center If Needed"),
    hideRootFolders:      config.get('hideRootFolders',      false),
    hideFolders:          config.get('hideFolders',           true),
    openEditorsAsPinned:  config.get('openEditorsAsPinned',   true),
    showFilePaths:        config.get('showFilePaths',         true),
    openFileWhenExpanded: config.get('openFileWhenExpanded', false),
    fileWrap:             config.get('fileWrap',              true),
    alphaSortFunctions:   config.get('alphaSortFunctions',   false),
    topMargin:            config.get('topMargin',                3),
  };
  // log('loadSettings', settings);
  vscode.commands.executeCommand(
                    'setContext', 'foldersHidden', settings.hideFolders);
  vscode.commands.executeCommand(
                    'setContext', 'pinned', settings.openEditorsAsPinned);
  const excludeFoldersPattern = config.get('filesToExclude', 'node_modules/');
  const excParts = excludeFoldersPattern.split(",").map(pattern => {
    let part =pattern.trim();
    part = part.replace(/\\/g, '/');
    if(part.endsWith('/')) part += '**';
    return part;
  });
  if(excParts.length < 2) excludeCfg = excParts[0];
  else                    excludeCfg = '{'+excParts.join(",") +'}';
  await setFileWatcher(excludeFoldersPattern);
}

export async function setHideFolders(value: boolean) {
  settings.hideFolders = value;
  vscode.commands.executeCommand('setContext', 'foldersHidden', value);
  await vscode.workspace.getConfiguration('function-explorer')
    .update('hideFolders', value, vscode.ConfigurationTarget.Workspace);
}
export async function setShowPinned(value: boolean) {
  settings.openEditorsAsPinned = value;
  vscode.commands.executeCommand('setContext', 'pinned', value);
  await vscode.workspace.getConfiguration('function-explorer')
    .update('openEditorsAsPinned', value, vscode.ConfigurationTarget.Workspace);
}
