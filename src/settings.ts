import * as vscode from 'vscode';
import {minimatch} from 'minimatch';
import * as chokidar from 'chokidar';
import path from 'path';
import * as utils  from './utils';
const {log} = utils.getLog('sett');

interface FunctionMarksSettings {
  hideRootFolders:     boolean;
  flattenFolders:     boolean;
  scrollPosition:    "Function Top At Top"           | 
                     "Function Center At Center"     |
                     "Function Bottom At Bottom"     | 
                     "Function Top At Top If Needed" |
                     "Function Center At Center If Needed";
  fileWrap:           boolean;
  alphaSortFunctions: boolean;
  topMargin:          number;
  openFileWhenExpanded: boolean;
}

export let settings:  FunctionMarksSettings = {
  hideRootFolders:      true,
  flattenFolders:       true,
  scrollPosition:       "Function Center At Center If Needed",
  fileWrap:             false,
  alphaSortFunctions:   false,
  topMargin:            3,
  openFileWhenExpanded: false
};

let excludeCfg: string;
let includeCfg: string;

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
              top = funcTop -
                      (Math.floor( screenHeight / 2) - 
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
                top = funcTop -
                        (Math.floor( screenHeight / 2) - 
                        Math.floor( funcHeight   / 2));
              else top = screenTop;
              break;
      default: top = functionTopMargin; 
    }
  }
  if(top < 0) top = 0;
  editor.revealRange(new vscode.Range(top, 0, top, 0), 
                         vscode.TextEditorRevealType.AtTop);
}

export function includeFile(fsPath: string, folder?:boolean): boolean {
  for(const wsFolder of (vscode.workspace.workspaceFolders || [])) {
    if(fsPath === wsFolder.uri.fsPath) return true;
  }
  let filePath = vscode.workspace.asRelativePath(fsPath, true);
  filePath = filePath.replace(/\\/g, '/').split('/').slice(1).join('/');
  const relPath = folder ? filePath + '/' : filePath;
  if(minimatch(relPath, excludeCfg, { dot: true })) return false;
  return folder || minimatch(relPath, includeCfg, { dot: true });
}

let fileCreated: (fsPath: string) => void;
let fileDeleted: (uri: vscode.Uri) => void;

export function setWatcherCallbacks(
       fileCreatedIn: (fsPath: string) => void,
       fileDeletedIn: (uri: vscode.Uri) => void) {
  fileCreated = fileCreatedIn;
  fileDeleted = fileDeletedIn;
}

let watcher: chokidar.FSWatcher | undefined;

async function setFileWatcher(filesToExclude: string) {
  if (watcher) await watcher.close().then(
                     () => log('Previous watcher closed.'));
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const excludePatterns = filesToExclude.split(',').map(p => p.trim());

  watcher = chokidar.watch('.', {
    cwd,
    ignored: (filePath) => {
      const relPath = filePath.replace(/\\/g, '/');
      return excludePatterns.some(
                 pattern => minimatch(relPath, pattern, { dot: true }));
    },
    usePolling: true,
    interval: 100,
    ignoreInitial: true,
    persistent: true,
  });

  watcher.on('add', (filePath) => {
    log('addFile:', filePath);
    const fsPath = path.join(cwd, filePath);
    fileCreated?.(fsPath);
  });
  watcher.on('addDir', (dirPath) => {
    log('addDir:', dirPath);
    const fsPath = path.join(cwd, dirPath);
    fileCreated?.(fsPath);
  });
  watcher.on('unlink', (filePath) => {
    log('unlinkFile:', filePath);
    const fullPath = path.join(cwd, filePath);
    const uri = vscode.Uri.file(fullPath);
    fileDeleted?.(uri);
  });
  watcher.on('unlinkDir', (dirPath) => {
    log('unlinkDir:', dirPath);
    const fullPath = path.join(cwd, dirPath);
    const uri = vscode.Uri.file(fullPath);
    fileDeleted?.(uri);
  });
  watcher.on('ready', () => {
    log('Watcher is ready.');
  });
}

export async function loadSettings() {
  const config = vscode.workspace.getConfiguration('function-explorer');
  settings = {
    scrollPosition:       config.get('scrollPosition', 
                            "Function Center At Center If Needed"),
    hideRootFolders:      config.get('hideRootFolders',      true),
    flattenFolders:       config.get('flattenFolders',       true),
    openFileWhenExpanded: config.get('openFileWhenExpanded', false),
    fileWrap:             config.get('fileWrap',             false),
    alphaSortFunctions:   config.get('alphaSortFunctions',   false),
    topMargin:            config.get('topMargin',                3),
  };
  const includeFilesPattern = 
            config.get<string>("filesToInclude", "**/*.js, **/*.ts")
                  .split(",").map(p => p.trim());
  const excludeFoldersPattern = config.get('filesToExclude', 'node_modules/');
  if(includeFilesPattern.length < 2) includeCfg = includeFilesPattern[0];
  else                    includeCfg = '{'+includeFilesPattern.join(",")+'}';
  const excParts = excludeFoldersPattern
                         .split(",").map(p => p.trim());
  if(excParts.length < 2) excludeCfg = excParts[0];
  else                    excludeCfg = '{'+excParts.join(",")+'}';
  await setFileWatcher(excludeFoldersPattern);
}
