import * as vscode from 'vscode';
import {minimatch} from 'minimatch';
import {glob}      from "glob";
import * as utils  from './utils';
const {log} = utils.getLog('sett');

interface FunctionMarksSettings {
  scrollPosition:      vscode.TextEditorRevealType;
  fileWrap:            boolean;
  includeSubFunctions: boolean;
  alphaSortMarks?:     boolean; 
}

export let settings: FunctionMarksSettings = {
  scrollPosition:      vscode.TextEditorRevealType.AtTop,
  fileWrap:            true,
  includeSubFunctions: false,
  alphaSortMarks:      true,
};

export let filesGlobPattern: string;

export function loadSettings() {
  const config = vscode.workspace.getConfiguration('function-marks');
  let scrollPos: vscode.TextEditorRevealType;
  switch (config.get('scrollPosition', 'AtTop') as string) {
    case 'Minimal Scrolling':
      scrollPos = vscode.TextEditorRevealType.Default; break;
    case 'In Center':
      scrollPos = vscode.TextEditorRevealType.InCenter; break;
    case 'In Center If Needed':
      scrollPos = vscode.TextEditorRevealType.InCenterIfOutsideViewport; break;
    case 'At Top':
    default:
      scrollPos = vscode.TextEditorRevealType.AtTop;
  }
  settings = {
    scrollPosition:      scrollPos,
    fileWrap:            config.get('fileWrap',            true),
    includeSubFunctions: config.get('includeSubFunctions', false),
    alphaSortMarks:      config.get('alphaSortMarks',      true)
  };
  let includeCfg = config.get<string>(
                              "filesToInclude", "**/*.js, **/*.ts");
  includeCfg = includeCfg.split(",").map(p => p.trim()).join(",");
  let excludeCfg = config.get<string>(
                              "filesToExclude", "node_modules/**");
  excludeCfg = excludeCfg.split(",").map(p => p.trim()).join(",");
  excludeCfg = excludeCfg.startsWith('!') ? excludeCfg : '!' + excludeCfg;
  filesGlobPattern = `${includeCfg},${excludeCfg}`;
}

export function includeFile(fsPath: string): boolean {
  const filePath = vscode.workspace.asRelativePath(fsPath);
  return minimatch(filePath, filesGlobPattern);
}
