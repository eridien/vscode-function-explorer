import * as vscode from 'vscode';
import * as chokidar from 'chokidar';
import * as path from 'path';
import {minimatch} from 'minimatch';
import type { FSWatcher } from 'chokidar';
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

let includeFilesPattern:   string;
let excludeFoldersPattern: string;

export function includeFile( filePath: string, isFolder= false ): boolean {
  const normalizedPath = path.normalize(filePath).replace(/\\/g, '/');
  const includeGlobs = includeFilesPattern
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const excludeFolderPatterns = excludeFoldersPattern
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (isFolder) {
    const segments = normalizedPath.split('/');
    const isExcluded = excludeFolderPatterns.some(pattern => {
      const base = pattern.replace(/\/\*\*$/, ''); // strip trailing /**
      return segments.includes(base);
    });
    return !isExcluded;
  } else {
    const isIncluded = includeGlobs.some(pattern =>
      minimatch(normalizedPath, pattern, { matchBase: true, dot: true })
    );
    return isIncluded;
  }
}

let fileChanged: (uri: vscode.Uri) => void;
let fileCreated: (uri: vscode.Uri) => void;
let fileDeleted: (uri: vscode.Uri) => void;

export function setWatcherCallbacks(
       fileCreatedIn: (uri: vscode.Uri) => void,
       fileChangedIn: (uri: vscode.Uri) => void,
       fileDeletedIn: (uri: vscode.Uri) => void) {
  fileCreated = fileCreatedIn;
  fileChanged = fileChangedIn;
  fileDeleted = fileDeletedIn;
}

let chokidarWatcher: chokidar.FSWatcher | undefined;

function setFileWatcher(filesToInclude: string, filesToExclude: string) {
  const normalizePath = (p: string) => path.join(p).replace(/\\/g, '/');

  // Normalize input strings
  filesToInclude = normalizePath(filesToInclude);
  filesToExclude = normalizePath(filesToExclude);

  // Close previous watcher if it exists
  if (chokidarWatcher) void chokidarWatcher.close();

  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

  // Build include globs
  const includeGlobs = filesToInclude
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => p.startsWith('/') || p.match(/^\w:/) ? normalizePath(p) : normalizePath(path.join(cwd, p)));

  // Add a broad pattern to ensure folder events are captured
  includeGlobs.push(normalizePath(path.join(cwd, '**')));

  // Build exclude globs
  const excludeGlobs = filesToExclude
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => normalizePath(p)); // no path.join with cwd

  log('setFileWatcher', { includeGlobs, excludeGlobs, cwd });

  // Create the watcher
  chokidarWatcher = chokidar.watch(cwd, {
    ignored: excludeGlobs,
    ignoreInitial: true,
    persistent: true,
    depth: undefined,
    awaitWriteFinish: true,
  });

  // Log watched paths after initial scan
  chokidarWatcher.on('ready', () => {
    log('Watcher is ready. Watched paths:', 
        chokidarWatcher?.getWatched());
  });

  // Event handlers
  chokidarWatcher.on('add', (path: string) => {
    log('File added:', path);
    if (fileCreated) fileCreated(vscode.Uri.file(path));
  });

  chokidarWatcher.on('change', (path: string) => {
    log('File changed:', path);
    if (fileChanged) fileChanged(vscode.Uri.file(path));
  });

  chokidarWatcher.on('unlink', (path: string) => {
    log('File deleted:', path);
    if (fileDeleted) fileDeleted(vscode.Uri.file(path));
  });

  chokidarWatcher.on('addDir', (path: string) => {
    log('Folder added:', path);
    if (fileCreated) fileCreated(vscode.Uri.file(path));
  });

  chokidarWatcher.on('unlinkDir', (path: string) => {
    log('Folder deleted:', path);
    if (fileDeleted) fileDeleted(vscode.Uri.file(path));
  });
}

export function loadSettings() {
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
  includeFilesPattern   = config.get('filesToInclude', '**/*.js, **/*.ts');
  excludeFoldersPattern = config.get('filesToExclude', 'node_modules/**');
  setFileWatcher(includeFilesPattern, excludeFoldersPattern);
}
