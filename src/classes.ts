import * as vscode from 'vscode';
import * as side   from './sidebar';
import * as gutt   from './gutter';
import * as mrks   from './marks';
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
  setEnabled(enabled: boolean) { 
    this.enabled = enabled; 
    mrks.setMarkInMaps(this);
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
  getStartKey()  { return this.startKey  ??= mrks.createSortKey( 
                          this.getFsPath(), this.getStartLine());      }
  getEndKey()    { return this.endKey    ??= mrks.createSortKey(
                          this.getFsPath(), this.getEndLine());        }
}

export class Item extends vscode.TreeItem {
  wsFolder?:   vscode.WorkspaceFolder;
  mark?:       Mark;
  pointer?:    boolean;
  children?:   Item[];
}

export class SidebarProvider {
  onDidChangeTreeData:          vscode.Event<Item>;
  private _onDidChangeTreeData: vscode.EventEmitter<Item>;
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData  = this._onDidChangeTreeData.event;
  }
  refresh(item?: Item): void {
    // @ts-ignore
    this._onDidChangeTreeData.fire(item);
  }

  getTreeItem(item: Item): Item {
    return item;
  }
  async getChildren(item: Item): Promise<Item[]> {
    if (side.showingBusy) return [];
    if(!item) {
      await mrks.waitForInit();
      return await side.getItemTree() ?? [];
    }
    return item.children ?? [];
  }
}
