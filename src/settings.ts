let screenHeight = -1;
let ignoreDidChangeVisible = false;

export async function measureViewportCapacity(editor: vscode.TextEditor): Promise<number> {
  if (ignoreDidChangeVisible) return screenHeight;
  ignoreDidChangeVisible = true;
  const document = editor.document;
  const originalText = document.getText();
  const testLineCount = 300;
  const testText = Array(testLineCount).fill(' ').join('\n');
  // Replace document with test text
  await editor.edit(editBuilder => {
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(originalText.length)
    );
    editBuilder.replace(fullRange, testText);
  });
  // Focus the editor to ensure visibleRanges updates
  await vscode.window.showTextDocument(editor.document, editor.viewColumn);
  // Scroll to top
  await vscode.commands.executeCommand('cursorTop');
  // Wait for VS Code to update the visible range
  await new Promise(res => setTimeout(res, 300));
  const visibleRange = editor.visibleRanges[0];
  const capacity = visibleRange.end.line - visibleRange.start.line;
  log(`Viewport visibleRange: start=${visibleRange.start.line}, end=${visibleRange.end.line}`);
  // Restore original text
  await editor.edit(editBuilder => {
    const fullRange = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(editor.document.getText().length)
    );
    editBuilder.replace(fullRange, originalText);
  });
  // Optionally, scroll back to top of original
  await vscode.commands.executeCommand('cursorTop');
  log(`Viewport capacity is ${capacity} lines`);
  // setTimeout(() => {
  //   ignoreDidChangeVisible = false;
  // }, 2000);
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
  const functionTopMargin   = funcTop - settings.topMargin;
  const funcHeight          = funcBottom - funcTop;
  const visibleRange        = editor.visibleRanges[0];
  const screenTop           = visibleRange.start.line;
  const screenBottom        = visibleRange.end.line;
  if(screenHeight < 0) 
        screenHeight        = await measureViewportCapacity(editor);
  else  screenHeight        = screenBottom - screenTop;
  // log('se1', settings.scrollPosition, {
  //                   funcTop, funcBottom, functionTopMargin, funcHeight, 
  //                   screenTop, screenBottom, screenHeight});
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

  // await measureViewportCapacity(editor);
  // log('set2', settings.scrollPosition, {
  //                   funcTop, funcBottom, functionTopMargin, funcHeight, 
  //                   screenTop, screenBottom, screenHeight});
  if(top < 0) top = functionTopMargin;
  // log('capacity', top);
  editor.revealRange(new vscode.Range(top, 0, top, 0), 
                         vscode.TextEditorRevealType.AtTop);
}

vscode.window.onDidChangeTextEditorVisibleRanges(event => {
  if (ignoreDidChangeVisible) return;
  log('visibleRanges changed');
  screenHeight = -1;
});

export function enableDidChangeVisible() {
  log('enableDidChangeVisible');
  ignoreDidChangeVisible = false;
}
