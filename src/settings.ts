import * as vscode from 'vscode';
import * as utils  from './utils';
const {log} = utils.getLog('sett');

export let settings = getFunctionMarkSettings();

export function refreshSettings() {
  settings = getFunctionMarkSettings();
}

export interface FunctionMarkSettings {
  marginTop:       number;
  alignLeft:       boolean;
  alignRight:      boolean;
  indent:          number;
  padding:         number;
  splitName:       boolean;
  upperCase:       boolean;
  marginBottom:    number;
  minWidth:        number;
  maxWidth:        number;
  fillerString:    string;
  inline:          boolean;
  descriptionLine: boolean;
}

function mm(val: number, max: number, min: number = 0): number {
  return Math.max(min, Math.min(max, val));
}

export function getFunctionMarkSettings(): FunctionMarkSettings {
  const config = vscode.workspace.getConfiguration('function-marks');
  return {
    marginTop:        mm(config.get<number>('marginTop', 0), 6),
    alignLeft:        config.get('alignLeft',  false),
    alignRight:       config.get('alignRight', false),
    indent:           mm(config.get<number>('indent',  0), 120),
    padding:          mm(config.get<number>('padding', 2), 120),
    splitName:        config.get('splitName', true),
    upperCase:        config.get('upperCase', true),
    marginBottom:     mm(config.get<number>('marginBottom', 0), 6),
    minWidth:         mm(config.get<number>('minWidth', 20), 120),
    maxWidth:         mm(config.get<number>('maxWidth', 80), 120),
    fillerString:     config.get('fillerString', '*'),
    inline:           config.get('inline', false),
    descriptionLine:  config.get('descriptionLine', true),
  };
}
