import * as vscode  from 'vscode';
import * as cmds    from './commands';
import * as mrks    from './marks';
import * as sidebar from './sidebar';
import * as gutt    from './gutter';
import * as sett    from './settings';
import * as utils   from './utils';
const {log, start, end} = utils.getLog('extn');

export async function activate(context: vscode.ExtensionContext) {
  start('extension');
  
	const toggle = vscode.commands.registerCommand(
           'vscode-function-marks.toggle', async () => {
		await cmds.toggle();
	});

	const prev = vscode.commands.registerCommand(
                   'vscode-function-marks.prev', async () => {
		await cmds.prev();
	});

	const next = vscode.commands.registerCommand(
                   'vscode-function-marks.next', async () => {
		await cmds.next();
	});

	const markClickCmd = vscode.commands.registerCommand(
                   'vscode-function-marks.markClickCmd', async () => {
		await sidebar.markClickCmd();
	});

  const loadSettings = vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('function-marks')) {
      sett.loadSettings();
      sidebar.updateSidebar();
    }
  });

  const sidebarProvider = new sidebar.SidebarProvider();
  const treeView = vscode.window.createTreeView('sidebarView', {
    treeDataProvider: sidebarProvider,
  });

  const chgSidebarVisibility = treeView.onDidChangeVisibility(event => {
    sidebar.chgSidebarVisibility(event.visible);
  });

  const chgItemFocus = treeView.onDidChangeSelection(event => {
    if (event.selection.length > 0) {
      sidebar.chgItemFocus(event.selection[0]);
    }
  });

  const editorChg = vscode.window.onDidChangeActiveTextEditor(
    async editor => { if(editor) await cmds.editorChg(editor); });

  const chgEditorSel = vscode.window.onDidChangeTextEditorSelection(event => {
    if (event.textEditor?.document.uri.scheme !== 'file') return;
    cmds.chgEditorSel(event);
  });

  const textChg = vscode.workspace.onDidChangeTextDocument(async event => {
    if (vscode.window.activeTextEditor &&
        event.document === vscode.window.activeTextEditor.document) {
      await cmds.textChg(event);
    }
  });

  sett.loadSettings();
  await mrks.activate(context);
  await mrks.waitForInit();
  await mrks.initMarks();
  sidebar.init(treeView, sidebarProvider);
  gutt.activate(context);
  cmds.updateSide();

	context.subscriptions.push(
    toggle, prev, next, loadSettings, textChg, editorChg,
    chgSidebarVisibility, chgItemFocus, chgEditorSel, markClickCmd);

  end('extension');
}

export function deactivate() {
  log('extension deactivated');
}