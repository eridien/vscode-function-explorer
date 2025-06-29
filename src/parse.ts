import Parser              from 'tree-sitter';
import type { SyntaxNode } from 'tree-sitter';
import JavaScript          from 'tree-sitter-javascript';
import * as utils          from './utils';
const {log, start, end} = utils.getLog('pars');

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

  function nodeToNodeData(node: SyntaxNode): NodeData | null {
    const nameNode = node.childForFieldName('name');
    const name = nameNode?.text;
    if (!name) return null;
    const parents = getAllParents(node);
    const funcParents: [string, string][] = [];
    let funcId = idNodeName(node);
    for(let parent of parents) {
      funcId  += idNodeName(parent);
      const nameNode = parent.childForFieldName('name');
      const name     = nameNode?.text;
      if (name) funcParents.push([name, parent.type]);
    }
    funcId += fsPath;
    return { name, funcParents, funcId,
             type     :  node.type,
             start    :  node.startIndex,
             startName:  nameNode!.startIndex,
             endName  :  nameNode!.endIndex,
             end      :  node.endIndex };
  }

  function walkTree(node: SyntaxNode, visit: (node: SyntaxNode) => void) {
    visit(node);
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walkTree(child, visit);
    }
  }
  start('parseCode');
  const parser = new Parser();
  parser.setLanguage(JavaScript as any);
  const tree = parser.parse(code);
  const nodes: NodeData[] = [];
  walkTree(tree.rootNode, node => {
    const nodeData = nodeToNodeData(node);
    if (nodeData) nodes.push(nodeData);
  });
  log(`Parsed ${nodes.length} nodes`);
  // console.log(JSON.stringify(nodes, null, 2));
  end('parseCode', false);
  return nodes;
}
