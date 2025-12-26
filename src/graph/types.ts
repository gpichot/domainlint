import type { RuleLevel } from '../config/types.js';

export interface DependencyEdge {
  from: string;
  to: string;
  importInfo: {
    specifier: string;
    line: number;
    col: number;
    isDynamic: boolean;
    isTypeOnly: boolean;
  };
}

export interface DependencyGraph {
  nodes: Set<string>;
  edges: DependencyEdge[];
  adjacencyList: Map<string, Set<string>>;
  normalizedToOriginalPath?: Map<string, string>;
}

export interface Violation {
  code: string;
  file: string;
  line: number;
  col: number;
  message: string;
  level?: Exclude<RuleLevel, 'off'>;
}
