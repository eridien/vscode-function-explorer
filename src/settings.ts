import * as vscode from 'vscode';
import {minimatch} from 'minimatch';
import * as utils  from './utils';
const {log} = utils.getLog('sett');

interface FunctionMarksSettings {
  fileWrap:            boolean;
  includeSubFunctions: boolean;
}

export let settings: FunctionMarksSettings = {
  fileWrap:            true,
  includeSubFunctions: false,
};

export function activate() {
  settings = getFunctionMarksSettings();
}

// function mm(val: number, max: number, min: number = 0): number {
//   return Math.max(min, Math.min(max, val));
// }

let includeFiles: string[] = ["**/*.js", "**/*.ts"];
let excludeFiles: string[] = ["!node_modules/**"];

function getFunctionMarksSettings(): FunctionMarksSettings {
  const config = vscode.workspace.getConfiguration('function-marks');
  includeFiles = config.get<string>(
      "includeFiles", "**/*.js, **/*.ts").split(",").map(p => p.trim());
  excludeFiles = config.get<string>(
      "excludeFiles", "!node_modules/**").split(",").map(p => p.trim());
  return {
    fileWrap:            config.get('fileWrap',            true),
    includeSubFunctions: config.get('includeSubFunctions', false),
  };
}

export function refreshSettings() {
  settings = getFunctionMarksSettings();
}

export function includeDocument(fsPath: string): boolean {
  const filePath = vscode.workspace.asRelativePath(fsPath);
  const isInc    = includeFiles.some(pattern => minimatch(filePath, pattern));
  const isExc    = excludeFiles.some(pattern => minimatch(filePath, pattern));
  return isInc && !isExc;
}

