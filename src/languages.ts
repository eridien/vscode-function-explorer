
export const langs: any = {

///////////////////////////// typescript ///////////////////////////
  typescript: {
    sExpr: `
      [
        ((function_declaration
            name: (identifier) @ts.funcDeclName) @ts.funcDecl)
        ((variable_declarator
            name: (identifier) @ts.funcExprDeclName
            value: (function_expression) @ts.funcExprDecl) @ts.funcExprDeclBody)
        ((variable_declarator
            name: (identifier) @ts.arrowFuncDeclName
            value: (arrow_function) @ts.arrowFuncDecl) @ts.arrowFuncDeclBody)
        ((class_declaration
            name: (type_identifier) @ts.classDeclName) @ts.classDecl)
        ((method_definition
            name: (property_identifier) @ts.methodDefName) @ts.methodDef)
        ((pair
            key: (property_identifier) @ts.propertyName) @ts.property) @ts.propertyBody
        ((assignment_expression
            left: [(identifier) (member_expression) (subscript_expression)]
                                                      @ts.assExprName) @ts.assExpr)
        ((variable_declarator
            name: (identifier) @ts.varDeclName) @ts.varDecl)
         ((namespace_import
            (identifier) @ts.importName) @ts.import)
     ]
    `,
    capTypes: new Map<string, string>([
      ['ts.funcDecl',          'function_declaration'],
      ['ts.funcExprDeclBody',  'function_expression'],
      ['ts.arrowFuncDeclBody', 'arrow_function'],
      ['ts.classDecl',         'class_declaration'],
      ['ts.methodDef',         'method_definition'],
      ['ts.propertyBody',      'pair'],
      ['ts.assExpr',           'assignment_expression'],
      ['ts.varDecl',           'variable_declarator'],
      ['ts.import',            'namespace_import'],
    ]),
    symbols: new Map<string, string>([
      ['function_declaration',  'ƒ'],
      ['function_expression',   'ƒ'],
      ['arrow_function',        'ƒ'],
      ['method_definition',     'f'],
      ['class_declaration',     '©'],
      ['pair',                  ':'],
      ['assExpr',               ':'],
      ['assignment_expression', '='],
      ['variable_declarator',   '='],
      ['namespace_import',      '▷'],
    ]),
    funcTypes: new Set(["function_declaration", "function_expression", 
                        "method_definition", "arrow_function"]),

    lowPriority: new Set(['variable_declarator']),

    suffixes:    new Set(['.js', '.ts', '.tsx', '.jsx'])
  },

///////////////////////////// python ///////////////////////////
  python: {
    sExpr: `
      [
        ((function_definition
          name: (identifier) @py.funcDefName) @py.funcDef)
        ((class_definition
          name: (identifier) @py.classDefName) @py.classDef)
        ((assignment
          (pattern) @py.namedExprName) @py.namedExpr)
        (import_statement
          (dotted_name) @py.importName) @py.import
        (import_from_statement
          (dotted_name) @py.importFromName) @py.importFrom
      ]
    `,
    capTypes: new Map<string, string>([
      ['py.funcDef',    'function_definition'],
      ['py.classDef',   'class_definition'],
      ['py.namedExpr',  'assignment'],
      ['py.namedExpr',  'assignment'],
      ['py.import',     'import_statement'],      // import foo
      ['py.importFrom', 'import_from_statement'], // from foo import bar
    ]),
    symbols: new Map([
      ['function_definition',   'ƒ'],
      ['class_definition',      '©'],
      ['assignment',            '='],
      ['import_statement',      '▷'],
      ['import_from_statement', '▷'],
    ]),
    funcTypes:   new Set(["function_definition"]),
    lowPriority: new Set(),
    suffixes:    new Set(['.py'])
  },

///////////////////////////// c ///////////////////////////
  c: {
    sExpr: `
      [
        ((function_definition
          declarator: (function_declarator
            declarator: (identifier) @c.funcDefName)) @c.funcDef)
        ((assignment_expression
          left: (identifier) @c.assExprName) @c.assExpr)
        ((call_expression
          function: (identifier) @c.callExprName) @c.callExpr)
      ]
    `,
    capTypes: new Map<string, string>([
      ['c.funcDef',  'function_definition'],
      ['c.assExpr',  'assignment_expression'],
      ['c.callExpr', 'call_expression'],
    ]),
    symbols: new Map([
      ['function_definition',   'ƒ'],
      ['assignment_expression', '='],
      ['call_expression',       '('],
    ]),
    funcTypes:   new Set(["function_definition"]),
    lowPriority: new Set(),
    suffixes:    new Set(['.c'])
  },

};
