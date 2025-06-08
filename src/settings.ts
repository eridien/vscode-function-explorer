import * as vscode from 'vscode';
import {minimatch} from 'minimatch';
import {glob}      from "glob";
import * as utils  from './utils';
const {log} = utils.getLog('sett');

interface FunctionMarksSettings {
  scrollPosition:      vscode.TextEditorRevealType;
  fileWrap:            boolean;
  includeSubFunctions: boolean;
  alphaSortFuncs?:     boolean; 
}

export let settings: FunctionMarksSettings = {
  scrollPosition:      vscode.TextEditorRevealType.AtTop,
  fileWrap:            true,
  includeSubFunctions: false,
  alphaSortFuncs:      true,
};

export let filesGlobPattern: string;
let excludeCfg:              string;
let includeCfg:              string;

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
    alphaSortFuncs:      config.get('alphaSortFuncs',      true)
  };
  includeCfg = '{'+config.get<string>("filesToInclude", "**/*.js, **/*.ts")
                         .split(",").map(p => p.trim()).join(",")+'}';
  excludeCfg = '{'+config.get<string>( "filesToExclude", "node_modules/**")
                         .split(",").map(p => p.trim()).join(",")+'}';
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