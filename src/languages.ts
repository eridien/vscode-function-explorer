
type LangConfig = {
  sExpr:    string;
  suffixes: Set<string>;
};

export type Langs = {
  [lang: string]: LangConfig;
};

export const langs: Langs = {

///////////////////////////// typescript ///////////////////////////
  typescript: {
    sExpr: `[
      (function_declaration
        (identifier) @name
      ) @func

      (variable_declarator
        (identifier)     @name
        (arrow_function) @type
      )

      (assignment_expression
        (identifier)     @name
        (arrow_function) @type
      )

      (method_definition
          name: (property_identifier) @name
      )

      (class
        [
          (type_identifier)
          (identifier)
        ] @name
      ) @type

      (class_declaration
        [
          (type_identifier) @name
          (identifier)      @name
        ]
      ) @type

      (declaration) @name
      (identifier)  @name
    ]`,
    suffixes: new Set(['.js', '.ts', '.tsx', '.jsx'])
  },

///////////////////////////// python ///////////////////////////
  python: {
    sExpr: `[
      (function_definition
        name: (identifier) @name
       ) @func
      
      (identifier) @name      
    ]`,
    suffixes: new Set(['.py'])
  },

///////////////////////////// cpp ///////////////////////////
  cpp: {
    sExpr: `[
      (function_definition
        declarator: (function_declarator
          declarator: (identifier) @name)
       ) @func
      
      (identifier) @name      
    ]`,
    suffixes: new Set(['.c','.cpp'])
  },

///////////////////////////// java ///////////////////////////
  java: {
    sExpr: `[
      (method_declaration
           (identifier) @name
       ) @func
      
      (identifier) @name      
    ]`,
    suffixes:    new Set(['.java'])
  },

///////////////////////////// c-sharp ///////////////////////////
  "c-sharp": {
    sExpr: `[ 
      [
        (method_declaration
          name: (identifier) @name
        )
        (local_function_statement
          name: (identifier) @name
        )
      ] @func
      
      (identifier) @name      
    ]`,
    suffixes:    new Set(['.cs'])
  },

///////////////////////////// go ///////////////////////////
  go: {
    sExpr: `[
      [ (function_declaration
          name: (identifier) @name)
        (method_declaration
          name: (field_identifier) @name)
      ] @func
      
      (identifier) @name      
    ]`,
    suffixes: new Set(['.go'])
  },

///////////////////////////// rust ///////////////////////////
  rust: {
    sExpr: `[
      (function_item
        name: (identifier) @name
      ) @func
      
      (identifier) @name      
    ]`,
    suffixes: new Set(['.rs'])
  },
};
