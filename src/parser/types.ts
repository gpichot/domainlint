export interface ImportInfo {
  specifier: string;
  line: number;
  col: number;
  isDynamic: boolean;
  isTypeOnly: boolean;
}

export interface ParseResult {
  filePath: string;
  imports: ImportInfo[];
}
