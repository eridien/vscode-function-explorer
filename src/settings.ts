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
  scrollPosition:     "Function Center At Center If Needed",
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
                                   "Function Center At Center If Needed"),
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

/*
editor.selection = new vscode.Selection(line, 0, line, 0);
await vscode.commands.executeCommand('editor.unfold', { levels: 1, direction: 'down' });
*/

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
  log('i', i);
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
    log('start, end, current,  totalGaps', range.start.line, 
                                           range.end.line, current, totalGaps);
    current = range.end.line;
  }
  const capacity = totalHeight - totalGaps;
  log('measureViewportCapacity', capacity);
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
  if(top < 0) top = 0;
  editor.revealRange(new vscode.Range(top, 0, top, 0), 
                         vscode.TextEditorRevealType.AtTop);
}
