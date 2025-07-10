
export const langs: any = {

  typescript: {
    sExpr: `
      [
        ((function_declaration
            name: (identifier) @funcDeclName) @funcDecl)
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
        ((pair
            key: (property_identifier) @propertyName) @property) @propertyBody
        ((assignment_expression
            left: [(identifier) (member_expression) (subscript_expression)]
                                                      @assExprName) @assExpr)
        ((variable_declarator
            name: (identifier) @varDeclName) @varDecl)
      ]
    `,
    capNames: new Set(['funcDecl',  'funcExprDecl', 'arrowFuncDecl', 
               'classDecl', 'methodDef', 
               'property',  'assExpr', 'varDecl']),

    funcTypes: new Set(["function_declaration", "function_expression", 
                "method_definition", "arrow_function"]),

    lowPriority: new Set(['variable_declarator'])
  },

  python: {
    sExpr: `
      [
        ((function_definition
          name: (identifier) @funcDefName) @funcDef)
        ((class_definition
          name: (identifier) @classDefName) @classDef)
      ]
    `,
    capNames:    new Set(['funcDef', 'classDef']),
    funcTypes:   new Set(["function_definition"]),
    lowPriority: new Set()
  },

}
