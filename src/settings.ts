import * as vscode from 'vscode';

export interface JsonCommenterSettings {
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

export function getJsonCommenterSettings(): JsonCommenterSettings {
  const config = vscode.workspace.getConfiguration('json-commenter');
  return {
    indent:              mm(config.get<number>('indent', 4),      60),
    marginTop:           mm(config.get<number>('marginTop', 1),    6),
    marginBottom:        mm(config.get<number>('marginBottom', 1), 6),
    padding:             mm(config.get<number>('padding', 2),      3),
    minWidth:            mm(config.get<number>('minWidth', 20),  200, 20),
    maxWidth:            mm(config.get<number>('maxWidth', 60),  200, 20),
  };
}
