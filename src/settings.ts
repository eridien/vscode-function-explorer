import * as vscode from 'vscode';
import * as mrks  from './marks';
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
  log('Settings activated:', settings);
}

function mm(val: number, max: number, min: number = 0): number {
  return Math.max(min, Math.min(max, val));
}

function getFunctionMarksSettings(): FunctionMarksSettings {
  const config = vscode.workspace.getConfiguration('function-marks');
  return {
    fileWrap:            config.get('fileWrap',            true),
    includeSubFunctions: config.get('includeSubFunctions', false),
  };
}

export function refreshSettings() {
  settings = getFunctionMarksSettings();
}
