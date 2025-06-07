import * as vscode from 'vscode';
import * as utils  from './utils';
const {log} = utils.getLog('cmds');

export class Mark {
  wsFolder?:      vscode.WorkspaceFolder;
  document:       vscode.TextDocument;
  name:           string;
  type:           string;
  start:          number;
  end:            number;
  parents?:       Mark[];
  id?:            string;
  startLine?:     number;
  endLine?:       number;
  startKey?:      string;
  endKey?:        string;
  fsPath?:        string;
  item?:          Item;
  enabled:        boolean;
  missing:        boolean;
  constructor(p:any) {
    const {document, name, type, start, end} = p;
    this.document  = document;
    this.name      = name;
    this.type      = type;
    this.start     = start;
    this.end       = end;
    this.enabled   = false;
    this.missing   = false;
  }
  getWsFolder()  { 
    this.wsFolder ??= vscode.workspace
                            .getWorkspaceFolder(this.document.uri);
    if(!this.wsFolder) {
      log('err', 'getWsFolder, mark has no workspace folder', 
                    this.name, this.getFsPath());
      throw new Error('Mark has no workspace folder');
    }
    return this.wsFolder;
  }
  getFsPath()    { return this.fsPath    ??= 
                          this.document.uri.fsPath;                    }
  getStartLine() { return this.startLine ??= 
                          this.document.positionAt(this.start).line;   }
  getEndLine()   { return this.endLine   ??= 
                          this.document.positionAt(this.end).line;     }
  getStartKey()  { return this.startKey  ??= utils.createSortKey( 
                          this.getFsPath(), this.getStartLine());      }
  getEndKey()    { return this.endKey    ??= utils.createSortKey(
                          this.getFsPath(), this.getEndLine());        }
  equalsPos(mark:Mark) { 
    return (this.start === mark.start &&
            this.end   === mark.end);
  }
}

export class Item extends vscode.TreeItem {
  wsFolder?:   vscode.WorkspaceFolder;
  mark?:       Mark;
  pointer?:    boolean;
  children?:   Item[];
}
