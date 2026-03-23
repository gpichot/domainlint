import type { RuleLevel } from '../config/types.js';
import type { ExportedSymbol, ImportedSymbol } from '../parser/types.js';

export interface DependencyEdge {
  from: string;
  to: string;
  importInfo: {
    specifier: string;
    line: number;
    col: number;
    isDynamic: boolean;
    isTypeOnly: boolean;
    importedNames?: ImportedSymbol[];
  };
}

export interface DependencyGraph {
  nodes: Set<string>;
  edges: DependencyEdge[];
  adjacencyList: Map<string, Set<string>>;
  normalizedToOriginalPath?: Map<string, string>;
  nodeExports?: Map<string, ExportedSymbol[]>;
}

export interface Violation {
  code: string;
  file: string;
  line: number;
  col: number;
  message: string;
  level?: Exclude<RuleLevel, 'off'>;
}
