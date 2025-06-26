let screenHeight = -1;
let ignoreDidChangeVisible = false;

const visibleRanges = editor.visibleRanges;
let linebottom = visibleRanges[0].end.line;
let total = 0;
let current = visibleRanges[0].start.line;

for (const range of visibleRanges) {
  if (current < range.start.line) {
    total += range.start.line - current; // folded gap
  }
  total += range.end.line - range.start.line; // visible lines
  current = range.end.line;
  if (total >= linebottom) break;
}

const viewportCapacity = totalVisible + totalFolded;

export async function measureViewportCapacity(editor: vscode.TextEditor): Promise<number> {
  log('measureViewportCapacity', ignoreDidChangeVisible);
  // await vscode.window.showTextDocument(editor.document, editor.viewColumn);
  await vscode.commands.executeCommand('cursorTop');
  await new Promise(res => setTimeout(res, 300));
  const visibleRange = editor.visibleRanges[0];
  const capacity = visibleRange.end.line - visibleRange.start.line;
  await vscode.commands.executeCommand('cursorTop');
  log(`>>> capacity ${capacity}`, ignoreDidChangeVisible);
  return capacity;
}

import * as vscode from 'vscode';
import {minimatch} from 'minimatch';
import * as utils  from './utils';
const {log} = utils.getLog('sett');

interface FunctionMarksSettings {
  flattenFolders:     boolean;
  scrollPosition:    "Function Top At Top"           | 
                     "Function Center At Center"     |
                     "Function Bottom At Bottom"     | 
                     "Function Top At Top If Needed" |
                     "Function Center At Center If Needed";
  fileWrap:           boolean;
  alphaSortFuncs:     boolean;
  topMargin:          number;
  showFileOnFileOpen: boolean;
}

export let settings:  FunctionMarksSettings = {
  flattenFolders:     true,
  scrollPosition:     "Function Center At Center",
  fileWrap:           true,
  alphaSortFuncs:     false,
  topMargin:          3,
  showFileOnFileOpen: true
};

export let filesGlobPattern: string;
let excludeCfg:              string;
let includeCfg:              string;

export function loadSettings() {
  const config = vscode.workspace.getConfiguration('function-explorer');
  settings = {
    scrollPosition:     config.get('scrollPosition', 
                                   "Function Center At Center"),
    flattenFolders:     config.get('flattenFolders',     true),
    showFileOnFileOpen: config.get('showFileOnFileOpen', true),
    fileWrap:           config.get('fileWrap',           true),
    alphaSortFuncs:     config.get('alphaSortFuncs',     false),
    topMargin: Math.max(0, Math.min(20, config.get('topMargin', 3))),
  };
  const incParts = config.get<string>("filesToInclude", "**/*.js, **/*.ts")
                         .split(",").map(p => p.trim());
  if(incParts.length < 2) includeCfg =     incParts[0];
  else                    includeCfg = '{'+incParts.join(",")+'}';
  const excParts = config.get<string>("filesToExclude", "node_modules/**")
                         .split(",").map(p => p.trim());
  if(excParts.length < 2) excludeCfg =     excParts[0];
  else                    excludeCfg = '{'+excParts.join(",")+'}';
  filesGlobPattern = `${includeCfg},!${excludeCfg}`;
}

export function includeFile(fsPath: string, folder?:boolean): boolean {
  const filePath = vscode.workspace.asRelativePath(fsPath);
  const relPath = folder ? filePath + '/' : filePath;
  if(minimatch(relPath, excludeCfg)) return false;
  return folder || minimatch(relPath, includeCfg);
}

export async function setScroll(editor: vscode.TextEditor, 
                          funcTop: number, funcBottom: number) {
  ignoreDidChangeVisible = true;
  log('setScroll', ignoreDidChangeVisible);
  const functionTopMargin   = funcTop - settings.topMargin;
  const funcHeight          = funcBottom - funcTop;
  const visibleRange        = editor.visibleRanges[0];
  const screenTop           = visibleRange.start.line;
  const screenBottom        = visibleRange.end.line;
  if(screenHeight < 0) {
        screenHeight        = await measureViewportCapacity(editor);
    const visibleRange        = editor.visibleRanges[0];
    const screenTop           = visibleRange.start.line;
    const screenBottom        = visibleRange.end.line;
    screenHeight        = screenBottom - screenTop;
  } else  {
    const visibleRange        = editor.visibleRanges[0];
    const screenTop           = visibleRange.start.line;
    const screenBottom        = visibleRange.end.line;
    screenHeight        = screenBottom - screenTop;
  }
  let top = 0;
  switch(settings.scrollPosition) {
    case "Function Top At Top": 
            top = functionTopMargin; break;
    case "Function Center At Center": 
            top = functionTopMargin + 
                    (Math.floor( screenHeight / 2) - 
                     Math.floor( funcHeight   / 2)); break;
    case "Function Bottom At Bottom":
            top = funcBottom - screenHeight; break;
    case "Function Top At Top If Needed":
            if(functionTopMargin < screenTop || funcBottom > screenBottom)
              top = functionTopMargin; 
            break;
    case "Function Center At Center If Needed":
            if(functionTopMargin < screenTop || funcBottom > screenBottom)
              top = Math.floor(screenHeight / 2) - 
                    Math.floor(funcHeight   / 2); 
            break;
    default: top = 0; break;
  }
  if(top < 0) top = functionTopMargin;
  editor.revealRange(new vscode.Range(top, 0, top, 0), 
                         vscode.TextEditorRevealType.AtTop);
  log('setScroll end', ignoreDidChangeVisible);
  setTimeout(() => {
    log('setTimeout', ignoreDidChangeVisible);
    ignoreDidChangeVisible = false;
  }, 500);
}

vscode.window.onDidChangeTextEditorVisibleRanges(event => {
  log('visibleRangechg before', ignoreDidChangeVisible);
  if (ignoreDidChangeVisible) return;
  log('visibleRangechg after', ignoreDidChangeVisible);
  screenHeight = -1;
});

export function enableDidChangeVisible() {
  if (ignoreDidChangeVisible) return;
  log('enableDidChangeVisible', ignoreDidChangeVisible);
  ignoreDidChangeVisible = false;
}
