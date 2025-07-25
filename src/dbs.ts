import * as vscode     from 'vscode';
import * as path       from 'path';
import * as fs         from 'fs/promises';
import * as sett       from './settings';
import {settings}      from './settings';
import * as itmc       from './item-classes';
import {Item, WsAndFolderItem, FolderItem, 
        FileItem, FuncItem} from './item-classes';
import * as utils      from './utils';
const {log, start, end} = utils.getLog('dbss');

let context: vscode.ExtensionContext;

const CLEAR_MARKS_ON_STARTUP = false;

export function activate(contextIn: vscode.ExtensionContext) {
  context = contextIn;
  itmc.setDbs(itms, fils, mrks);
  loadMarks();
}

////////////////////// items data //////////////////////

type AllButFuncItem = WsAndFolderItem | FileItem;

class Items {
  private static itemsById:         Map<string, Item>           = new Map();
  private static fldrItemsByFspath: Map<string, AllButFuncItem> = new Map();
  private static funcItemsByFuncId: Map<string, Set<FuncItem>>  = new Map();

  getAllFolderFileItems(): AllButFuncItem[] {
    return Array.from(Items.fldrItemsByFspath.values()); 
  }

  getAllFileItems(): FileItem[] {
    const  allItems = this.getAllFolderFileItems();
    return allItems.filter(item => item instanceof FileItem);
  }

  getAllFuncItems(): FuncItem[] {
    const allFuncSets = Items.funcItemsByFuncId.values();
    const result: FuncItem[] = [];
    for(const funcSet of allFuncSets) {
      for(const funcItem of funcSet) {
        result.push(funcItem);
      }
    }
    return result;
  }

  getFuncItemsByFsPath(fsPath: string): FuncItem[] {
    const allFuncSets = Items.funcItemsByFuncId.values();
    const result: FuncItem[] = [];
    for(const funcSet of allFuncSets) {
      for(const funcItem of funcSet) {
        if(funcItem.getFsPath() === fsPath) result.push(funcItem);
      }
    }
    return result;
  }

  getById(id: string): Item  | undefined {
    return Items.itemsById.get(id);
  }

  setFolderItem(item: WsAndFolderItem) {
    Items.fldrItemsByFspath.set(item.fsPath, item);
    Items.itemsById.set(item.id, item);
  }

  setFileItem(item: FileItem) {
    Items.fldrItemsByFspath.set(item.document.uri.fsPath, item);
    Items.itemsById.set(item.id, item);
  }

  getFldrFileByFsPath(fsPath:string): AllButFuncItem | null {
    return Items.fldrItemsByFspath.get(fsPath) ?? null;
  }

  setFunc(item: FuncItem) {
    if(!item.funcId) return;
    let set = Items.funcItemsByFuncId.get(item.funcId);
    if(!set) {
      set = new Set<FuncItem>();
      Items.funcItemsByFuncId.set(item.funcId, set);
    }
    set.add(item);
    Items.itemsById.set(item.id, item);
  }

  getFuncSetByFuncId(funcId: string): Set<FuncItem> | undefined {
    return Items.funcItemsByFuncId.get(funcId);
  }

  deleteFolderById(id: string) {
    const folderItem = Items.itemsById.get(id) as FolderItem;
    if(folderItem) {
      Items.itemsById.delete(id);
      Items.fldrItemsByFspath.delete(folderItem.fsPath);
    }
  }

  deleteFileById(id: string) {
    const fileItem = Items.itemsById.get(id) as FileItem;
    if(fileItem) {
      Items.itemsById.delete(id);
      Items.fldrItemsByFspath.delete(fileItem.document.uri.fsPath);
    }
  }

  deleteFuncById(id: string) {
    const funcItem = Items.itemsById.get(id) as FuncItem;
    if(!funcItem) return;
    Items.itemsById.delete(id);
    let funcId  = funcItem.funcId;
    let funcSet = itms.getFuncSetByFuncId(funcId);
    if(!funcSet) return;
    funcSet = new Set([...funcSet].filter(
                          funcItem => funcItem.funcId !== funcId));
  }

  delFuncSetByFuncId(funcId: string): Set<FuncItem> {
    const funcSet = itms.getFuncSetByFuncId(funcId) ?? new Set<FuncItem>();
    Items.funcItemsByFuncId.delete(funcId);
    return funcSet;
  }
}

export const itms = new Items();

////////////////////// File paths //////////////////////////

class FilePaths {
  private static includedfsPaths = new Set<string>();
  async loadPaths(fsPath: string, clear = false) {
    if (clear) FilePaths.includedfsPaths.clear();
    async function findFuncFiles(fsPath: string) {
      // log('findFuncFiles', fsPath);
      let stat;
      try{
        stat = await fs.stat(fsPath);
        // log('loadPaths stat', fsPath);
        if (stat.isDirectory()) {
          if(!sett.includeFile(fsPath, true)) return;
          let entries: string[];
          entries = await fs.readdir(fsPath);
          // log('loadPaths readdir entries', fsPath, entries);
          for (const entry of entries) {
            const childPath = path.join(fsPath, entry);
            await findFuncFiles(childPath);
          }
        }
        else if(sett.includeFile(fsPath)) {
          if(settings.hideFolders) {
            // log('includedfsPaths.add fsPath', path.basename(fsPath));
            FilePaths.includedfsPaths.add(fsPath);
          }
          else {
            // log('includedfsPaths.add dirname', path.basename(fsPath));
            FilePaths.includedfsPaths.add(path.dirname(fsPath));
          }
        }
      }
      catch (err) { 
        log('errmsg', err, 'loadPaths error', fsPath);
        return; 
      }
    }
    await findFuncFiles(fsPath);
    // log('loadPaths complete', [...FilePaths.includedfsPaths]);
  }
  hasIncludedFile(fsPath: string): boolean {
    for(const includedPath of FilePaths.includedfsPaths) {
      if (includedPath.startsWith(fsPath)) return true;
    }
    return false;
  }
  sortedFsPaths(): string[] {
    return Array.from(FilePaths.includedfsPaths).sort();
  }
  deleteByFsPath(fsPath: string) {
    for(const includedPath of FilePaths.includedfsPaths) {
      if (includedPath.startsWith(fsPath)) {
        FilePaths.includedfsPaths.delete(includedPath);
      }
    }
  }
}
export const fils = new FilePaths();


////////////////////// mark data //////////////////////

class Marks {
  private static markIdSetByFspath:    Map<string, Set<string>> = new Map();
  private static stayAliveSetByFspath: Map<string, Set<string>> = new Map();

  clearAllMarks() {
    Marks.markIdSetByFspath.clear();
    saveMarks();
    // log('cleared all marks');
  }
  getAllMarks(): Array<[string, Set<string>]> {
    return [...Marks.markIdSetByFspath.entries()];
  }
  getMarkSet(fsPath:string): Set<string> {
    const markIdSet = Marks.markIdSetByFspath.get(fsPath);
    if(!markIdSet)    Marks.markIdSetByFspath.set(fsPath, new Set<string>());
    return            Marks.markIdSetByFspath.get(fsPath)!;
  } 
  hasMark(funcItem: FuncItem): boolean {
    const fsPath    = funcItem.getFsPath();
    const funcId    = funcItem.funcId;
    const funcIdSet = Marks.markIdSetByFspath.get(fsPath);
    if(!funcIdSet) return false;
    return funcIdSet.has(funcId);
  }
  hasStayAlive(funcItem: FuncItem): boolean {
    const fsPath = funcItem.getFsPath();
    const funcId = funcItem.funcId;
    const stayAliveSet = Marks.stayAliveSetByFspath.get(fsPath);
    if(!stayAliveSet) return false;
    return stayAliveSet.has(funcId);
  }
  namesByFsPath(fsPath: string): Set<string> {
    const funcIdSet    = Marks.markIdSetByFspath.get(fsPath);
    const stayAliveSet = Marks.stayAliveSetByFspath.get(fsPath);
    const names = new Set<string>();
    if(funcIdSet)
       for(const funcId of [...funcIdSet]) names.add(funcId.split('\x00')[0]);
    if(!stayAliveSet) return names;
    for(const funcId of [...stayAliveSet]) names.add(funcId.split('\x00')[0]);
    return names;
  }
  addMark(fsPath: string, funcId: string) {
    let funcIdSet = Marks.markIdSetByFspath.get(fsPath);
    if(!funcIdSet) {
      funcIdSet = new Set<string>();
      Marks.markIdSetByFspath.set(fsPath, funcIdSet);
    }
    funcIdSet.add(funcId);
    saveMarks();
  }
  addStayAlive(funcItem: FuncItem) {
    const fsPath  = funcItem.getFsPath();
    const funcId  = funcItem.funcId;
    let funcIdSet = Marks.stayAliveSetByFspath.get(fsPath);
    if(!funcIdSet) {
      funcIdSet = new Set<string>();
      Marks.stayAliveSetByFspath.set(fsPath, funcIdSet);
    }
    funcIdSet.add(funcId);
  }
  delMark(funcItem: FuncItem) {
    const fsPath    = funcItem.getFsPath();
    const funcIdSet = Marks.markIdSetByFspath.get(fsPath);
    if(!funcIdSet) return;
    funcIdSet.delete(funcItem.funcId);
    saveMarks();
  }
  clrStayAlive(fsPath: string) {
    Marks.stayAliveSetByFspath.delete(fsPath);
  }
}
export const mrks = new Marks();

function loadMarks() {
  let fsPathMarkIdArr: Array<[string, string[]]> =  
                         context.workspaceState.get('markIds', []);
  if(CLEAR_MARKS_ON_STARTUP) {
    fsPathMarkIdArr = [];
    context.workspaceState.update('markIds', []);
  }
  let markCount = 0;
  for(const [fsPath, markIds] of fsPathMarkIdArr) {
    for(const funcId of markIds) {
      mrks.addMark(fsPath, funcId);
      markCount++;
    }
  }
  log(`loaded ${markCount} marks`);
}

let saveMarksTO: NodeJS.Timeout | undefined;

function saveMarks() {
  if(saveMarksTO) clearTimeout(saveMarksTO);
  saveMarksTO = setTimeout(() => {
    saveMarksTO        = undefined;
    const markIdSetArr = mrks.getAllMarks();
    let markCount      = 0;
    const markIdArrArr = [];
    for(const [fsPath, markIdSet] of markIdSetArr) {
      markCount += markIdSet.size;
      markIdArrArr.push([fsPath, [...markIdSet]]);
    }
    context.workspaceState.update('markIds', markIdArrArr);
    log(`saved ${markCount} marks`);
  }, 100);
}

