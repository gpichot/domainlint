export interface ImportedSymbol {
  name: string; // the exported name being imported ('default' for default imports)
  isNamespace: boolean; // import * as ns
}

export interface ImportInfo {
  specifier: string;
  line: number;
  col: number;
  isDynamic: boolean;
  isTypeOnly: boolean;
  importedNames?: ImportedSymbol[];
}

export interface ExportedSymbol {
  name: string; // 'default' for default exports
  line: number;
  col: number;
  isTypeOnly: boolean;
}

export interface ParseResult {
  filePath: string;
  imports: ImportInfo[];
  exports: ExportedSymbol[];
}
