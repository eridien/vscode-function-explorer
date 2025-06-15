import * as vscode from 'vscode';
import {minimatch} from 'minimatch';
import * as utils  from './utils';
const {log} = utils.getLog('sett');

interface FunctionMarksSettings {
  scrollPosition:      vscode.TextEditorRevealType;
  fileWrap:            boolean;
  includeSubFunctions: boolean;
  alphaSortFuncs:      boolean;
  topMargin:           number;
}

export let settings: FunctionMarksSettings = {
  scrollPosition:      vscode.TextEditorRevealType.AtTop,
  fileWrap:            true,
  includeSubFunctions: false,
  alphaSortFuncs:      false,
  topMargin:           3,
};

export let filesGlobPattern: string;
let excludeCfg:              string;
let includeCfg:              string;

export function loadSettings() {
  const config = vscode.workspace.getConfiguration('function-explorer');
  let scrollPos: vscode.TextEditorRevealType;
  switch (config.get('scrollPosition', 'Default') as string) {
    case 'Minimal Scrolling':
      scrollPos = vscode.TextEditorRevealType.Default; break;
    case 'In Center':
      scrollPos = vscode.TextEditorRevealType.InCenter; break;
    case 'In Center If Needed':
      scrollPos = vscode.TextEditorRevealType.InCenterIfOutsideViewport; break;
    case 'At Top (with Margin)':
    default:
      scrollPos = vscode.TextEditorRevealType.AtTop;
  }
  settings = {
    scrollPosition:      scrollPos,
    fileWrap:            config.get('fileWrap',            true),
    includeSubFunctions: config.get('includeSubFunctions', false),
    alphaSortFuncs:      config.get('alphaSortFuncs',      false),
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
  // log('includeFile', `checking ${relPath} against "${
  //                                excludeCfg}", "${includeCfg}"`,
  //                     minimatch(relPath, excludeCfg), 
  //                     minimatch(relPath, includeCfg));
  if(minimatch(relPath, excludeCfg)) return false;
  return folder || minimatch(relPath, includeCfg);
}