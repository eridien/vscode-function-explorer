import * as vscode from 'vscode';
import {minimatch} from 'minimatch';
import * as path from 'path';
import * as fs from 'fs';
import * as utils  from './utils';
import { file } from '@babel/types';
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
  hideRootFolders:     true,
  flattenFolders:     true,
  scrollPosition:     "Function Center At Center If Needed",
  fileWrap:           false,
  alphaSortFunctions: false,
  topMargin:          3,
  openFileWhenExpanded: false
};

let includePattern:  string;
let excludePattern:  string;
export let globPattern: string;

export function loadSettings() {
  const config = vscode.workspace.getConfiguration('function-explorer');
  settings = {
    scrollPosition:     config.get('scrollPosition', 
                                   "Function Center At Center If Needed"),
    hideRootFolders:     config.get('hideRootFolders',     true),
    flattenFolders:     config.get('flattenFolders',     true),
    openFileWhenExpanded: config.get('openFileWhenExpanded', false),
    fileWrap:           config.get('fileWrap',           false),
    alphaSortFunctions: config.get('alphaSortFunctions', false),
    topMargin:          config.get('topMargin',              3),
  };

  includePattern = config.get('filesToInclude', '**/*.js, **/*.ts');
  excludePattern = config.get('filesToExclude', 'node_modules/**, prism/**, out/**');
}

export function includeFile(
  filePath: string,
  isFolder= false
): boolean {
  // filePath = "c:\\Users\\mark\\apps\\test-app\\node_modules";
  // isFolder= true;

  const includeGlobs = includePattern
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const excludeFolderPatterns = excludePattern
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const normalizedPath = path.normalize(filePath).replace(/\\/g, '/');

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

export let watcher: vscode.FileSystemWatcher;
watcher = createFilteredWatcher(
  '**/*.js, **/*.ts',
  'node_modules/**, prism/**, out/**',
  (uri) => { log('File changed:', uri.fsPath); }
);

function createFilteredWatcher(
  filesToInclude: string,
  filesToExclude: string,
  onFileChange: (uri: vscode.Uri) => void
): vscode.FileSystemWatcher {
  const includeGlobs = filesToInclude
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);

  const excludeGlobs = filesToExclude
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);

  // Combine include globs into a single pattern
  const includePattern = includeGlobs.length === 1
    ? includeGlobs[0]
    : `{${includeGlobs.join(',')}}`;

  const watcher = vscode.workspace.createFileSystemWatcher(includePattern);

  const shouldIgnore = (uri: vscode.Uri): boolean => {
    const normalized = uri.fsPath.replace(/\\/g, '/');
    return excludeGlobs.some(pattern =>
      minimatch(normalized, pattern, { dot: true })
    );
  };

  const handleEvent = (uri: vscode.Uri) => {
    if (!shouldIgnore(uri)) {
      onFileChange(uri);
    }
  };

  watcher.onDidCreate(handleEvent);
  watcher.onDidChange(handleEvent);
  watcher.onDidDelete(handleEvent);

  return watcher;
}

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
    // log('start, end, current,  totalGaps', range.start.line, 
    //                                        range.end.line, current, totalGaps);
    current = range.end.line;
  }
  const capacity = totalHeight - totalGaps;
  // log('measureViewportCapacity', capacity);
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
