import { relative } from 'node:path';
import type { FeatureBoundariesConfig } from '../config/types.js';
import { getFeature } from '../files/file-discovery.js';
import type { DependencyGraph } from '../graph/types.js';

export interface GraphNode {
  id: string;
  label: string;
  feature?: string;
  group?: string;
}

export interface GraphEdge {
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

export interface FeatureNode {
  id: string;
  label: string;
  fileCount: number;
}

export interface FeatureEdge {
  from: string;
  to: string;
  count: number;
}

export interface ExportedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  features: string[];
  featureGraph: {
    nodes: FeatureNode[];
    edges: FeatureEdge[];
  };
}

export class GraphExporter {
  constructor(private config: FeatureBoundariesConfig) {}

  /**
   * Convert dependency graph to exportable format
   */
  exportGraph(graph: DependencyGraph): ExportedGraph {
    const features = new Set<string>();
    const nodes: GraphNode[] = [];
    const featureFileCount = new Map<string, number>();

    // Create nodes from graph
    for (const nodePath of graph.nodes) {
      const originalPath = graph.normalizedToOriginalPath?.get(nodePath);
      const displayPath = originalPath || nodePath;
      const relativePath = relative(this.config.rootDir, displayPath);
      const feature = getFeature(displayPath, this.config);

      if (feature) {
        features.add(feature);
        featureFileCount.set(feature, (featureFileCount.get(feature) || 0) + 1);
      }

      nodes.push({
        id: nodePath,
        label: relativePath,
        feature: feature || undefined,
        group: feature || undefined,
      });
    }

    // Create edges
    const edges: GraphEdge[] = graph.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      importInfo: edge.importInfo,
    }));

    // Build feature-level graph
    const featureEdgeMap = new Map<string, number>();

    for (const edge of graph.edges) {
      const fromOriginalPath =
        graph.normalizedToOriginalPath?.get(edge.from) || edge.from;
      const toOriginalPath =
        graph.normalizedToOriginalPath?.get(edge.to) || edge.to;

      const fromFeature = getFeature(fromOriginalPath, this.config);
      const toFeature = getFeature(toOriginalPath, this.config);

      // Only track cross-feature dependencies
      if (fromFeature && toFeature && fromFeature !== toFeature) {
        const key = `${fromFeature}->${toFeature}`;
        featureEdgeMap.set(key, (featureEdgeMap.get(key) || 0) + 1);
      }
    }

    const featureNodes: FeatureNode[] = Array.from(features)
      .sort()
      .map((feature) => ({
        id: feature,
        label: feature,
        fileCount: featureFileCount.get(feature) || 0,
      }));

    const featureEdges: FeatureEdge[] = Array.from(
      featureEdgeMap.entries(),
    ).map(([key, count]) => {
      const [from, to] = key.split('->');
      return { from, to, count };
    });

    return {
      nodes,
      edges,
      features: Array.from(features).sort(),
      featureGraph: {
        nodes: featureNodes,
        edges: featureEdges,
      },
    };
  }

  /**
   * Export graph as JSON string
   */
  exportAsJson(graph: DependencyGraph): string {
    return JSON.stringify(this.exportGraph(graph), null, 2);
  }
}
