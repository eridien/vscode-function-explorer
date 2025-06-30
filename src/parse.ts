import Parser                from 'tree-sitter';
import type { SyntaxNode }   from 'tree-sitter';
import JavaScript            from 'tree-sitter-javascript';
const {typescript, tsx} = require('tree-sitter-typescript');
import * as utils            from './utils';
const {log, start, end} = utils.getLog('pars');

// const langObj = JavaScript;
const langObj = typescript;
// const langObj = tsx;

const PARSE_DEBUG_TYPE: string = '';
const PARSE_DEBUG_NAME: string = '';
// const PARSE_DEBUG_TYPE: string = 'class_declaration';
// const PARSE_DEBUG_NAME: string = 'Item';

const sExpr = `
  [
    ((function_declaration
        name: (identifier) @funcDeclName) @funcDecl)
    ((function_expression
        (identifier) @funcExprName) @funcExpr)
    ((variable_declarator
        name: (identifier) @funcExprDeclName
        value: (function_expression) @funcExprDecl) @funcExprDeclBody)
    ((variable_declarator
        name: (identifier) @arrowFuncDeclName
        value: (arrow_function) @arrowFuncDecl) @arrowFuncDeclBody)
    ((class_declaration
        name: (type_identifier) @classDeclName) @classDecl)
    ((method_definition
        name: (property_identifier) @methodDefName) @methodDef)
  ]
`;
const funcDecls =  ['funcDecl',  'funcExpr', 'funcExprDecl', 'arrowFuncDecl', 
                    'classDecl', 'methodDef'];

export interface NodeData {
  funcId:       string;
  funcParents:  [string, string][];
  name:         string;
  type:         string;
  start:        number;
  startName:    number;
  endName:      number;
  end:          number;
}

function parseDebug(rootNode: SyntaxNode) {
    function walkTree(node: SyntaxNode, visit: (node: SyntaxNode) => void) {
    visit(node);
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walkTree(child, visit);
    }
  }
  walkTree(rootNode, node => {
    let name = 'anonymous';
    const nameNode = node.childForFieldName('name');
    if(nameNode) name = nameNode.text;
    const nodeData = {
      name,
      type: node.type,
      start: node.startIndex,
      end: node.endIndex
    };
    if(node.type === PARSE_DEBUG_TYPE) debugger;
    if(nodeData && PARSE_DEBUG_NAME === name) debugger;
  });
}


export function parseCode(code: string, fsPath: string): NodeData[] {

  function getAllParents(node: SyntaxNode): SyntaxNode[] {
    const parents: SyntaxNode[] = [];
    let parent = node.parent;
    while (parent) {
      parents.push(parent);
      parent = parent.parent;
    }
    return parents;
  }

  function idNodeName(node: SyntaxNode): string {
    const  nameNode = node.childForFieldName('name');
    if(!nameNode) return '';
    return nameNode.text + "\x00" + node.type + "\x00";
  }

  function capsToNodeData(nameCapture: Parser.QueryCapture, 
                          funcCapture: Parser.QueryCapture,
                          bodyCapture: Parser.QueryCapture | undefined)
                                      :NodeData | null {
    const nameNode  = nameCapture.node;
    const startName = nameNode.startIndex;
    const endName   = nameNode.endIndex;
    const name      = code.slice(startName, endName);
    if (!name) return null;
    let funcNode = funcCapture.node;
    let start    = funcNode.startIndex;
    let end      = funcNode.endIndex;
    let type     = funcNode.type;
    let parents  = getAllParents(funcNode);
    const funcParents: [string, string][] = [];
    let funcId = idNodeName(funcNode);
    if( funcId === '') funcId = name + "\x00" + type + "\x00";
    if(bodyCapture) {
      start = bodyCapture.node.startIndex;
      end   = bodyCapture.node.endIndex;
      parents = parents.slice(1);
    }
    for(let parent of parents) {
      funcId += idNodeName(parent);
      const nameNode = parent.childForFieldName('name');
      const name     = nameNode?.text;
      if (name) funcParents.push([name, parent.type]);
    }
    funcId += fsPath;
    return { name, funcParents, funcId, 
             start, startName, endName, end, type };
  }
  start('parseCode', true);
  const parser = new Parser();
  parser.setLanguage(langObj as any);
  const tree = parser.parse(code);
  if(PARSE_DEBUG_NAME !== '') parseDebug(tree.rootNode);
  const nodes: NodeData[] = [];
  try {
    const Query = Parser!.Query!;
    const query = new Query(langObj as any, sExpr);
    const matches = query.matches(tree.rootNode);
    for (const match of matches) {
      const funcCapture = match.captures.find(
                             capture => funcDecls.includes(capture.name));
      if(!funcCapture || !funcCapture.node.isNamed) continue;
      const nameCapture = match.captures.find(c => c.name.endsWith('Name'));
      if(!nameCapture || !nameCapture.node.isNamed) continue;
      const bodyCapture = match.captures.find(c => c.name.endsWith('Body'));
      const nodeData = capsToNodeData(nameCapture, funcCapture, bodyCapture);
      if(!nodeData) continue;
      nodes.push(nodeData);
    }
  } catch (e) {
    log('err', 'S-expression query failed', (e as any).message);
    return [];
  }
  // log(`Parsed ${nodes.length} nodes`);
  end('parseCode', false);
  return nodes;
}
