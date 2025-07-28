
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
      (identifier)  @identifier
      
      (function_declaration
        (identifier) @function
      )

      (variable_declarator
        (identifier)    @function
        (arrow_function)
      )

      (assignment_expression
        (identifier)    @function
        (arrow_function)
      )

      (method_definition
          name: (property_identifier) @function
      )

      (class
        [
          (type_identifier) @class
          (identifier)      @class
        ]
      )

      (class_declaration
        [
          (type_identifier) @class
          (identifier)      @class
        ]
      )

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
