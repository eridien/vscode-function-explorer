import * as vscode     from 'vscode';
import * as path       from 'path';
import * as fs         from 'fs/promises';
import * as parse      from './parse';
import type {NodeData} from './parse';
import * as sett       from './settings';
import {settings}      from './settings';
import * as utils      from './utils';
const {log, start, end} = utils.getLog('disp');

// const CLEAR_MARKS_ON_STARTUP = false; 
const CLEAR_MARKS_ON_STARTUP = true; 

const DEBUG_FUNC_TYPE = false;
// const DEBUG_FUNC_TYPE = true;

let context:         vscode.ExtensionContext;
let treeView:        vscode.TreeView<Item>;
let sidebarProvider: SidebarProvider;

export async function activate(contextIn:  vscode.ExtensionContext,
                               treeViewIn:        vscode.TreeView<Item>,
                               sidebarProviderIn: SidebarProvider) {
  context         = contextIn;
  treeView        = treeViewIn;
  sidebarProvider = sidebarProviderIn;
  loadMarks();
  initGutter();
  await mrks.loadAllFilesWithFuncIds();
}


////////////////////// getTree //////////////////////

export async function getTree() {
  const wsFolders = vscode.workspace.workspaceFolders;
  if (!wsFolders || wsFolders.length === 0) {
    log('err', 'getTree, No folders in workspace');
    return [];
  }
  if (!settings.hideRootFolders) {
    const tree: Item[] = [];
    for(const wsFolder of wsFolders) {
      // await fils.loadPaths(wsFolder.uri.fsPath);
      const wsFolderItem = await getOrMakeWsFolderItem(wsFolder);
      tree.push(wsFolderItem);
    }
    return tree;
  }
  const foldersIn: Item[] = [];
  const filesIn:   Item[] = [];
  for(const wsFolder of wsFolders){
    // await fils.loadPaths(wsFolder.uri.fsPath);
    const wsFolderItem = await getOrMakeWsFolderItem(wsFolder);
    await getFolderChildren(wsFolderItem, foldersIn, filesIn, true);
  }
  return [...foldersIn, ...filesIn];
}

///////////////// updateFileChildrenFromAst //////////////////////

export function updateFileChildrenFromAst(fileItem: FileItem): 
                         { structChg: boolean, funcItems: FuncItem[] } | null {
  start('updateFileChildrenFromAst', true);
  const document = fileItem.document;
  const uri      = document.uri;
  const fsPath   = uri.fsPath;
  if(uri.scheme !== 'file' || !sett.includeFile(uri.fsPath)) return null;
  function empty(): {structChg: boolean, funcItems: FuncItem[]} {
    const structChg = (!!fileItem.children && fileItem.children.length > 0);
    fileItem.children = null;
    log(`no funcs in ${path.basename(fsPath)}`);
    end('updateFileChildrenFromAst', true);
    return {structChg, funcItems:[]};
  };
  const docText = document.getText();
  if (!docText || docText.length === 0) return empty();
  const nodeData = parse.parseCode(docText, fsPath);
  if(!nodeData || nodeData.length === 0) return empty();
  let matchCount              = 0;
  let structChg               = false;
  const children              = fileItem.children as FuncItem[] | undefined;
  let   childIdx              = 0;
  const funcItemsInList       = new Set<FuncItem>();
  const funcItems: FuncItem[] = [];
  for(const node of nodeData) {
    let funcItem: FuncItem | undefined = undefined;
    if(!structChg) funcItem = children?.[childIdx++];
    if(funcItem?.funcId !== node.funcId) {
      structChg = true;
      const funcSet = itms.getFuncSetByFuncId(node.funcId);
      if(funcSet) {
        for(const funcFromSet of funcSet.values()) {
          if(!funcItemsInList.has(funcFromSet)) {
            funcItem = funcFromSet;
            funcSet.delete(funcItem);
            break;
          }
        }
      }
      funcItem ??= new FuncItem({...node, parent:fileItem});
    }
    else matchCount++;
    Object.assign(funcItem, node);
    funcItem.clear();
    funcItems.push(funcItem);
    funcItemsInList.add(funcItem);
  }
  for(const funcItem of funcItems) itms.setFunc(funcItem);
  fileItem.children = funcItems;
  // log(`updated ${path.basename(fsPath)} funcs, `+
  //             `${structChg ? 'with structChg, ' : ''}`+
  //             `marks copied: ${matchCount} of ${funcItems.length}`);
  end('updateFileChildrenFromAst', true);
  return {structChg, funcItems};
}

///////////////////////////// sidebarProvider /////////////////////////////

let ignoreItemRefreshCalls = true;
let delayItemRefreshCalls  = false;
const refreshQueue: Item[] = [];
let refreshTimeout: NodeJS.Timeout | undefined;

export class SidebarProvider {
  onDidChangeTreeData:               vscode.Event<Item        | undefined>;
  private _onDidChangeTreeData = new vscode.EventEmitter<Item | undefined>();

  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData  = this._onDidChangeTreeData.event;
  }

  refresh(item:Item | undefined, tryAgain = false): void {
    if(ignoreItemRefreshCalls) return;
    if(delayItemRefreshCalls) {
      if(!tryAgain) refreshQueue.push(item!);
      clearTimeout(refreshTimeout);
      refreshTimeout = setTimeout(() => {this.refresh(item, true);}, 10);
      return;
    }
    for(const queueItem of refreshQueue) {
      // log('refresh1', item?.label, item?.id);
      this._onDidChangeTreeData.fire(queueItem);
    }
    refreshQueue.length = 0;
    // log('refresh2', item?.label, item?.id);
    this._onDidChangeTreeData.fire(item);
  }

  getTreeItem(itemIn: Item): Item {
    ignoreItemRefreshCalls = false;
    const itemInId    = itemIn.id;
    const itemInLabel = itemIn.label;
    const item        = itms.getById(itemInId);
    // log('getTreeItem start', itemInLabel, item?.label);
    if(!item) {
      log('err', 'getTreeItem, item not found:', itemInLabel);
      return itemIn;
    }
    item.refresh();
    if(item !== itemIn || item.id !== itemInId) {
      log('err', 'getTreeItem, item return mismatch:', 
                  itemInLabel, item.label);
      return itemIn;
    }
    // log('getTreeItem end', itemIn.label, item?.label);
    return item;
  }

  getParent(item: Item): Item | null {
    // log('getParent', item.label);
    if(item?.parent) return item.parent;
    return null;
  }

  async getChildren(item: Item): Promise<Item[]> {
    // log('getChildren', item?.label);
    delayItemRefreshCalls = true;
    if(!item) {
      const tree = await getTree();
      delayItemRefreshCalls = false;
      return tree;
    }
    if(item instanceof FuncItem) {
      delayItemRefreshCalls = false;
      return [];
    }
    const children = 
             await (item as WsAndFolderItem | FileItem).getChildren();
    delayItemRefreshCalls = false;
    return children;
  }
}

export function updateItemInTree(item: Item | undefined = undefined) {
  sidebarProvider.refresh(item);
}

export async function revealItemByFunc(func: FuncItem) {
  if(!treeView.visible) return;
  const item = await getOrMakeFileItemByFsPath(func.getFsPath());
  if(!item.parent) return;
  treeView.reveal(item, {expand: true, select: true, focus: false});
}

export async function itemExpandChg(item: WsAndFolderItem | FileItem, 
                                    expanded: boolean) {
  if(!expanded) {
    const funcItems = await getFuncItemsUnderNode(item);
    let filesChanged = new Set<FileItem>();
    let haveMark = false;
    for(const funcItem of funcItems) {
      if(mrks.hasMark(funcItem)) haveMark = true;
      if(funcItem.stayVisible) {
        filesChanged.add(funcItem.parent);
        funcItem.clrStayVisible();
      }
    }
    if(item.contextValue === 'file') {
      if(!haveMark &&(item as FileItem).filtered) {
        filesChanged.add(item as FileItem);
        (item as FileItem).filtered = false;
      }
      if(settings.openFileWhenExpanded)
        await utils.revealEditorByFspath((item as FileItem).document.uri.fsPath);    
    }
    for(const fileItem of filesChanged) updateItemInTree(fileItem);
  }
  item.expanded = expanded;
}

////////////////////// Gutter //////////////////////

let gutDecLgtUri: vscode.Uri;
let gutDecDrkUri: vscode.Uri;
let gutterDec:    vscode.TextEditorDecorationType;
let decRanges:    vscode.DecorationOptions[] = [];

function initGutter() {
  gutDecLgtUri = vscode.Uri.file(path.join( 
                  context.extensionPath, 'images', 'gutter-icon-lgt.svg'));
  gutDecDrkUri = vscode.Uri.file(path.join( 
                  context.extensionPath, 'images', 'gutter-icon-drk.svg'));
  gutterDec    = getGutterDec();
}

function getGutterDec() {
  return vscode.window.createTextEditorDecorationType({
    gutterIconSize: 'contain',
    light: { gutterIconPath: gutDecLgtUri},
    dark:  { gutterIconPath: gutDecDrkUri}
  });
};

vscode.window.onDidChangeActiveColorTheme(() => {
  if(gutterDec) gutterDec.dispose();
  gutterDec = getGutterDec();
  const editor = vscode.window.activeTextEditor;
  if(!decRanges || !editor) return;
  editor.setDecorations(gutterDec, decRanges);
});

export function updateGutter(editor:   vscode.TextEditor, 
                             fileItem: FileItem) {
  const children = fileItem.getChildren();
  decRanges = [];
  for(const funcItem of children) {
    if(!mrks.hasMark(funcItem)) continue;
    const lineNumber = funcItem.getStartLine();
    const range = new vscode.Range(lineNumber, 0, lineNumber, 0);
    decRanges.push({range});
  }
  editor.setDecorations(gutterDec, decRanges);
}

export async function setMark(funcItem: FuncItem, 
          toggle = false, mark:boolean = false): Promise<boolean | undefined> {
  // log('setMark', funcItem.name, toggle, mark);
  const fsPath = funcItem.getFsPath();
  if(!fsPath) return;
  const funcId  = funcItem.funcId;
  const markSet = mrks.getMarkSet(fsPath);
  let marked    = markSet.has(funcId);
  let wasMarked = marked;
  if (toggle) marked = !marked;
  else        marked = mark;
  if(marked === wasMarked)  return;
  if(marked) mrks.addMark(fsPath, funcId);
  else       mrks.delMark(funcItem);
  updateItemInTree(funcItem.parent);
  if(marked) await revealItemByFunc(funcItem);
  const activeEditor = vscode.window.activeTextEditor;
  if(!activeEditor || activeEditor.document.uri.fsPath !== fsPath) return;
  updateGutter(activeEditor, funcItem.parent);
  return marked;
}

let pointerItems = new Set<FuncItem>();

export async function updatePointers() {
  if(!treeView) debugger;
  if(!treeView.visible) return;
  const oldPointerItems = new Set(pointerItems);
  pointerItems.clear();
  const newPointerItems = await getFuncsOverlappingSelections();
  for(const funcItem of newPointerItems) pointerItems.add(funcItem);
  for(const funcItem of oldPointerItems) updateItemInTree(funcItem);
  for(const funcItem of newPointerItems) updateItemInTree(funcItem);
}

///////////////////// editor text //////////////////////

export async function getFuncInAroundSelection() : Promise<FuncItem | null> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const document = editor.document;
  const fsPath = document.uri.fsPath;
  if (document.uri.scheme !== 'file' ||
     !sett.includeFile(fsPath)) return null;
  const fileItem = await getOrMakeFileItemByFsPath(fsPath);
  const children = fileItem.getChildren(true) as FuncItem[] | undefined;
  if (!children || children.length === 0) return null;
  const funcsInSelection:     FuncItem[] = [];
  const funcsAroundSelection: FuncItem[] = [];
  for (const selection of editor.selections) {
    const selStartLine = selection.start.line;
    const selEndLine   = selection.end.line;
    for(const func of children) {
      const funcStartLine = func.getStartLine();
      const funcEndLine   = func.getEndLine();
      const selRange  = new vscode.Range(selStartLine,  0, selEndLine,  0);
      const funcRange = new vscode.Range(funcStartLine, 0, funcEndLine, 0);
      if (selRange.contains(funcRange)) funcsInSelection.push(func);
      if (funcsInSelection.length == 0 && funcRange.contains(selRange))
         funcsAroundSelection.push(func);
    }
  }
  if(funcsInSelection.length > 0) {
    let maxFuncLenIn = -1;
    let biggestFuncInSelection = null;
    for(const func of funcsInSelection) {
      const funcLen = (func.getEndLine() - func.getStartLine());
      if(funcLen > maxFuncLenIn) {
        maxFuncLenIn = funcLen;
        biggestFuncInSelection = func;
      }
    }
    return biggestFuncInSelection;
  }
  if(funcsAroundSelection.length > 0) {
    let minFuncLenAround = 1e9;
    let smallestFuncAroundSelection = null;
    for(const func of funcsAroundSelection) {
      const funcLen = (func.getEndLine() - func.getStartLine());
      if(funcLen < minFuncLenAround) {
        minFuncLenAround = funcLen;
        smallestFuncAroundSelection = func;
      }
    }
    return smallestFuncAroundSelection;
  }
  return null;
}

export async function getFuncsOverlappingSelections(): Promise<FuncItem[]> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return [];
  const document = editor.document;
  const fsPath   = document.uri.fsPath;
  if (document.uri.scheme !== 'file' ||
     !sett.includeFile(fsPath)) return [];
  const fileItem = await getOrMakeFileItemByFsPath(fsPath);
  const children = fileItem.getChildren() as FuncItem[] | undefined;
  if (!children || children.length === 0) return [];
  const overlapping: FuncItem[] = [];
  for (const selection of editor.selections) {
    const selStart = selection.start.line;
    const selEnd   = selection.end.line;
    for (const func of children) {
      const funcStart = func.getStartLine();
      if(funcStart > selEnd) break;
      const funcEnd = func.getEndLine();
      if (selStart <= funcEnd && funcStart <= selEnd) {
        overlapping.push(func);
      }
    }
  }
  return overlapping;
}

export async function scrollAndFlash(editor: vscode.TextEditor, 
          startPos: vscode.Position, endPos: vscode.Position, red = false) {
  await sett.setScroll(  editor, startPos.line, endPos.line);
  utils.flashRange(editor, startPos.line, endPos.line, red);
}

export async function revealFuncInEditor(
               itemDoc: vscode.TextDocument | FuncItem | null, red = false) {
  if(itemDoc instanceof FuncItem) {
    const document = itemDoc.parent.document;
    const editor = await vscode.window.showTextDocument(
                          document, { preview: true });
    const startPos = document.positionAt(itemDoc.start);
    const endPos   = document.positionAt(itemDoc.end);
    await scrollAndFlash(editor, startPos, endPos, red);
    editor.selection = new vscode.Selection(startPos, startPos);
  }
  else if(itemDoc) await vscode.window.showTextDocument(
      itemDoc.uri, {preview: true, preserveFocus: true });
}

